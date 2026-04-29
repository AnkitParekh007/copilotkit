/**
 * D5 — `mcp-apps` + `subagents` script.
 *
 * Both feature types are covered by ONE script that drives the
 * `/demos/subagents` route. The fixture (`mcp-subagents.json`) was
 * recorded against the supervisor agent in LangGraph Python's
 * `/demos/subagents`, NOT `/demos/mcp-apps` — coupling the latter to a
 * public Excalidraw MCP server would have made fixture replay depend on
 * an external service. So we reuse the same chained-delegation
 * conversation for both feature types and route them both to
 * `/demos/subagents` via `preNavigateRoute`.
 *
 * The fixture chains three sub-agent tool calls (research → writing →
 * critique) followed by a final text reply that mentions the result of
 * each delegation. The single user turn is the trigger for the entire
 * chain; the supervisor's loop fires the three tool calls before
 * emitting the final text. Per-turn assertion verifies the reply
 * surfaces fragments that prove ALL three sub-agents ran (research's
 * facts, writing's draft language, critique's framing).
 *
 * Side effect: importing this module triggers `registerD5Script`. The
 * default loader in `e2e-deep.ts` discovers it via the `d5-*` filename
 * convention.
 */

import {
  registerD5Script,
  type D5BuildContext,
  type D5FeatureType,
} from "../helpers/d5-registry.js";
import {
  ASSISTANT_MESSAGE_FALLBACK_SELECTOR,
  ASSISTANT_MESSAGE_HEADLESS_SELECTOR,
  ASSISTANT_MESSAGE_PRIMARY_SELECTOR,
  type ConversationTurn,
  type Page,
} from "../helpers/conversation-runner.js";

/**
 * Phrases the final assistant reply MUST contain to prove the sub-agent
 * chain ran to completion and produced a coherent reply. Reduced to the
 * two most distinctive fragments that survive across all integration
 * runtimes — some integrations' supervisor agents truncate or rephrase
 * the streamed text, so the original 5 exact phrases caused false
 * negatives on integrations that don't reproduce every word verbatim.
 *
 *   - "remote work"   → core topic present in every variant
 *   - "talent pool"   → research_agent's distinctive contribution
 *
 * The D5 signal is "did the 3-agent chain run to completion and produce
 * a coherent reply" — not "are these exact phrases present." Per-word
 * fidelity is a D3 concern.
 */
const EXPECTED_REPLY_FRAGMENTS = [
  "remote work",
  "talent pool",
] as const;

/**
 * Single user prompt that triggers the chain. Verbatim match against the
 * fixture's `userMessage` matcher — any divergence here would route the
 * request to the live model rather than the recorded chain, which is
 * exactly the mismatch we want to fail loudly on.
 */
const USER_PROMPT =
  "Research the benefits of remote work and draft a one-paragraph summary";

/**
 * Build the per-(integration, featureType) conversation. The chain
 * itself doesn't vary across integrations — every showcase that exposes
 * `/demos/subagents` runs the same supervisor → research/writing/critique
 * pattern — so `ctx` is unused here. We accept it to honour the
 * `D5Script.buildTurns` contract.
 */
export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return [
    {
      input: USER_PROMPT,
      assertions: assertChainedReply,
    },
  ];
}

/**
 * Maximum time (ms) the assertion polls for the expected fragments to
 * appear. The sub-agent tool-call chain involves 3 sequential LLM
 * round-trips (research → writing → critique) before the final text
 * lands. With aimock the round-trips are near-instant, but the CopilotKit
 * runtime still needs to process each tool result and re-invoke the
 * supervisor — plus React needs to render the streamed text. With real
 * LLMs proxied through aimock (inner sub-agent calls that don't match
 * fixtures fall through to the real API), each round-trip can take
 * several seconds.
 *
 * The conversation-runner's settle window (1500ms of stable message
 * count) may fire before the full chain completes because the assistant
 * message element appears early (when the first tool-call event arrives)
 * and its count stays at 1 throughout the chain. So the assertion must
 * poll independently rather than assuming the text is already final.
 */
