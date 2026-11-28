// A tiny toast bus so any view (not just those handed `flash`) can raise one.
// The App subscribes once and relays through its own `flash`.
export const toastBus = typeof window !== "undefined" ? new EventTarget() : null;
export const flashGlobal = (m) => { try { toastBus && toastBus.dispatchEvent(new CustomEvent("spiewnik-toast", { detail: m })); } catch {} };
