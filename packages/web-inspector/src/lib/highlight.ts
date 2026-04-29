// ─── JSON syntax highlighter ─────────────────────────────────────────────────
// Inline-styled so shadow DOM encapsulation preserves colors when the output
// is injected via unsafeHTML. Only for structured data — never raw user HTML.

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function highlightedJson(obj: unknown): string {
  const colors = {
    key: "#5558B2",
    str: "#189370",
    num: "#996300",
    bool: "#c0333a",
    nil: "#838389",
  };
  const json = JSON.stringify(obj, null, 2);
  if (!json) return "";
  const parts: string[] = [];
  let lastIndex = 0;
  const re =
    /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(json)) !== null) {
    parts.push(escapeHtml(json.slice(lastIndex, match.index)));
    const m = match[0];
    let color = colors.num;
    if (m.startsWith('"')) {
      color = m.trimEnd().endsWith(":") ? colors.key : colors.str;
    } else if (m === "true" || m === "false") {
      color = colors.bool;
    } else if (m === "null") {
      color = colors.nil;
    }
    parts.push(`<span style="color:${color}">${escapeHtml(m)}</span>`);
    lastIndex = match.index + m.length;
  }
  parts.push(escapeHtml(json.slice(lastIndex)));
  return parts.join("");
}

export function eventColors(type: string): { bg: string; fg: string } {
  if (type.startsWith("TEXT_MESSAGE")) return { bg: "#EEE6FE", fg: "#57575B" };
  if (type.startsWith("TOOL_CALL"))
    return { bg: "rgba(133,236,206,0.15)", fg: "#189370" };
  if (type.startsWith("STATE"))
    return { bg: "rgba(190,194,255,0.102)", fg: "#5558B2" };
  if (type.startsWith("RUN_") || type.startsWith("STEP_"))
    return { bg: "rgba(255,172,77,0.2)", fg: "#996300" };
  if (type === "ERROR") return { bg: "rgba(250,95,103,0.13)", fg: "#c0333a" };
  return { bg: "#F7F7F9", fg: "#838389" };
}

export function formatTimestamp(ts: string | number): string {
  const date = typeof ts === "number" ? new Date(ts) : new Date(ts);
  if (Number.isNaN(date.getTime())) return "";
  const ms = date.getMilliseconds().toString().padStart(3, "0");
  return (
    date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }) +
    "." +
    ms
  );
}
