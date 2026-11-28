import React, { useEffect, useRef, useState } from "react";
import { SPLIT_RE, esc, norm } from "../lib/util.js";
import { useT } from "../lib/i18nContext.js";

// ---- Library list -----------------------------------------------------------
// ---- Overflow (⋮) menu: Settings, Help, Feedback, Sign out ------------------
function OverflowMenu({ items }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="ovmenu" ref={ref}>
      <button className="ovbtn" aria-label={t("menu")} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>⋮</button>
      {open && (
        <div className="ovlist" role="menu">
          {items.map((it) => (
            <button key={it.label} role="menuitem" className={"ovitem" + (it.accent ? " accent" : "")}
              onClick={() => { setOpen(false); it.onClick(); }}>
              <span className="ovic" aria-hidden="true">{it.icon}</span>{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// `recent` = recently opened songs (most recent first). `offline` disables edits.
export default function ListView({ songs, loading, email, recent = [], offline, onOpen, onDelete, onAdd, onSettings, onSignOut, onHelp, onFeedback, onShareList, onAddSample }) {
  const t = useT();
  const [sampleBusy, setSampleBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null); // song id awaiting delete confirmation
  const [selArtist, setSelArtist] = useState(null); // drilled-in artist: { language, key } or null
  const [openAl, setOpenAl] = useState({});  // collapsed albums on the artist page (default open)
  const [query, setQuery] = useState("");    // library lyric/word search
  // Index by language, then by artist within each language.
  const byLang = [];
  songs.forEach((s) => {
    const L = s.language || "Other";
    let lg = byLang.find((x) => x.language === L);
    if (!lg) { lg = { language: L, artists: [] }; byLang.push(lg); }
    const A = (s.artist && s.artist.trim()) || t("unknownArtist");
    const key = A.toLowerCase();
    let ar = lg.artists.find((x) => x.key === key);
    if (!ar) { ar = { key, artist: A, albums: [] }; lg.artists.push(ar); }
    // Prefer a label that starts with a capital (e.g. "Zalia" over "zalia").
    else if (A.charAt(0) === A.charAt(0).toUpperCase() && ar.artist.charAt(0) !== ar.artist.charAt(0).toUpperCase()) ar.artist = A;
    // Group by album within the artist. Blank album = loose singles (no header).
    const AL = (s.album && s.album.trim()) || "";
    const alKey = AL.toLowerCase();
    let al = ar.albums.find((x) => x.key === alKey);
    if (!al) { al = { key: alKey, album: AL, items: [] }; ar.albums.push(al); }
    else if (AL.charAt(0) === AL.charAt(0).toUpperCase() && al.album.charAt(0) !== al.album.charAt(0).toUpperCase()) al.album = AL;
    al.items.push(s);
  });
  byLang.sort((a, b) => a.language.localeCompare(b.language));
  byLang.forEach((lg) => {
    lg.artists.sort((a, b) => a.artist.localeCompare(b.artist));
    // Named albums first (A–Z), loose singles (blank album) last; songs A–Z within each.
    lg.artists.forEach((ar) => {
      ar.albums.sort((a, b) => (a.key ? 0 : 1) - (b.key ? 0 : 1) || a.album.localeCompare(b.album));
      ar.albums.forEach((al) => al.items.sort((a, b) => (a.title || "").localeCompare(b.title || "")));
    });
  });
  const done = songs.filter((s) => s.pl && s.pl.trim()).length;
  // "Continue" = last opened song; "Recent" = the few before it.
  const cont = recent[0] || null;
  const more = recent.slice(1, 6);

  // One song row: tap the body to open it, or the bin to delete (with an inline confirm).
  const songRow = (s, i) => {
    const filled = !!(s.pl && s.pl.trim());
    return (
      <div key={s.id} className="songrow">
        <button className="song" onClick={() => onOpen(s.id)}>
          <span className="num">{i + 1}</span>
          <span className="meta">
            <h3>{s.title || t("untitled")}</h3>
            <p>{filled ? t("lines", { n: s.pl.split(SPLIT_RE).filter((l) => l.trim()).length }) : t("noLyricsYet")}</p>
          </span>
          <span className={"dot " + (filled ? "full" : "empty")} />
        </button>
        {offline ? null : confirmDel === s.id ? (
          <span className="songdelask">
            <button className="songdel yes" onClick={() => { onDelete(s.id); setConfirmDel(null); }}>{t("del")}</button>
            <button className="songdel no" onClick={() => setConfirmDel(null)}>{t("keep")}</button>
          </span>
        ) : (
          <button className="songdel" aria-label={t("removeSong")} title={t("removeSong")}
            onClick={() => setConfirmDel(s.id)}>🗑</button>
        )}
      </div>
    );
  };

  // Drilled-in artist (master → detail): resolve the selection against the fresh grouping.
  const curLg = selArtist ? byLang.find((l) => l.language === selArtist.language) : null;
  const curAr = curLg ? curLg.artists.find((a) => a.key === selArtist.key) : null;

  // Library word-search: match a remembered lyric (or title/artist) across songs,
  // diacritic-insensitive so Polish matches with or without accents.
  const nq = norm(query);
  const matches = nq
    ? songs
        .map((s) => {
          let snip = "";
          for (const l of (s.pl || "").split(SPLIT_RE).concat((s.en || "").split(SPLIT_RE))) {
            if (norm(l).includes(nq)) { snip = l.trim(); break; }
          }
          const metaHit =
            norm(s.title).includes(nq) || norm(s.artist).includes(nq) || norm(s.album || "").includes(nq);
          return snip || metaHit ? { s, snip } : null;
        })
        .filter(Boolean)
        .sort((a, b) =>
          (a.s.artist || "").localeCompare(b.s.artist || "") || (a.s.title || "").localeCompare(b.s.title || "")
        )
    : [];

  return (
    <>
      <div className="top">
        <div className="toprow">
          <div className="eyebrow">{t("libraryEyebrow")}</div>
          <OverflowMenu items={[
            { icon: "⚙", label: t("settings"), onClick: onSettings },
            { icon: "?", label: t("help"), onClick: onHelp },
            { icon: "✉", label: t("feedback"), onClick: onFeedback, accent: true },
            { icon: "⎋", label: t("signOut"), onClick: onSignOut },
          ]} />
        </div>
        <h1>Śpiewnik</h1>
        <p>{songs.length === 0
          ? t("emptyIntro")
          : `${t("filled", { done, total: songs.length })} ${t("signedInAs", { email })}`}</p>
      </div>
      <div className="body">
        {offline && <div className="offlinebar" role="status">{t("offlineBanner")}</div>}
        {/* LEARN_SLOT */}
        {!loading && !query.trim() && !curAr && cont && (
          <button className="contcard" onClick={() => onOpen(cont.id)}>
            <span className="contlbl">{t("continueH")}</span>
            <span className="conttitle">{cont.title || t("untitled")}</span>
            <span className="contsub">{[cont.artist, cont.language].filter(Boolean).join(" · ")}</span>
            <span className="contgo" aria-hidden="true">›</span>
          </button>
        )}
        {!loading && !query.trim() && !curAr && more.length > 0 && (
          <div className="recentwrap">
            <div className="recenthdr">{t("recentH")}</div>
            <div className="recentrow">
              {more.map((s) => (
                <button key={s.id} className="recentchip" onClick={() => onOpen(s.id)}>
                  <b>{s.title || t("untitled")}</b>
                  <small>{s.artist || "\u00a0"}</small>
                </button>
              ))}
            </div>
          </div>
        )}
        {!loading && songs.length > 0 && (
          <div className="addtop">
            <button className="add" onClick={onAdd} disabled={offline}>{t("addSongPlus")}</button>
            {onShareList && <button className="sharebtn" onClick={onShareList}>↗ {t("shareList")}</button>}
          </div>
        )}
        {!loading && songs.length > 0 && (
          <div className="libsearch">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("searchLibraryPh")} />
            {query && <button className="libsearchx" onClick={() => setQuery("")} aria-label={t("keep")}>✕</button>}
          </div>
        )}
        {loading ? (
          <div className="emptylib">{t("loading")}</div>
        ) : songs.length === 0 ? (
          <div className="emptyhero">
            <div className="emptyicon">♪</div>
            <h3>{t("emptyTitle")}</h3>
            <p>{t("emptyBody")}</p>
            <button className="add big" onClick={onAdd} disabled={offline}>{t("addFirst")}</button>
            {onAddSample && (
              <div className="samplecard">
                <div className="samplenote">♪</div>
                <div className="sampletx">
                  <h4>{t("sampleCardH")}</h4>
                  <p>{t("sampleCardB")}</p>
                  <button className="samplebtn" disabled={sampleBusy || offline}
                    onClick={async () => { setSampleBusy(true); await onAddSample(); setSampleBusy(false); }}>
                    {sampleBusy ? t("adding") : t("sampleAdd")}
                  </button>
                </div>
              </div>
            )}
            <button className="emptyhelp" onClick={onHelp}>{t("emptyHow")}</button>
          </div>
        ) : query.trim() ? (
          matches.length === 0 ? (
            <div className="emptylib">{t("noLyricHits")}</div>
          ) : (
            matches.map(({ s, snip }) => (
              <button key={s.id} className="song lyrichit" onClick={() => onOpen(s.id)}>
                <span className="meta">
                  <h3>{s.title || t("untitled")}</h3>
                  <p className="hitsub">{[s.artist, s.language].filter(Boolean).join(" · ")}</p>
                  {snip && <p className="hitsnip">{esc(snip)}</p>}
                </span>
              </button>
            ))
          )
        ) : curAr ? (
          <>
            <button className="artback" onClick={() => setSelArtist(null)}>← {t("allArtists")}</button>
            <div className="albsect">{curLg.language}</div>
            <h2 className="artpagetitle">{curAr.artist}</h2>
            {curAr.albums.map((al) => {
              const alKey = selArtist.language + "|" + selArtist.key + "|" + (al.key || "_loose");
              const alOpen = openAl[alKey] === undefined ? true : openAl[alKey];
              return (
                <div key={al.key || "_loose"} className="albgroup">
                  <button className={"albbtn" + (alOpen ? " open" : "")} aria-expanded={alOpen}
                    onClick={() => setOpenAl((o) => ({ ...o, [alKey]: !(o[alKey] === undefined ? true : o[alKey]) }))}>
                    <span className="chev">▸</span>
                    <span className={"artname" + (al.key ? "" : " noalbum")}>{al.album || t("noAlbum")}</span>
                    <span className="count">{al.items.length}</span>
                  </button>
                  {alOpen && <div className="songs">{al.items.map((s, i) => songRow(s, i))}</div>}
                </div>
              );
            })}
          </>
        ) : (
          byLang.map((lg) => (
            <div key={lg.language}>
              <div className="albsect">{lg.language}</div>
              {lg.artists.map((ar) => {
                const nSongs = ar.albums.reduce((n, al) => n + al.items.length, 0);
                return (
                  <button key={ar.artist} className="artbtn drill"
                    onClick={() => { setSelArtist({ language: lg.language, key: ar.key }); setConfirmDel(null); }}>
                    <span className="artname">{ar.artist}</span>
                    <span className="count">{nSongs}</span>
                    <span className="chev go">›</span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </>
  );
}
