// ============================================================================
//  Learning data layer: line progress (spaced review), study days, vocab and
//  the word-gloss call. Tables come from supabase/migrations/002_learning.sql.
//  Every call degrades gracefully if the migration hasn't been run yet.
// ============================================================================
import { useEffect, useState } from "react";
import { supabase, apiHeaders } from "../supabase.js";
import { SPLIT_RE } from "./util.js";
import { schedule, isStale, isDue, endOfDay, localDay, streakDays } from "./srs.js";

// Fired after any progress / study-day / vocab change so open widgets refresh.
const bus = typeof window !== "undefined" ? new EventTarget() : null;
export const LEARN_EVT = "spiewnik-learning";
const changed = () => { try { bus && bus.dispatchEvent(new Event(LEARN_EVT)); } catch {} };
export function useLearningChanges(fn) {
  useEffect(() => {
    if (!bus) return;
    bus.addEventListener(LEARN_EVT, fn);
    return () => bus.removeEventListener(LEARN_EVT, fn);
  });
}

async function uid() {
  try { const { data } = await supabase.auth.getSession(); return data.session?.user?.id || null; } catch { return null; }
}

/** The lyric line at idx in a song, trimmed (what line_text is compared to). */
export const songLine = (song, idx) => (((song && song.pl) || "").split(SPLIT_RE)[idx] || "").trim();
export const songTrans = (song, idx) => (((song && song.en) || "").split(SPLIT_RE)[idx] || "").trim();

// ---- line_progress ------------------------------------------------------------

/** Map line_idx → row for one song, with stale rows (edited lyrics) dropped. */
export async function loadSongProgress(song) {
  const { data, error } = await supabase.from("line_progress").select("*").eq("song_id", String(song.id));
  if (error || !data) return {};
  const out = {};
  for (const r of data) if (!isStale(r, songLine(song, r.line_idx))) out[r.line_idx] = r;
  return out;
}

/** All non-stale progress rows for songs the user still has. */
export async function loadAllProgress(songs) {
  const { data, error } = await supabase.from("line_progress").select("*");
  if (error || !data) return [];
  const byId = new Map((songs || []).map((s) => [String(s.id), s]));
  return data.filter((r) => { const s = byId.get(r.song_id); return s && !isStale(r, songLine(s, r.line_idx)); })
    .map((r) => ({ ...r, song: byId.get(r.song_id) }));
}

/** Lines due by the end of today, across all songs. */
export async function loadDue(songs) {
  const until = endOfDay();
  return (await loadAllProgress(songs)).filter((r) => isDue(r, until));
}

/**
 * Grade a line ("again" | "shaky" | "known"), schedule it and save it.
 * `prev` is the current row if known (saves a round trip). Returns the new row,
 * or null on failure. Also counts one line towards today's study_days.
 */
