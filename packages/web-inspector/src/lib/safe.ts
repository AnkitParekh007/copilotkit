// ─── Safe-input helpers ───────────────────────────────────────────────────
// Small wrappers that turn degraded-input cases (invalid date strings,
// missing cookies, environments without `document`) into explicit nullable
// returns so call sites can render a placeholder instead of leaking
// "NaNd ago", a `false` cookie match, or worse.

/**
 * Parses a string/number/null/undefined into a Date, returning null on any
 * input that does not produce a valid date. Equivalent to the inline pattern
 * `const d = new Date(s); Number.isNaN(d.getTime()) ? null : d;`.
 */
export function safeDate(
  s: string | number | undefined | null,
): Date | null {
  if (s == null) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Reads a cookie by exact name (no substring matching). Returns the value
 * when present, or null when the cookie is absent or `document` does not
 * exist (SSR / unit-test environments).
 *
 * Prefer this over `document.cookie.includes(...)` so a value like
 * `xcpk_threads_access=1` cannot accidentally satisfy a check for
 * `cpk_threads_access`.
 */
export function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const target = name + "=";
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(target)) return trimmed.slice(target.length);
  }
  return null;
}