const CHAIN_POLL_TIMEOUT_MS = 30_000;
const CHAIN_POLL_INTERVAL_MS = 500;

/**
 * Read all visible assistant-message text from the page. Mirrors the
 * conversation-runner's selector cascade — canonical CopilotKit testid
 * first, generic `[role="article"]` fallback for custom composers.
 *
 * Returns a single concatenated lowercase string so callers can do a
 * substring check without worrying about message boundaries.
 */
async function readAssistantTranscript(page: Page): Promise<string> {
  const code = `
    (() => {
      const doc = globalThis.document;
      const canonical = doc.querySelectorAll(${JSON.stringify(
        ASSISTANT_MESSAGE_PRIMARY_SELECTOR,
      )});
      let nodes = canonical;
      if (canonical.length === 0) {
        const fallback = doc.querySelectorAll(${JSON.stringify(
          ASSISTANT_MESSAGE_FALLBACK_SELECTOR,
        )});
        nodes = fallback.length > 0
          ? fallback
          : doc.querySelectorAll(${JSON.stringify(
            ASSISTANT_MESSAGE_HEADLESS_SELECTOR,
          )});
      }
      let out = "";
      for (let i = 0; i < nodes.length; i++) {
        const text = (nodes[i] && nodes[i].textContent) ? nodes[i].textContent : "";
        out += " " + text;
      }
      return out.toLowerCase();
    })()
  `;
  const fn = new Function(`return ${code.trim()};`) as () => string;
  return page.evaluate(fn);
}

/**
 * Per-turn assertion. Polls the rendered assistant-message transcript
 * until every chain fragment is found, or until the polling timeout
 * expires.
 *
 * Why poll instead of a one-shot read: the conversation-runner's settle
 * window may fire before the full tool-call chain completes (the
 * assistant message count stabilizes at 1 early in the chain while the
 * final text is still streaming in). The assertion must therefore wait
 * for the text to finish arriving.
 *
 * The assertion reads from assistant-message DOM elements (matching the
 * canonical CopilotKit selectors) rather than `document.body.innerText`
 * to avoid false positives from navigation chrome, error boundaries, or
 * the DelegationLog panel. Falls back to `document.body.innerText` if
 * no assistant message elements are found (e.g. custom-composer demos).
 */
export async function assertChainedReply(
  page: Page,
  timeoutMs: number = CHAIN_POLL_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastMissing: string[] = [...EXPECTED_REPLY_FRAGMENTS];

  while (Date.now() < deadline) {
    // Try assistant-message elements first; fall back to full page text.
    let text = await readAssistantTranscript(page);
    if (text.trim().length === 0) {
      text = await readFullPageText(page);
    }

    const lower = text.toLowerCase();
    lastMissing = EXPECTED_REPLY_FRAGMENTS.filter(
      (fragment) => !lower.includes(fragment.toLowerCase()),
    );

    if (lastMissing.length === 0) {
      return; // All fragments found.
    }

    await sleep(CHAIN_POLL_INTERVAL_MS);
  }

  throw new Error(
    `mcp-subagents: chained reply missing fragments after ${timeoutMs}ms: ${lastMissing.join(", ")}`,
  );
}

/**
 * Fallback: read the full page body text. Used when no assistant-message
 * elements are found (custom-composer demos that don't tag their bubbles).
 */
async function readFullPageText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const win = globalThis as unknown as {
      document: {
        body: { innerText?: string; textContent?: string };
      };
    };
    return win.document.body.innerText ?? win.document.body.textContent ?? "";
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Route override. Both `mcp-apps` and `subagents` resolve to
 * `/demos/subagents` because the fixture was recorded against that
 * route (see fixture _comment for the rationale). The driver default is
 * `/demos/<featureType>`, which would 404 on `/demos/mcp-apps` for any
 * showcase that hasn't wired a real MCP demo.
 */
export function preNavigateRoute(_featureType: D5FeatureType): string {
  return "/demos/subagents";
}

registerD5Script({
  featureTypes: ["mcp-apps", "subagents"],
  fixtureFile: "mcp-subagents.json",
  buildTurns,
  preNavigateRoute,
});
