// ============================================================================
//  Spaced review — a small SM-2-style scheduler for lyric lines.
//
//  A row (public.line_progress) carries { state, ease, interval_days, due_at,
//  reviews, line_text }. Grades:
//    "again" → see it again very soon (10 minutes), ease drops
//    "shaky" → due in at most a day, ease drops a little
//    "known" → the interval grows (1 → 3 → interval × ease), ease creeps up
//  Pure functions only (no Supabase), so they run under plain node for tests.
// ============================================================================

export const GRADES = ["again", "shaky", "known"];
const DAY = 24 * 60 * 60 * 1000;
const MIN_EASE = 1.3, MAX_EASE = 3.0, START_EASE = 2.5;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** Next schedule for `prev` (a row or null) after `grade`, as of `now` (Date). */
export function schedule(prev, grade, now = new Date()) {
  const ease0 = prev && Number.isFinite(+prev.ease) ? +prev.ease : START_EASE;
  const int0 = prev && Number.isFinite(+prev.interval_days) ? +prev.interval_days : 0;
  const reviews = ((prev && +prev.reviews) || 0) + 1;
  let ease = ease0, interval, state;
  if (grade === "again") {
    ease = clamp(ease0 - 0.2, MIN_EASE, MAX_EASE);
    interval = 10 / (24 * 60);          // 10 minutes
    state = "shaky";
  } else if (grade === "shaky") {
    ease = clamp(ease0 - 0.15, MIN_EASE, MAX_EASE);
    interval = int0 >= 2 ? 1 : 0.5;     // within a day; sooner if it was never solid
    state = "shaky";
  } else if (grade === "known") {
    ease = clamp(ease0 + 0.05, MIN_EASE, MAX_EASE);
    interval = int0 < 1 ? 1 : int0 < 3 ? 3 : Math.round(int0 * ease * 10) / 10;
    interval = Math.min(interval, 365);
    state = "known";
  } else {
    throw new Error("unknown grade: " + grade);
  }
  return {
    state,
    ease: Math.round(ease * 100) / 100,
    interval_days: interval,
    due_at: new Date(now.getTime() + interval * DAY).toISOString(),
    reviews,
  };
}

/** A row is stale when the lyric line it was recorded against has changed. */
export const lineKey = (s) => (s || "").normalize("NFC").replace(/\s+/g, " ").trim();
export const isStale = (row, currentLine) => !row || lineKey(row.line_text) !== lineKey(currentLine);

/** Is the row due by `until` (Date)? */
export const isDue = (row, until = new Date()) => !!row && (!row.due_at || new Date(row.due_at).getTime() <= until.getTime());

/** End of the local day containing `d`. */
export function endOfDay(d = new Date()) {
  const e = new Date(d); e.setHours(23, 59, 59, 999); return e;
}

/** Local calendar day as YYYY-MM-DD (study_days.day). */
export function localDay(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Sort a due queue: shaky first, then the most overdue. */
export function sortQueue(rows) {
  return [...rows].sort((a, b) => {
    const sa = a.state === "shaky" ? 0 : 1, sb = b.state === "shaky" ? 0 : 1;
    if (sa !== sb) return sa - sb;
    return new Date(a.due_at || 0) - new Date(b.due_at || 0);
  });
}

/**
 * Current streak in days from study_days rows ({ day: "YYYY-MM-DD", lines }).
 * Counts back from today; if today has nothing yet, a run ending yesterday
 * still counts (the streak is alive until the day is over).
 */
export function streakDays(rows, today = new Date()) {
  const have = new Set((rows || []).filter((r) => (r.lines || 0) > 0).map((r) => String(r.day).slice(0, 10)));
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12); // noon dodges DST edges
  if (!have.has(localDay(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (have.has(localDay(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
