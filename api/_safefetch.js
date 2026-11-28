// ============================================================================
//  SSRF-safe page fetch for user-supplied / scraped URLs.
//
//  Used by /api/ai `extract` (a link the user pasted) and by `findlyrics`
//  (search-result pages). The server must never be tricked into requesting
//  internal addresses (cloud metadata, localhost, the private network).
//
//  Rules, enforced on EVERY hop (redirects are followed manually, max 3):
//    - scheme http: or https: only; no user:pass@ in the URL
//    - port must be the default, 80 or 443
//    - the hostname is resolved with dns.lookup({ all: true }) and EVERY
//      address must be public: private, loopback, link-local (incl. the
//      169.254.169.254 metadata address), CGNAT, ULA, multicast, reserved,
//      documentation and IPv4-mapped/NAT64/6to4/Teredo IPv6 forms are refused
//    - the connection itself uses a lookup hook that re-checks the addresses
//      it actually connects to, so DNS rebinding between check and connect
//      doesn't help an attacker
//    - overall timeout (default 9 s) and a response-size cap (default ~2 MB,
//      counted after decompression; the body is truncated at the cap)
//    - only text-like content types (html, xhtml, xml, plain text)
//
//  safeFetch(url, { timeoutMs, maxBytes, headers, signal })
//    -> { ok, status, url, contentType, text, truncated }
//  Throws SafeFetchError { code: "bad_url" | "blocked" | "timeout" |
//  "network" | "too_many_redirects" | "bad_type" }.
// ============================================================================

import dns from "node:dns";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";

export class SafeFetchError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

// ---- address classification ------------------------------------------------
const V4_BLOCKED = [
  ["0.0.0.0", 8],        // "this" network
  ["10.0.0.0", 8],       // private
  ["100.64.0.0", 10],    // CGNAT (also Alibaba metadata 100.100.100.200)
  ["127.0.0.0", 8],      // loopback
  ["169.254.0.0", 16],   // link-local, incl. 169.254.169.254 metadata
  ["172.16.0.0", 12],    // private
  ["192.0.0.0", 24],     // IETF protocol assignments
  ["192.0.2.0", 24],     // TEST-NET-1
  ["192.88.99.0", 24],   // 6to4 relay anycast
  ["192.168.0.0", 16],   // private
  ["198.18.0.0", 15],    // benchmarking
  ["198.51.100.0", 24],  // TEST-NET-2
  ["203.0.113.0", 24],   // TEST-NET-3
  ["224.0.0.0", 4],      // multicast
  ["240.0.0.0", 4],      // reserved + broadcast
];

const v4ToInt = (ip) => ip.split(".").reduce((a, o) => ((a << 8) | (Number(o) & 255)) >>> 0, 0);
const V4_RANGES = V4_BLOCKED.map(([base, bits]) => {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { net: (v4ToInt(base) & mask) >>> 0, mask };
});

function v4Blocked(ip) {
  const n = v4ToInt(ip);
  return V4_RANGES.some((r) => ((n & r.mask) >>> 0) === r.net);
}

