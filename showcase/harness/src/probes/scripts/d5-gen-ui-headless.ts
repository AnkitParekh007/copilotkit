/**
 * D5 — gen-UI (headless) script.
 *
 * Probes the showcase's `/demos/headless-simple` page against the
 * frontend-defined `show_card` tool (registered via `useComponent` in
 * `headless-simple/page.tsx`). The fixture
 * (`fixtures/d5/gen-ui-headless.json`) makes the agent emit a
 * `show_card` tool call which the headless chat surface materialises
 * into a `ShowCard` React component (titled card with a body
 * paragraph).
 *
 * Two-turn shape (mirrors the recorded fixture):
 *   1. User: "Show me a profile card for Ada Lovelace"
 *      -> Agent calls `show_card({ title, body })` -> frontend renders
 *      `ShowCard` -> second-leg LLM round narrates the rendered card.
 *
 * Acceptance for the headless tier (NOT the custom tier):
 *   - The custom-rendered component must be present in the DOM (NOT
 *     just text). Empty wrappers are explicitly rejected by the
 *     selector cascade in `_gen-ui-shared.ts`.
 *   - Component must have at least one child element (the headless
 *     `ShowCard` has two: the title `<div>` and the body `<div>`).
 *   - The assistant's follow-up narration must reference the rendered
 *     content (the fixture narrates "card above" / Ada's biography).
 *
 * The custom-tier script (`d5-gen-ui-custom.ts`) layers a STRUCTURAL
 * match on top -- for `render_pie_chart` it asserts an SVG with
 * multiple drawing children, which is what makes "custom" stricter
 * than "headless".
 */

import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import type { ConversationTurn } from "../helpers/conversation-runner.js";
import {
  readLastAssistantText,
  waitForGenUiComponent,
} from "./_gen-ui-shared.js";

/**
 * Minimum childElementCount required after the cascade resolves. The
 * `ShowCard` implementation in `headless-simple/page.tsx` renders two
 * divs (title + body), so requiring `>= 1` rejects empty wrappers
 * without coupling to the exact ShowCard layout.
 */
const MIN_CHILDREN = 1;

/**
 * Lower-case tokens we expect to find in the assistant's follow-up
 * text (post-tool-call narration). The fixture writes a short
 * paragraph that mentions "card" and "Ada".
 *
 * We accept EITHER "card" OR "ada" (not both) because the headless
 * surface may combine the tool-call message and narration into a
 * single `[data-message-role="assistant"]` element. When that
 * happens, `readLastAssistantText` captures the full text including
 * the ShowCard's content ("Ada Lovelace", "English mathematician...")
 * which guarantees "ada" is present. Requiring both tokens would
 * be fragile if the narration message arrives as a separate element
 * that only mentions "card" or only mentions "Ada".
 */
const FOLLOWUP_TOKENS_PRIMARY = ["card"] as const;
const FOLLOWUP_TOKENS_SECONDARY = ["ada"] as const;

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return [
    {
      input: "Show me a profile card for Ada Lovelace",
      assertions: async (page) => {
        // 1. Cascade-find the rendered component. Throws on timeout
        //    with a descriptive error so the conversation-runner
        //    surfaces it as the turn's failure_turn.
        const matchedSelector = await waitForGenUiComponent(page);

        // 2. Read the matched node's child count via page.evaluate.
        //    Ensures the component is structurally non-trivial. The
        //    selector cascade already filtered empty wrappers, but
        //    the chat surface may grow content asynchronously.
        const childCount = await readChildCountForSelector(
          page,
          matchedSelector,
        );
        if (childCount < MIN_CHILDREN) {
          throw new Error(
            `gen-ui-headless: matched component ${matchedSelector} has ${childCount} children (expected >= ${MIN_CHILDREN})`,
          );
        }

        // 3. Confirm the assistant followed up with narration that
        //    references the rendered card. Token-level check (NOT a
        //    string-equality assertion) so wording drift across
        //    integrations doesn't fail the probe. We require at
        //    least one primary token OR one secondary token.
        const text = (await readLastAssistantText(page)).toLowerCase();
        const primaryMissing = FOLLOWUP_TOKENS_PRIMARY.filter(
          (tok) => !text.includes(tok),
        );
        const secondaryMissing = FOLLOWUP_TOKENS_SECONDARY.filter(
          (tok) => !text.includes(tok),
        );
        if (primaryMissing.length > 0 && secondaryMissing.length > 0) {
          throw new Error(
            `gen-ui-headless: assistant follow-up missing tokens (need at least one of [${[...FOLLOWUP_TOKENS_PRIMARY, ...FOLLOWUP_TOKENS_SECONDARY].join(", ")}]); last assistant text: ${text.slice(0, 200)}`,
          );
        }
      },
    },
  ];
}

/**
 * Read the child element count of the node matching `selector`.
 *
 * Uses a pre-baked function source with the selector interpolated via
 * JSON.stringify so the page-side query reads the SAME node the
 * cascade matched on the Node side. This eliminates a class of races
 * where an in-page re-lookup resolved a different (more-generic) node.
 *
 * The function is constructed as a plain closure via `new Function` so
 * Playwright serializes just the body source, not Node-side bindings.
 */
async function readChildCountForSelector(
  page: { evaluate<R>(fn: () => R): Promise<R> },
  selector: string,
): Promise<number> {
  const encoded = JSON.stringify(selector);
  // Build the source with selector pre-baked. We rely on `new Function`
  // because the structural Page.evaluate signature is `() => R` — no
  // arg-pass — and we still need the resolved selector to land in the
  // browser context.
  const fn = new Function(`
    const win = globalThis;
    const node = win.document.querySelector(${encoded});
    return node ? node.childElementCount : 0;
  `) as () => number;
  return await page.evaluate(fn);
}

/**
 * Override the default `/demos/<featureType>` route. The fixture is
 * recorded against `/demos/headless-simple` (the actual showcase route
 * that wires the `show_card` `useComponent`), not the literal feature
 * type. Mirrors the mcp-apps -> /demos/subagents pattern documented in
 * the registry comments.
 */
function preNavigateRoute(): string {
  return "/demos/headless-simple";
}

registerD5Script({
  featureTypes: ["gen-ui-headless"],
  fixtureFile: "gen-ui-headless.json",
  buildTurns,
  preNavigateRoute,
});
