/**
 * D5 — shared-state script.
 *
 * Owns BOTH `shared-state-read` and `shared-state-write` feature types.
 * The conversation exercises the agent-write half of bidirectional
 * shared state vs the LangGraph Python `shared_state_read_write`
 * agent: turn 1 the user asks the agent to remember something, the
 * agent calls the backend `set_notes` tool which mutates shared state
 * via `Command(update={'notes': ...})`. Turn 2 the user asks the agent
 * to recall what was remembered — the agent reads its own state and
 * replies. If the state didn't persist between turns, turn 2's
 * assertion fails. That assertion IS the invariant this probe enforces.
 *
 * Inputs are mirrored verbatim from `showcase/harness/fixtures/d5/shared-state.json`:
 *   - Turn 1: `remember that my favorite color is blue`
 *   - Turn 2: `What is my favorite color?` (substring `favorite color`
 *     matches the fixture's `userMessage` matcher; the matcher is
 *     prefix-loose so the question form is fine)
 *
 * Why both feature types in one script: the D5 registry fans out one
 * probe per feature type, but the underlying demo page, LangGraph
 * agent, and aimock fixture are shared. Both `shared-state-read` and
 * `shared-state-write` navigate to `/demos/shared-state-read-write`
 * where the bidirectional `set_notes` agent lives. The registry's
 * single-script / multi-feature-type shape exists for exactly this case.
 *
 * Route override: both feature types map to `/demos/shared-state-read-write`.
 * The legacy split paths `/demos/shared-state-read` (a recipe-editor
 * page with a different agent) and `/demos/shared-state-write` (a TODO
 * stub in most packages) do not match the D5 fixture's conversation
 * shape. `preNavigateRoute` is set explicitly so this script is the
 * single source of truth for its route map.
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
 * Turn 1 user message — verbatim copy of the fixture's `userMessage`
 * match key. Any drift between this constant and the fixture means
 * showcase-aimock will fall through to a different fixture or no
 * fixture at all, and the probe fails opaquely. Keeping it as a
 * named export makes that coupling testable.
 */
export const TURN_1_INPUT = "remember that my favorite color is blue";

/**
 * Turn 2 user message — natural-language question form. The fixture's
 * `userMessage` matcher uses substring `favorite color`, so the
 * question is matched on the user-side and the assistant responds
 * with the canned recall response. The phrasing is intentionally
 * different from turn 1 to read like a normal conversation in the
 * dashboard transcript.
 */
export const TURN_2_INPUT = "What is my favorite color?";

/**
 * Route map. Centralised so the unit test can verify it directly.
 *
 * Both feature types navigate to `/demos/shared-state-read-write`
 * because the working demo page (with bidirectional agent state and
 * the `set_notes` tool the fixture exercises) lives there. The legacy
 * split paths `/demos/shared-state-read` and `/demos/shared-state-write`
 * are either recipe-editor pages (wrong agent, wrong conversation
 * shape) or TODO stubs — neither matches the D5 fixture.
 */
export function preNavigateRoute(featureType: D5FeatureType): string {
  if (
    featureType === "shared-state-read" ||
    featureType === "shared-state-write"
  ) {
    return "/demos/shared-state-read-write";
  }
  // Defensive: registry is closed-typed so callers can't reach this
  // branch through public API, but a future feature-type rename that
  // dropped one of the two would land here. Surface it loudly.
  throw new Error(
    `d5-shared-state: preNavigateRoute called with unsupported featureType "${featureType}"`,
  );
}

/**
 * Read the latest assistant message text from the page DOM. Uses the
 * canonical `[data-testid="copilot-assistant-message"]` selector with
 * `[role="article"]` fallback — same pair the conversation runner
 * uses for its message-count poll, so the assertion stays in lockstep
 * with what the runner considers an assistant message.
 *
 * Returns lowercased text so callers can `.includes(...)` on a stable
 * casing baseline. Returns `""` on read failure — the assertion's
 * `.includes(...)` will then fail with a clear message rather than
 * the assertion throwing on an unexpected null/undefined.
 */
async function readLatestAssistantText(page: Page): Promise<string> {
  // String-templated `new Function` lets us reference the shared
  // selector constants without dragging a `dom` lib dependency into the
  // helper module's tsconfig. JSON.stringify guarantees the embedded
  // selector strings are quoted correctly even if a future selector
  // contains awkward characters.
  const code = `
    (() => {
      const doc = globalThis.document;
      const canonical = doc.querySelectorAll(${JSON.stringify(
        ASSISTANT_MESSAGE_PRIMARY_SELECTOR,
      )});
      let list = canonical;
      if (canonical.length === 0) {
        const fallback = doc.querySelectorAll(${JSON.stringify(
          ASSISTANT_MESSAGE_FALLBACK_SELECTOR,
        )});
        list = fallback.length > 0
          ? fallback
          : doc.querySelectorAll(${JSON.stringify(
            ASSISTANT_MESSAGE_HEADLESS_SELECTOR,
          )});
      }
      if (list.length === 0) return "";
      const last = list[list.length - 1];
      const text = (last && last.textContent) ? last.textContent : "";
      return text.toLowerCase();
    })()
  `;
  const fn = new Function(`return ${code.trim()};`) as () => string;
  return page.evaluate(fn);
}

