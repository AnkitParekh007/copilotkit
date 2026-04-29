/**
 * D5 — `hitl-steps` script.
 *
 * Drives the step-selection HITL flow at `/demos/hitl` against the
 * langgraph-python reference (and any integration that registers
 * the same feature). Mirrors `showcase/harness/fixtures/d5/hitl-steps.json`:
 *
 *   - User: "Please plan a trip to mars in 5 steps"
 *   - Agent (first leg): tool-calls `generate_task_steps` with 5 steps.
 *     The frontend renders a `StepsFeedback` card inline in the chat via
 *     `useHumanInTheLoop`.
 *   - Probe: clicks the "Confirm" button. Tool result resolves with
 *     `{ accepted: true, steps: [...] }`.
 *   - Agent (second leg): emits a follow-up that references Mars.
 *
 * Route override: feature type `hitl-steps` would default to
 * `/demos/hitl-steps`, which doesn't exist. The reference showcase
 * exposes the demo at `/demos/hitl`.
 *
 * Assertion: the follow-up assistant message references "Mars"
 * (case-insensitive). That's the load-bearing token from the fixture —
 * any drift that drops it signals a regression in agent continuation.
 */

import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5Script } from "../helpers/d5-registry.js";
import {
  selectorCascade,
  readAssistantCount,
  waitForNextAssistantMessage,
  HITL_CARD_TIMEOUT_MS,
} from "./_hitl-shared.js";
import type { Page as HitlPage } from "./_hitl-shared.js";
import type { Page as ConversationPage } from "../helpers/conversation-runner.js";

const REFERENCE_TOKENS = ["Mars"] as const;

const STEPS_CARD_SELECTORS = [
  '[data-testid="select-steps"]',
  '[role="form"]:has([data-testid="step-item"])',
] as const;

/**
 * Confirm-button cascade. The reference `StepsFeedback` component (via
 * `useHumanInTheLoop`) disables the Confirm/Reject buttons with
 * `disabled={status !== "executing"}` until the tool call is ready for
 * user input. The `:not([disabled])` suffix on each entry ensures the
 * cascade waits for the button to become enabled (status transitions to
 * "executing") before resolving — without it, `waitForSelector` would
 * resolve on a visible-but-disabled button and the subsequent click
 * would silently no-op (browsers do not dispatch click events on
 * disabled buttons).
 *
 * The `StepSelector` component (via `useLangGraphInterrupt`) uses
 * "Perform Steps" with no disabled attribute — it resolves immediately
 * if that path renders.
 */
const CONFIRM_BUTTON_SELECTORS = [
  'button:has-text("Confirm"):not([disabled])',
  'button:has-text("Perform Steps"):not([disabled])',
  '[data-testid="select-steps"] button:not(:has-text("Reject")):not([disabled])',
] as const;

const script: D5Script = {
  featureTypes: ["hitl-steps"],
  fixtureFile: "hitl-steps.json",
  preNavigateRoute: () => "/demos/hitl",
  buildTurns: () => [
    {
      input: "Please plan a trip to mars in 5 steps",
      responseTimeoutMs: 60_000,
      assertions: async (page: ConversationPage) => {
        const hitlPage = page as unknown as HitlPage;
        if (typeof (hitlPage as { click?: unknown }).click !== "function") {
          throw new Error(
            "d5-hitl-steps: page is missing click() — cannot drive HITL step-selection",
          );
        }
        const baselineCount = await readAssistantCount(hitlPage);
        await selectorCascade(
          hitlPage,
          STEPS_CARD_SELECTORS,
          "steps card",
          HITL_CARD_TIMEOUT_MS,
        );
        const confirmSelector = await selectorCascade(
          hitlPage,
          CONFIRM_BUTTON_SELECTORS,
          "confirm button",
          HITL_CARD_TIMEOUT_MS,
        );
        await hitlPage.click(confirmSelector);
        const followup = await waitForNextAssistantMessage(
          hitlPage,
          baselineCount,
        );
        for (const token of REFERENCE_TOKENS) {
          if (!followup.toLowerCase().includes(token.toLowerCase())) {
            throw new Error(
              `assistant follow-up missing token "${token}" — got: ${followup.slice(0, 200)}`,
            );
          }
        }
      },
    },
  ],
};

registerD5Script(script);

export const __d5HitlStepsScript = script;
