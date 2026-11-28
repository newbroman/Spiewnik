// ============================================================================
//  Link resolver — Vercel serverless function (served at /api/resolve)
//
//  Turns a pasted Spotify or YouTube link into a song the user can add,
//  returning the same shape as /api/search so the picker can reuse it.
//    - Spotify track URL    -> one track (SPOTIFY_CLIENT_ID/SECRET)
//    - Spotify album URL    -> every track on the album (pick which to add)
//    - Spotify playlist URL -> its tracks (first 50)
//    - YouTube URL          -> videos.list snippet (YOUTUBE_API_KEY, 1 quota unit),
//                              with a best-effort "Artist - Title" parse.
//
//  GET /api/resolve?url=https://open.spotify.com/album/XXXX
//    -> { results: [{ title, artist, album, year }, ...] }
// ============================================================================

import { authorized, ALLOW_HEADERS } from "./_auth.js";

let spToken = { token: null, exp: 0 };
async function spotifyToken() {
  const id = process.env.SPOTIFY_CLIENT_ID, secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (spToken.token && Date.now() < spToken.exp) return spToken.token;
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) return null;
  const j = await r.json();
  spToken = { token: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  return spToken.token;
}

// "Artist - Title (Official Video)" -> { artist, title }
function parseYtTitle(raw) {
  let s = (raw || "").trim();
  // drop a trailing "| channel / extra" tail
  s = s.replace(/\s*\|\s*.*$/, "");
  // strip bracketed noise: (Official Video), [Audio], (Lyrics), (4K), (Remastered)…
  s = s.replace(/\s*[([][^)\]]*(official|video|audio|lyric|lyrics|mv|hd|4k|visuali[sz]er|remaster|live|teledysk)[^)\]]*[)\]]/gi, "");
  s = s.trim();
  const parts = s.split(/\s[–—-]\s/); // en/em dash or hyphen with spaces
  if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(" - ").trim() };
  return { artist: "", title: s };
}

async function fromSpotify(id) {
  const token = await spotifyToken();
  if (!token) return null;
  const r = await fetch(`https://api.spotify.com/v1/tracks/${id}`, {
    headers: { Authorization: "Bearer " + token },
  });
  if (!r.ok) return null;
  const t = await r.json();
  return {
    title: t.name || "",
    artist: (t.artists || []).map((a) => a.name).filter(Boolean).join(", "),
    album: t.album?.name || "",
    year: (t.album?.release_date || "").slice(0, 4),
  };
}

// A Spotify album link -> every track on the album, so the user can pick.
async function fromSpotifyAlbum(id) {
  const token = await spotifyToken();
  if (!token) return [];
  const r = await fetch(`https://api.spotify.com/v1/albums/${id}`, { headers: { Authorization: "Bearer " + token } });
  if (!r.ok) return [];
  const a = await r.json();
  const album = a.name || "";
  const year = (a.release_date || "").slice(0, 4);
  return (a.tracks?.items || [])
    .map((t) => ({ title: t.name || "", artist: (t.artists || []).map((x) => x.name).filter(Boolean).join(", "), album, year }))
    .filter((x) => x.title);
}

// A Spotify playlist link -> its tracks (first 50).
async function fromSpotifyPlaylist(id) {
  const token = await spotifyToken();
  if (!token) return [];
  const r = await fetch(`https://api.spotify.com/v1/playlists/${id}/tracks?limit=50`, { headers: { Authorization: "Bearer " + token } });
  if (!r.ok) return [];
  const j = await r.json();
  return (j.items || [])
    .map((it) => {
      const t = it.track || {};
      return { title: t.name || "", artist: (t.artists || []).map((x) => x.name).filter(Boolean).join(", "), album: t.album?.name || "", year: (t.album?.release_date || "").slice(0, 4) };
    })
    .filter((x) => x.title);
}

async function fromYouTube(id) {
  const KEY = process.env.YOUTUBE_API_KEY;
  if (!KEY) return null;
  const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${id}&key=${KEY}`);
  if (!r.ok) return null;
  const j = await r.json();
  const sn = j.items?.[0]?.snippet;
  if (!sn) return null;
  const { artist, title } = parseYtTitle(sn.title);
  return { title, artist: artist || sn.channelTitle || "", album: "", year: (sn.publishedAt || "").slice(0, 4) };
}

function spotifyTrackId(url) {
  const m = url.match(/open\.spotify\.com\/track\/([A-Za-z0-9]+)/) || url.match(/spotify:track:([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}
function spotifyAlbumId(url) {
  const m = url.match(/open\.spotify\.com\/album\/([A-Za-z0-9]+)/) || url.match(/spotify:album:([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}
function spotifyPlaylistId(url) {
  const m = url.match(/open\.spotify\.com\/playlist\/([A-Za-z0-9]+)/) || url.match(/spotify:playlist:([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}
function youtubeId(url) {
  const m =
    url.match(/[?&]v=([A-Za-z0-9_-]{6,})/) ||
    url.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/) ||
    url.match(/youtube\.com\/(?:embed|shorts)\/([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", ALLOW_HEADERS);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!(await authorized(req))) return res.status(401).json({ error: "Unauthorized" });

  const url = (req.query.url || "").toString().trim();
  if (!url) return res.status(200).json({ results: [] });

  try {
    const sid = spotifyTrackId(url);
    const albumId = sid ? null : spotifyAlbumId(url);
    const playlistId = sid || albumId ? null : spotifyPlaylistId(url);
    const yid = sid || albumId || playlistId ? null : youtubeId(url);

    let results = [];
    if (sid) { const one = await fromSpotify(sid); results = one && one.title ? [one] : []; }
    else if (albumId) results = await fromSpotifyAlbum(albumId);
    else if (playlistId) results = await fromSpotifyPlaylist(playlistId);
    else if (yid) { const one = await fromYouTube(yid); results = one && one.title ? [one] : []; }
    else return res.status(200).json({ results: [], error: "unsupported" });

    return res.status(200).json({ results });
  } catch (e) {
    return res.status(502).json({ error: e.message || "Resolve failed." });
  }
}
