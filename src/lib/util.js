import { flashGlobal } from "./toast.js";

// If an OpenAI-backed call was refused for hitting the monthly cap (HTTP 429),
// show a friendly toast and tell the caller to stop. `tr` is the view's translator.
export function aiCapHit(r, tr) {
  if (r && r.status === 429) { flashGlobal(tr("aiLimit")); return true; }
  return false;
}

// ============================================================================
//  Śpiewnik — learn a language through song lyrics, line by line.
//
//  Each person signs in and keeps their OWN private library: any artist, any
//  language. Paste a song's original lyric and its English line-for-line, read
//  them side by side, hear the track (YouTube / Spotify), and practise saying
//  the lines aloud. Content lives in your account (Supabase), protected row by
//  row so no one else can see your songs.
// ============================================================================

// Languages offered for a new song. `code` is the translation source code
// (DeepL/Google); `bcp` drives text-to-speech and speech recognition.
export const LANGS = [
  { name: "English", code: "EN", bcp: "en-GB" },
  { name: "Polish", code: "PL", bcp: "pl-PL" },
  { name: "Spanish", code: "ES", bcp: "es-ES" },
  { name: "French", code: "FR", bcp: "fr-FR" },
  { name: "German", code: "DE", bcp: "de-DE" },
  { name: "Italian", code: "IT", bcp: "it-IT" },
  { name: "Portuguese", code: "PT", bcp: "pt-PT" },
  { name: "Dutch", code: "NL", bcp: "nl-NL" },
  { name: "Russian", code: "RU", bcp: "ru-RU" },
  { name: "Ukrainian", code: "UK", bcp: "uk-UA" },
  { name: "Czech", code: "CS", bcp: "cs-CZ" },
  { name: "Swedish", code: "SV", bcp: "sv-SE" },
  { name: "Norwegian", code: "NB", bcp: "nb-NO" },
  { name: "Danish", code: "DA", bcp: "da-DK" },
  { name: "Finnish", code: "FI", bcp: "fi-FI" },
  { name: "Greek", code: "EL", bcp: "el-GR" },
  { name: "Turkish", code: "TR", bcp: "tr-TR" },
  { name: "Japanese", code: "JA", bcp: "ja-JP" },
  { name: "Korean", code: "KO", bcp: "ko-KR" },
  { name: "Chinese", code: "ZH", bcp: "zh-CN" },
];
export const langOf = (name) => LANGS.find((l) => l.name === name) || LANGS[0];

// Native word for "song" in each song language — appended to a web search to
// broaden it beyond the catalogue (e.g. "Kaśka Sochocka piosenka").
export const SONG_WORD = {
  English: "song", Polish: "piosenka", Spanish: "canción", French: "chanson",
  German: "Lied", Italian: "canzone", Portuguese: "canção", Dutch: "lied",
  Russian: "песня", Ukrainian: "пісня", Czech: "píseň", Swedish: "låt",
  Norwegian: "sang", Danish: "sang", Finnish: "laulu", Greek: "τραγούδι",
  Turkish: "şarkı", Japanese: "歌", Korean: "노래", Chinese: "歌曲",
};
export const songWordOf = (name) => SONG_WORD[name] || "song";

// Native word for "lyrics" — for a "search the web for these lyrics" link-out
// (e.g. "Kaśka Sochocka Nocą tekst").
export const LYRICS_WORD = {
  English: "lyrics", Polish: "tekst", Spanish: "letra", French: "paroles",
  German: "Songtext", Italian: "testo", Portuguese: "letra", Dutch: "songtekst",
  Russian: "текст песни", Ukrainian: "текст пісні", Czech: "text", Swedish: "låttext",
  Norwegian: "sangtekst", Danish: "sangtekst", Finnish: "sanat", Greek: "στίχοι",
  Turkish: "şarkı sözleri", Japanese: "歌詞", Korean: "가사", Chinese: "歌词",
};
export const lyricsWordOf = (name) => LYRICS_WORD[name] || "lyrics";

// Hostname for display ("www.tekstowo.pl" → "tekstowo.pl"); "" if not a URL.
export const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };

export const PLAYER_KEY = "spiewnik.player.v1";
export const PROVIDER_KEY = "spiewnik.provider.v1";

export const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
export const esc = (s) => s || "";
// Split on every line-break variant, not just \n — pasted text (phones, PDFs,
// some sites) often uses \r, \r\n or the Unicode line/paragraph separators.
export const SPLIT_RE = new RegExp("\\r\\n|\\r|\\n|\\u2028|\\u2029");
// Normalise any of those to \n so stored lyrics always split cleanly later.
export const normLines = (s) => (s || "").replace(new RegExp("\\r\\n|\\r|\\u2028|\\u2029", "g"), "\n");
// Strip the "copied from" footer lyric sites append (teksciory, azlyrics, …).
export const stripFooter = (s) =>
  (s || "")
    .replace(/\n?\s*Czytaj więcej na[\s\S]*$/i, "")
    .replace(/\n?\s*Read more at[\s\S]*$/i, "")
    .replace(/\s*https?:\/\/\S*utm_source=paste\S*/gi, "")
    .trim();

// The original owner — the only account the one-time Daria import is offered to.

// Map a DB row to the shape the UI uses (camelCase for media ids).
export const fromRow = (r) => ({
  id: r.id, language: r.language || "Polish", artist: r.artist || "", album: r.album || "", title: r.title || "",
  titleEn: r.title_en || "", albumEn: r.album_en || "",
  pl: r.pl || "", en: r.en || "", youtubeId: r.youtube_id, spotifyId: r.spotify_id, position: r.position ?? 0,
});
