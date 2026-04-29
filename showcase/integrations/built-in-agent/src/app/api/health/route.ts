import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Health probe consumed by the showcase deploy verify step. Returns 200/ok
// only when the agent can actually run; degrades to 503 when OPENAI_API_KEY
// is missing so CI's `if [ "$HTTP_CODE" = "200" ]` gate cannot pass on a
// non-functional service. Mirrors langgraph-typescript's health pattern.
export function GET(req: NextRequest) {
  const apiKeyPresent = Boolean(process.env.OPENAI_API_KEY);
  const status: "ok" | "degraded" = apiKeyPresent ? "ok" : "degraded";

  const publicResponse: Record<string, unknown> = {
    status,
    integration: "built-in-agent",
    backend: "tanstack-ai",
    timestamp: new Date().toISOString(),
  };

  // Extended diagnostics behind a debug token — exposing whether
  // OPENAI_API_KEY is set on an unauthenticated probe lets attackers monitor
  // key rotation. Ops debugging passes the token via header or query param.
  const token =
    req.headers.get("x-debug-token") || req.nextUrl.searchParams.get("debug");
  if (
    token &&
    process.env.HEALTH_DEBUG_TOKEN &&
    token === process.env.HEALTH_DEBUG_TOKEN
  ) {
    publicResponse.openai_api_key = apiKeyPresent ? "set" : "NOT SET";
  }

  return NextResponse.json(publicResponse, {
    status: apiKeyPresent ? 200 : 503,
  });
}