// Expand an IPv6 string (any valid form, incl. embedded dotted IPv4) to 8 words.
function v6Words(ip) {
  let s = ip.toLowerCase();
  const pct = s.indexOf("%"); if (pct >= 0) s = s.slice(0, pct); // zone id
  // Trailing dotted IPv4 -> two hex words.
  const m = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (m) {
    const n = v4ToInt(m[2]);
    s = m[1] + ((n >>> 16) & 0xffff).toString(16) + ":" + (n & 0xffff).toString(16);
  }
  const [head, tail] = s.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : null;
  const words = t === null ? h : [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
  return words.map((w) => parseInt(w || "0", 16));
}

function v6Blocked(ip) {
  const w = v6Words(ip);
  if (w.length !== 8 || w.some((x) => Number.isNaN(x))) return true;
  // IPv4-mapped ::ffff:a.b.c.d  and IPv4-compatible ::a.b.c.d -> judge the IPv4.
  const zero5 = w[0] === 0 && w[1] === 0 && w[2] === 0 && w[3] === 0 && w[4] === 0;
  if (zero5 && (w[5] === 0xffff || w[5] === 0)) {
    if (w[5] === 0 && w[6] === 0 && w[7] <= 1) return true; // :: and ::1
    const v4 = `${w[6] >> 8}.${w[6] & 255}.${w[7] >> 8}.${w[7] & 255}`;
    return w[5] === 0 ? true : v4Blocked(v4); // IPv4-compatible is deprecated: refuse
  }
  // Only global unicast 2000::/3 is acceptable. This alone refuses ::/8,
  // 64:ff9b::/96 (NAT64), 100::/64, fc00::/7 (ULA, incl. fd00:ec2::254
  // metadata), fe80::/10 (link-local), fec0::/10 and ff00::/8 (multicast).
  if ((w[0] & 0xe000) !== 0x2000) return true;
  if (w[0] === 0x2001 && w[1] === 0x0db8) return true;          // documentation
  if (w[0] === 0x2001 && w[1] === 0x0000) return true;          // Teredo
  if (w[0] === 0x2001 && (w[1] & 0xfff0) === 0x0010) return true; // ORCHID
  if (w[0] === 0x2002) return true;                             // 6to4 (embeds IPv4)
  if (w[0] === 0x3fff && (w[1] & 0xf000) === 0) return true;    // 3fff::/20 documentation
  return false;
}

export function isBlockedAddress(ip) {
  const fam = net.isIP(ip);
  if (fam === 4) return v4Blocked(ip);
  if (fam === 6) return v6Blocked(ip);
  return true;
}

// ---- URL / DNS validation ---------------------------------------------------
function checkUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new SafeFetchError("bad_url", "Not a valid URL."); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new SafeFetchError("bad_url", "Only http and https links are supported.");
  if (u.username || u.password) throw new SafeFetchError("bad_url", "Links with credentials are not supported.");
  if (u.port && u.port !== "80" && u.port !== "443") throw new SafeFetchError("blocked", "Only ports 80 and 443 are allowed.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host) throw new SafeFetchError("bad_url", "Missing host.");
  return { u, host };
}

async function resolvePublic(host) {
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) throw new SafeFetchError("blocked", "That address is not allowed.");
    return;
  }
  if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host) || !host.includes(".")) {
    throw new SafeFetchError("blocked", "That host is not allowed.");
  }
  let addrs;
  try { addrs = await dns.promises.lookup(host, { all: true, verbatim: true }); }
  catch { throw new SafeFetchError("network", "Couldn't resolve that host."); }
  if (!addrs.length || addrs.some((a) => isBlockedAddress(a.address))) {
    throw new SafeFetchError("blocked", "That host resolves to a non-public address.");
  }
}

// Connection-time lookup hook: same check on the addresses actually used.
function guardedLookup(hostname, options, callback) {
  if (typeof options === "function") { callback = options; options = {}; }
  const opts = typeof options === "number" ? { family: options } : { ...(options || {}) };
  dns.lookup(hostname, { ...opts, all: true }, (err, addrs) => {
    if (err) return callback(err);
    const bad = !addrs.length || addrs.some((a) => isBlockedAddress(a.address));
    if (bad) return callback(Object.assign(new Error("blocked address"), { code: "EBLOCKED" }));
    if (opts.all) return callback(null, addrs);
    return callback(null, addrs[0].address, addrs[0].family);
  });
}

// ---- one hop ---------------------------------------------------------------
const TEXTY = /^(text\/|application\/(xhtml\+xml|xml|rss\+xml|atom\+xml|json))/i;

function decodeBody(buf, contentType) {
  const m = /charset=["']?([\w-]+)/i.exec(contentType || "");
  let cs = (m ? m[1] : "").toLowerCase();
  if (!cs) {
    const head = buf.subarray(0, 4096).toString("latin1");
    const mm = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head);
    if (mm) cs = mm[1].toLowerCase();
  }
  try { return new TextDecoder(cs || "utf-8").decode(buf); }
  catch { return new TextDecoder("utf-8").decode(buf); }
}

