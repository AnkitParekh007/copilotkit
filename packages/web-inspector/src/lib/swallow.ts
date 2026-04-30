// ─── Silent-failure swallow helper ────────────────────────────────────────
// Routes catch sites that intentionally don't surface failures to the user
// (graceful degradation paths) through a single console.warn so the inspector
// always leaves a breadcrumb when something goes wrong silently. Behavior is
// unchanged at the call site; the only effect is one warn-level log line.

export function swallowError(
  err: unknown,
  ctx: string,
  message: string,
): void {
  // eslint-disable-next-line no-console
  console.warn(`[CopilotKit Inspector] ${message}`, { ctx, err });
}
