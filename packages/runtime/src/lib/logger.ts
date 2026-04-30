import createPinoLogger from "pino";
import pretty from "pino-pretty";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type CopilotRuntimeLogger = ReturnType<typeof createLogger>;

export function createLogger(options?: {
  level?: LogLevel;
  component?: string;
}) {
  const { level, component } = options || {};
  const stream = pretty({ colorize: true });

  const logger = createPinoLogger(
    {
      level: process.env.LOG_LEVEL || level || "error",
      redact: {
        paths: ["pid", "hostname"],
        remove: true,
      },
    },
    stream,
  );

  if (component) {
    return logger.child({ component });
  } else {
    return logger;
  }
}

/**
 * Shared swallow helper for catch sites that intentionally don't surface
 * failures (graceful degradation paths) but should still leave a breadcrumb
 * at warn level. Routed through the package's pino logger so the output
 * respects LOG_LEVEL/redaction config — but kept as a top-level helper so
 * call sites that don't already hold a logger instance don't have to thread
 * one through.
 *
 * The underlying logger is built lazily on first use to keep module-load
 * side effects out of the way of test files that mock `pino` via
 * `vi.mock(...)` (vitest hoists the mock but not the closures it depends
 * on, so eager construction breaks them).
 *
 * Behavior is unchanged at the call site: same return value, same control
 * flow. Only side effect added is a single warn-level log line.
 */
let swallowLogger: CopilotRuntimeLogger | null = null;
function getSwallowLogger(): CopilotRuntimeLogger {
  if (swallowLogger === null) {
    swallowLogger = createLogger({ component: "swallow" });
  }
  return swallowLogger;
}
export const logger = {
  swallow(err: unknown, ctx: string, message: string): void {
    getSwallowLogger().warn({ ctx, err }, message);
  },
};