function requestOnce(u, { headers, maxBytes, signal }) {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(u, {
      method: "GET",
      headers: { "Accept-Encoding": "gzip, deflate, br", ...headers },
      lookup: guardedLookup,
      signal,
    }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        return resolve({ redirect: res.headers.location, status });
      }
      const contentType = String(res.headers["content-type"] || "");
      if (contentType && !TEXTY.test(contentType)) {
        res.destroy();
        return reject(new SafeFetchError("bad_type", "That link isn't a web page."));
      }
      const enc = String(res.headers["content-encoding"] || "").toLowerCase();
      let stream = res;
      if (enc === "gzip" || enc === "x-gzip") stream = res.pipe(zlib.createGunzip());
      else if (enc === "deflate") stream = res.pipe(zlib.createInflate());
      else if (enc === "br") stream = res.pipe(zlib.createBrotliDecompress());

      const chunks = []; let size = 0; let truncated = false; let done = false;
      const finish = () => {
        if (done) return; done = true;
        const buf = Buffer.concat(chunks);
        resolve({ status, contentType, text: decodeBody(buf, contentType), truncated });
      };
      stream.on("data", (c) => {
        if (done) return;
        const room = maxBytes - size;
        if (c.length >= room) {
          chunks.push(c.subarray(0, room)); size = maxBytes; truncated = true;
          finish(); res.destroy(); if (stream !== res) stream.destroy();
          return;
        }
        chunks.push(c); size += c.length;
      });
      stream.on("end", finish);
      stream.on("error", (e) => { if (!done) { done = true; reject(new SafeFetchError("network", e.message)); } });
      res.on("error", (e) => { if (!done) { done = true; reject(new SafeFetchError("network", (e && e.message) || "Connection error.")); } });
      res.on("aborted", () => { if (!done) { done = true; reject(new SafeFetchError("network", "Connection aborted.")); } });
    });
    req.on("error", (e) => {
      if (e && e.code === "EBLOCKED") return reject(new SafeFetchError("blocked", "That host resolves to a non-public address."));
      if (e && (e.name === "AbortError" || e.code === "ABORT_ERR")) return reject(new SafeFetchError("timeout", "The page took too long to load."));
      reject(new SafeFetchError("network", (e && e.message) || "Network error."));
    });
    req.end();
  });
}

// ---- public entry point ----------------------------------------------------
export async function safeFetch(rawUrl, opts = {}) {
  const timeoutMs = opts.timeoutMs || 9000;
  const maxBytes = opts.maxBytes || 2 * 1024 * 1024;
  const maxRedirects = 3;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onOuterAbort = () => ctrl.abort();
  if (opts.signal) {
    if (opts.signal.aborted) ctrl.abort();
    else opts.signal.addEventListener("abort", onOuterAbort, { once: true });
  }
  try {
    let current = rawUrl;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const { u, host } = checkUrl(current);
      await resolvePublic(host);
      if (ctrl.signal.aborted) throw new SafeFetchError("timeout", "The page took too long to load.");
      const r = await requestOnce(u, { headers: opts.headers || {}, maxBytes, signal: ctrl.signal });
      if (r.redirect) {
        if (hop === maxRedirects) throw new SafeFetchError("too_many_redirects", "Too many redirects.");
        current = new URL(r.redirect, u).toString();
        continue;
      }
      return { ok: r.status >= 200 && r.status < 300, status: r.status, url: u.toString(), contentType: r.contentType, text: r.text, truncated: r.truncated };
    }
    throw new SafeFetchError("too_many_redirects", "Too many redirects.");
  } catch (e) {
    if (ctrl.signal.aborted && !(e instanceof SafeFetchError && e.code !== "network")) {
      throw new SafeFetchError("timeout", "The page took too long to load.");
    }
    throw e instanceof SafeFetchError ? e : new SafeFetchError("network", (e && e.message) || "Network error.");
  } finally {
    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener("abort", onOuterAbort);
  }
}
