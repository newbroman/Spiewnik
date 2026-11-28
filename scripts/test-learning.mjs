// Quick checks for the learning libs: node scripts/test-learning.mjs
import assert from "node:assert/strict";
import { schedule, isStale, isDue, streakDays, sortQueue, localDay } from "../src/lib/srs.js";
import { grade, compareWord, fold, makeGap, makeCloze } from "../src/lib/practice.js";

let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log("ok  -", name); } catch (e) { console.error("FAIL -", name); throw e; } };
const DAY = 864e5;
const now = new Date("2026-11-28T10:00:00Z");

// ---- srs ----------------------------------------------------------------------
test("shaky from new is due within a day", () => {
  const r = schedule(null, "shaky", now);
  assert.equal(r.state, "shaky");
  assert.ok(new Date(r.due_at) - now <= DAY);
  assert.equal(r.reviews, 1);
});
test("again is due in minutes and lowers ease", () => {
  const r = schedule({ ease: 2.5, interval_days: 10, reviews: 3 }, "again", now);
  assert.ok(new Date(r.due_at) - now < 60 * 60 * 1000);
  assert.ok(r.ease < 2.5);
  assert.equal(r.reviews, 4);
});
test("known grows the interval: 1 → 3 → ×ease", () => {
  let r = schedule(null, "known", now); assert.equal(r.interval_days, 1);
  r = schedule(r, "known", now); assert.equal(r.interval_days, 3);
  const r3 = schedule(r, "known", now); assert.ok(r3.interval_days > 3 * 2);
  assert.equal(r3.state, "known");
});
test("shaky after a long interval is still at most 1 day", () => {
  const r = schedule({ ease: 2.6, interval_days: 30, reviews: 5 }, "shaky", now);
  assert.ok(r.interval_days <= 1);
});
test("ease is clamped", () => {
  let r = { ease: 1.3, interval_days: 0 };
  for (let k = 0; k < 5; k++) r = schedule(r, "again", now);
  assert.equal(r.ease, 1.3);
});
test("unknown grade throws", () => assert.throws(() => schedule(null, "meh", now)));
test("stale detection ignores whitespace, catches edits", () => {
  assert.equal(isStale({ line_text: "Ala  ma kota " }, "Ala ma kota"), false);
  assert.equal(isStale({ line_text: "Ala ma kota" }, "Ala ma psa"), true);
  assert.equal(isStale(null, "x"), true);
});
test("isDue", () => {
  assert.equal(isDue({ due_at: new Date(now - 1000).toISOString() }, now), true);
  assert.equal(isDue({ due_at: new Date(+now + DAY).toISOString() }, now), false);
});
test("sortQueue puts shaky first, then most overdue", () => {
  const q = sortQueue([
    { id: 1, state: "known", due_at: "2026-11-01" },
    { id: 2, state: "shaky", due_at: "2026-11-20" },
    { id: 3, state: "shaky", due_at: "2026-11-10" },
  ]);
  assert.deepEqual(q.map((r) => r.id), [3, 2, 1]);
});
test("streak counts back from today, or from yesterday if today is empty", () => {
  const today = new Date(2026, 10, 28, 9);
  const d = (off) => localDay(new Date(2026, 10, 28 - off, 12));
  assert.equal(streakDays([{ day: d(0), lines: 2 }, { day: d(1), lines: 1 }, { day: d(2), lines: 4 }], today), 3);
  assert.equal(streakDays([{ day: d(1), lines: 1 }, { day: d(2), lines: 4 }], today), 2);
  assert.equal(streakDays([{ day: d(2), lines: 4 }], today), 0);
  assert.equal(streakDays([{ day: d(0), lines: 0 }], today), 0);
  assert.equal(streakDays([], today), 0);
});

// ---- grade ----------------------------------------------------------------------
test("fold handles Polish letters NFD misses", () => {
  assert.equal(fold("Łódź"), "lodz");
  assert.equal(fold("żółć"), "zolc");
  assert.equal(fold("Straße"), "strasse");
});
test("compareWord", () => {
  assert.equal(compareWord("już", "już"), "exact");
  assert.equal(compareWord("Już", "już"), "exact");
  assert.equal(compareWord("już", "juz"), "diacritic");
  assert.equal(compareWord("ł", "l"), "diacritic");
  assert.equal(compareWord("kota", "psa"), "wrong");
  assert.equal(compareWord("kota", ""), "wrong");
});
test("perfect line scores 100", () => {
  const g = grade("Gdzie jest mój kot?", "gdzie jest mój kot");
  assert.equal(g.pct, 100); assert.equal(g.exact, 4);
  assert.ok(g.marks.every((m) => m.type === "exact" && m.ok));
});
test("diacritic-only misses are separated and carry the correct form", () => {
  const g = grade("Zażółć gęślą jaźń", "zazolc gesla jazn");
  assert.equal(g.diacritic, 3); assert.equal(g.exact, 0);
  assert.equal(g.marks[0].type, "diacritic"); assert.equal(g.marks[0].w, "Zażółć"); assert.equal(g.marks[0].heard, "zazolc");
  assert.equal(g.pct, 50);
});
test("missing and extra words via alignment", () => {
  const g = grade("ala ma kota", "ala bardzo ma");
  assert.equal(g.exact, 2); assert.equal(g.missing, 1); assert.equal(g.extra, 1);
  assert.deepEqual(g.marks.map((m) => m.type), ["exact", "extra", "exact", "missing"]);
  assert.equal(g.pct, 67);
});
test("order matters (not a bag of words)", () => {
  const g = grade("raz dwa trzy", "trzy dwa raz");
  assert.equal(g.exact, 1); // only one word can align in order
  assert.ok(g.pct < 50);
});
test("repeated words are not double-counted", () => {
  const g = grade("la la la", "la");
  assert.equal(g.exact, 1); assert.equal(g.missing, 2);
});
test("empty heard → all missing", () => {
  const g = grade("ala ma kota", "");
  assert.equal(g.pct, 0); assert.equal(g.missing, 3);
});

// ---- cloze ----------------------------------------------------------------------
test("makeGap hides a content word, not a short one", () => {
  for (let k = 0; k < 20; k++) {
    const g = makeGap("i ja tu na wiatr czekam", Math.random);
    assert.ok(["wiatr", "czekam"].includes(g.answer), g.answer);
    assert.equal(g.before + g.answer + g.after, "i ja tu na wiatr czekam");
  }
  assert.equal(makeGap("o i a"), null);
});
test("makeCloze is stable for a seed and keeps line indices", () => {
  const pl = ["Płynie rzeka", "", "Wiatr wieje mocno"], en = ["The river flows", "", "The wind blows hard"];
  const a = makeCloze(pl, en, 42), b = makeCloze(pl, en, 42);
  assert.deepEqual(a, b);
  assert.deepEqual(a.map((x) => x.idx), [0, 2]);
  assert.equal(a[1].en, "The wind blows hard");
});

console.log(`\n${passed} tests passed`);
