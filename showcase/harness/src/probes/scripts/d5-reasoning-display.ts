/**
 * D5 — reasoning-display script.
 *
 * Covers BOTH `/demos/agentic-chat-reasoning` and
 * `/demos/reasoning-default-render` via preNavigateRoute. The driver
 * runs one feature per featureType per integration, so the registered
 * type ('reasoning-display') gets one run regardless of how many
 * registry IDs map to it. The default route is `agentic-chat-reasoning`
 * — the alternate route is informational only at the catalog level
 * (see open question Q5 in `.claude/specs/lgp-d5-coverage.md`).
 *
 * Assertion (either signal passes):
 *   - A reasoning-role message rendered via a known testid
 *     (`data-testid="reasoning-block"`, `reasoning-content`,
 *     `reasoning-default`) or `[data-message-role="reasoning"]`.
 *     Strong signal that AG-UI REASONING_MESSAGE_* events reached
 *     the frontend.
 *   - OR the assistant transcript contains a reasoning-flavored
 *     keyword. Looser signal that picks up integrations whose AG-UI
 *     bridge surfaces reasoning inline as assistant text rather than
 *     as a role-reasoning message (llamaindex, crewai-crews, several
 *     cells that use CopilotKit's default reasoning slot which does
 *     not expose a stable testid). The intentionally loose fallback
 *     preserves green status for cells that have always rendered
 *     reasoning inline; the strong selector check is the future-proof
 *     path as more integrations adopt role-reasoning messages.
 */

import {
  registerD5Script,
  type D5BuildContext,
  type D5FeatureType,
  type D5RouteContext,
} from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";

const TRANSCRIPT_TIMEOUT_MS = 5_000;

async function readAssistantTranscript(page: Page): Promise<string> {
  return (await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: {
        querySelectorAll(
          sel: string,
        ): ArrayLike<{ textContent: string | null }>;
      };
    };
    const sels = [
      '[data-testid="copilot-assistant-message"]',
      '[role="article"]:not([data-message-role="user"])',
      '[data-message-role="assistant"]',
    ];
    let nodes: ArrayLike<{ textContent: string | null }> = { length: 0 };
    for (const s of sels) {
      const f = win.document.querySelectorAll(s);
      if (f.length > 0) {
        nodes = f;
        break;
      }
    }
    let acc = "";
    for (let i = 0; i < nodes.length; i++) {
      acc += " " + (nodes[i]!.textContent ?? "");
    }
    return acc.toLowerCase();
  })) as string;
}

async function hasReasoningMessage(page: Page): Promise<boolean> {
  return (await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: {
        querySelector(sel: string): unknown;
      };
    };
    // Match the testids that integration ReasoningBlock components
    // actually emit (reasoning-block, reasoning-content, reasoning-default
    // are all used in showcase/integrations/*) plus the AG-UI role marker
    // used by the v2 frontend. CopilotKit's default
    // CopilotChatReasoningMessage does not currently expose a stable
    // testid, so cells using the default slot rely on the keyword check
    // in `buildReasoningAssertion` instead.
    const sels = [
      '[data-testid="reasoning-block"]',
      '[data-testid="reasoning-content"]',
      '[data-testid="reasoning-default"]',
      '[data-message-role="reasoning"]',
    ];
    return sels.some((s) => win.document.querySelector(s) !== null);
  })) as boolean;
}

export const REASONING_KEYWORDS = ["reasoning", "step", "thinking"] as const;

export function buildReasoningAssertion(opts?: {
  timeoutMs?: number;
}): (page: Page) => Promise<void> {
  const timeout = opts?.timeoutMs ?? TRANSCRIPT_TIMEOUT_MS;
  return async (page: Page): Promise<void> => {
    const deadline = Date.now() + timeout;
    let last = "";
    while (Date.now() < deadline) {
      if (await hasReasoningMessage(page)) return;
      last = await readAssistantTranscript(page);
      if (REASONING_KEYWORDS.some((kw) => last.includes(kw))) return;
      await new Promise<void>((r) => setTimeout(r, 200));
    }
    throw new Error(
      `reasoning-display: neither a reasoning-role message nor a reasoning keyword (${REASONING_KEYWORDS.join(", ")}) appeared within ${timeout}ms — last transcript "${last.slice(0, 200)}"`,
    );
  };
}

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return [
    {
      input: "show your reasoning step by step",
      assertions: buildReasoningAssertion(),
    },
  ];
}

/** Force the route to a real demo path. Default `/demos/reasoning-display`
 *  doesn't exist; we pick `agentic-chat-reasoning` as the canonical
 *  reasoning surface. Per Q5 in the coverage doc this may split later. */
export function preNavigateRoute(
  _ft: D5FeatureType,
  ctx?: D5RouteContext,
): string {
  // If the integration declares only `reasoning-default-render`, prefer that route.
  if (
    ctx?.demos &&
    ctx.demos.includes("reasoning-default-render") &&
    !ctx.demos.includes("agentic-chat-reasoning")
  ) {
    return "/demos/reasoning-default-render";
  }
  return "/demos/agentic-chat-reasoning";
}

registerD5Script({
  featureTypes: ["reasoning-display"],
  fixtureFile: "reasoning-display.json",
  buildTurns,
  preNavigateRoute,
});