export async function gradeLine(song, idx, grade, prev) {
  const user_id = await uid();
  if (!user_id) return null;
  const line_text = songLine(song, idx);
  const base = prev && !isStale(prev, line_text) ? prev : null;
  const row = {
    user_id, song_id: String(song.id), line_idx: idx, line_text,
    ...schedule(base, grade), updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("line_progress").upsert(row, { onConflict: "user_id,song_id,line_idx" });
  if (error) return null;
  bumpStudyDay(1);
  changed();
  return row;
}

/** Remove the Known/Shaky mark from a line. */
export async function clearLine(song, idx) {
  const { error } = await supabase.from("line_progress").delete().eq("song_id", String(song.id)).eq("line_idx", idx);
  if (!error) changed();
  return !error;
}

// ---- study_days -----------------------------------------------------------------

export async function bumpStudyDay(n = 1) {
  const day = localDay();
  const { error } = await supabase.rpc("bump_study_day", { p_day: day, p_n: n });
  if (!error) { changed(); return; }
  // Fallback if the function is missing: read-then-write (not atomic, fine for one device).
  const user_id = await uid();
  if (!user_id) return;
  const { data } = await supabase.from("study_days").select("lines").eq("day", day).maybeSingle();
  await supabase.from("study_days").upsert({ user_id, day, lines: ((data && data.lines) || 0) + n }, { onConflict: "user_id,day" });
  changed();
}

export async function loadStudyDays(limitDays = 400) {
  const since = new Date(); since.setDate(since.getDate() - limitDays);
  const { data, error } = await supabase.from("study_days").select("day,lines").gte("day", localDay(since));
  return error || !data ? [] : data;
}

/** { streak, known, due, today } for the stats strip. */
export async function loadStats(songs) {
  const [rows, days] = await Promise.all([loadAllProgress(songs), loadStudyDays()]);
  const until = endOfDay();
  const today = days.find((d) => String(d.day).slice(0, 10) === localDay());
  return {
    streak: streakDays(days),
    known: rows.filter((r) => r.state === "known").length,
    due: rows.filter((r) => isDue(r, until)).length,
    today: (today && today.lines) || 0,
  };
}

/** Live count of lines due today (refreshes on any learning change). */
export function useDueCount(songs) {
  const [n, setN] = useState(0);
  const [tick, setTick] = useState(0);
  useLearningChanges(() => setTick((x) => x + 1));
  const key = (songs || []).map((s) => s.id + ":" + (s.pl || "").length).join(",");
  useEffect(() => {
    let ok = true;
    loadDue(songs).then((r) => { if (ok) setN(r.length); }).catch(() => {});
    return () => { ok = false; };
  }, [key, tick]);
  return n;
}

// ---- vocab ------------------------------------------------------------------------

export async function loadVocab(songId) {
  let q = supabase.from("vocab").select("*").order("created_at", { ascending: false });
  if (songId != null) q = q.eq("song_id", String(songId));
  const { data, error } = await q;
  return error || !data ? [] : data;
}

/** Save a word. → "saved" | "exists" | "error" */
export async function saveVocab({ word, lemma, gloss, note, pos, song, line }) {
  const user_id = await uid();
  if (!user_id) return "error";
  const row = {
    user_id, word, lemma: (lemma || word || "").trim().toLowerCase(), gloss: gloss || null, note: note || null,
    pos: pos || null, song_id: song ? String(song.id) : null, line: line || null, language: (song && song.language) || "",
  };
  const { error } = await supabase.from("vocab").insert(row);
  if (!error) { changed(); return "saved"; }
  return error.code === "23505" ? "exists" : "error";
}

export async function deleteVocab(id) {
  const { error } = await supabase.from("vocab").delete().eq("id", id);
  if (!error) changed();
  return !error;
}

// ---- gloss (POST /api/ai, op "gloss") ---------------------------------------------

/**
 * Ask the server for a dictionary-style gloss of `word` in context.
 * → { ok: true, lemma, pos, gloss, note } | { ok: false, reason: "cap" | "error" }
 * `aiCapHit` is passed in so the 429 toast uses the caller's translator.
 */
export async function fetchGloss({ word, line, language, target }, aiCapHit, tr) {
  try {
    const r = await fetch("/api/ai?op=gloss", {
      method: "POST", headers: { "Content-Type": "application/json", ...apiHeaders() },
      body: JSON.stringify({ op: "gloss", word: (word || "").slice(0, 40), line: (line || "").slice(0, 300), language, target }),
    });
    if (aiCapHit(r, tr)) return { ok: false, reason: "cap" };
    if (!r.ok) return { ok: false, reason: "error" };
    const j = await r.json();
    if (!j || (!j.gloss && !j.lemma)) return { ok: false, reason: "error" };
    return { ok: true, lemma: j.lemma || word, pos: j.pos || "", gloss: j.gloss || "", note: j.note || "" };
  } catch {
    return { ok: false, reason: "error" };
  }
}