/**
 * Poll the DOM for non-empty assistant text. Tool-call-only responses
 * (where the LLM calls a tool before producing visible text) cause the
 * conversation runner's settle to fire on the tool-call message whose
 * `textContent` is empty or contains only tool-call metadata. The
 * follow-up text leg (matched by aimock's `toolCallId` fixture) lands
 * shortly after — this helper bridges that gap by re-reading until
 * non-empty text appears.
 *
 * If the first read already returns non-empty text, returns immediately
 * (no polling overhead on the happy path). Polling only kicks in when
 * the initial read is empty — the tool-call-only scenario.
 *
 * Returns the text (lowercased, may be empty if timeout elapses).
 */
const TEXT_POLL_TIMEOUT_MS = 3_000;
const TEXT_POLL_INTERVAL_MS = 200;

async function waitForNonEmptyAssistantText(page: Page): Promise<string> {
  // Fast path: text is already available (no tool-call-only lag).
  const initial = (await readLatestAssistantText(page)) ?? "";
  if (initial.length > 0) return initial;

  // Slow path: tool-call-only message rendered — poll until the text
  // leg arrives and populates the assistant bubble.
  const deadline = Date.now() + TEXT_POLL_TIMEOUT_MS;
  let lastText = "";
  while (Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, TEXT_POLL_INTERVAL_MS));
    lastText = (await readLatestAssistantText(page)) ?? "";
    if (lastText.length > 0) return lastText;
  }
  return lastText;
}

/**
 * Build the two-turn conversation.
 *
 * Turn 1 assertion (relevance): the assistant response must mention
 * "color" or "blue". This is a soft signal — the canned fixture says
 * `Got it — I have noted that your favorite color is blue.` so both
 * substrings match. The check exists to catch a regression where the
 * tool call fired but no follow-up assistant message rendered (e.g.
 * the post-tool-result LLM leg silently failed) — without this
 * assertion the runner would see message-count growth from the tool
 * row alone and report green.
 *
 * Turn 2 assertion (THE invariant): the assistant must reply with
 * "blue" (case-insensitive). If shared state didn't persist between
 * turns the agent has no way to recall the color and this fails.
 * That's the entire point of the D5 shared-state probe.
 */
export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return [
    {
      input: TURN_1_INPUT,
      assertions: async (page: Page) => {
        // The fixture's turn 1 response is a tool call (`set_notes`)
        // followed by a text leg (matched via `toolCallId`). The
        // conversation runner may settle on the tool-call message before
        // the text leg arrives — use waitForNonEmptyAssistantText to
        // bridge the gap when the initial message has no visible text.
        const text = await waitForNonEmptyAssistantText(page);
        if (text.length === 0) {
          throw new Error(
            "turn 1: no assistant message text found after settle",
          );
        }
        // Either substring is acceptable — the canned fixture mentions
        // both, but a plausible alternate phrasing ("Noted, blue.")
        // would still satisfy "blue", and ("I'll remember that color")
        // would still satisfy "color".
        if (!text.includes("color") && !text.includes("blue")) {
          throw new Error(
            `turn 1: assistant response did not mention color/blue (got: ${truncate(text, 200)})`,
          );
        }
      },
    },
    {
      input: TURN_2_INPUT,
      assertions: async (page: Page) => {
        // Turn 2 is a plain text response (no tool call), but poll
        // defensively in case the DOM snapshot is briefly empty while
        // streaming starts.
        const text = await waitForNonEmptyAssistantText(page);
        if (text.length === 0) {
          throw new Error(
            "turn 2: no assistant message text found after settle",
          );
        }
        if (!text.includes("blue")) {
          throw new Error(
            `turn 2: assistant did not recall "blue" — shared state did not persist between turns (got: ${truncate(text, 200)})`,
          );
        }
      },
    },
  ];
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

// Side-effect registration. The dynamic loader in `e2e-deep.ts` imports
// this file at boot; importing it triggers this call which writes the
// script under both feature types in `D5_REGISTRY`.
registerD5Script({
  featureTypes: ["shared-state-read", "shared-state-write"],
  fixtureFile: "shared-state.json",
  buildTurns,
  preNavigateRoute,
});
