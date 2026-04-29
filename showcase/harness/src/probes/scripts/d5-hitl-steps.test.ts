/**
 * Tests for `d5-hitl-steps.ts`.
 *
 * Mirrors `d5-hitl-text-input.test.ts` — see that file for the
 * rationale on registry side-effect handling and Page mocking.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  __clearD5RegistryForTesting,
  D5_REGISTRY,
} from "../helpers/d5-registry.js";
import { demosToFeatureTypes } from "../helpers/d5-feature-mapping.js";

describe("d5-hitl-steps script", () => {
  beforeEach(() => {
    __clearD5RegistryForTesting();
  });

  it("registers under the hitl-steps feature type with the right fixture file", async () => {
    const mod = await import("./d5-hitl-steps.js");
    const script = mod.__d5HitlStepsScript;

    expect(script.featureTypes).toEqual(["hitl-steps"]);
    expect(script.fixtureFile).toBe("hitl-steps.json");
    expect(script.preNavigateRoute?.("hitl-steps")).toBe("/demos/hitl");
  });

  it("buildTurns produces a single turn whose input matches the fixture user message", async () => {
    const mod = await import("./d5-hitl-steps.js");
    const script = mod.__d5HitlStepsScript;
    const turns = script.buildTurns({
      integrationSlug: "langgraph-python",
      featureType: "hitl-steps",
      baseUrl: "https://example.test",
    });

    expect(turns).toHaveLength(1);
    expect(turns[0]!.input).toBe("Please plan a trip to mars in 5 steps");
    expect(turns[0]!.assertions).toBeTypeOf("function");
  });

  it("assertion finds steps card, clicks confirm, and passes when follow-up contains 'Mars'", async () => {
    const mod = await import("./d5-hitl-steps.js");
    const script = mod.__d5HitlStepsScript;
    const turns = script.buildTurns({
      integrationSlug: "langgraph-python",
      featureType: "hitl-steps",
      baseUrl: "https://example.test",
    });

    const calls: { method: string; selector: string }[] = [];
    let evaluateCount = 0;
    const page = {
      async waitForSelector(selector: string) {
        calls.push({ method: "waitForSelector", selector });
      },
      async fill() {},
      async press() {},
      async click(selector: string) {
        calls.push({ method: "click", selector });
      },
      async evaluate<R>(_fn: () => R): Promise<R> {
        evaluateCount += 1;
        if (evaluateCount === 1) return 1 as unknown as R;
        if (evaluateCount === 2) return 2 as unknown as R;
        return "Great choices! I will proceed with executing the selected steps for your trip to Mars." as unknown as R;
      },
    };

    await turns[0]!.assertions!(page);
    expect(
      calls.some(
        (c) =>
          c.method === "waitForSelector" && c.selector.includes("select-steps"),
      ),
    ).toBe(true);
    expect(calls.some((c) => c.method === "click")).toBe(true);
  });

  it("assertion throws when the follow-up message is missing 'Mars'", async () => {
    const mod = await import("./d5-hitl-steps.js");
    const script = mod.__d5HitlStepsScript;
    const turns = script.buildTurns({
      integrationSlug: "langgraph-python",
      featureType: "hitl-steps",
      baseUrl: "https://example.test",
    });

    let evaluateCount = 0;
    const page = {
      async waitForSelector() {},
      async fill() {},
      async press() {},
      async click() {},
      async evaluate<R>(_fn: () => R): Promise<R> {
        evaluateCount += 1;
        if (evaluateCount === 1) return 1 as unknown as R;
        if (evaluateCount === 2) return 2 as unknown as R;
        return "Done." as unknown as R;
      },
    };

    await expect(turns[0]!.assertions!(page)).rejects.toThrow(/missing token/);
  });
});

describe("d5-hitl-steps feature mapping", () => {
  it("demosToFeatureTypes(['hitl']) includes hitl-steps, not hitl-text-input", () => {
    const result = demosToFeatureTypes(["hitl"]);
    expect(result).toContain("hitl-steps");
    expect(result).not.toContain("hitl-text-input");
  });

  it("demosToFeatureTypes(['hitl-in-chat']) still maps to hitl-text-input", () => {
    const result = demosToFeatureTypes(["hitl-in-chat"]);
    expect(result).toContain("hitl-text-input");
    expect(result).not.toContain("hitl-steps");
  });
});

describe("d5-hitl-steps registry side-effect", () => {
  it("registerD5Script populates the registry for hitl-steps", async () => {
    __clearD5RegistryForTesting();
    const mod = await import("./d5-hitl-steps.js");
    const { registerD5Script } = await import("../helpers/d5-registry.js");
    registerD5Script(mod.__d5HitlStepsScript);
    expect(D5_REGISTRY.has("hitl-steps")).toBe(true);
    const entry = D5_REGISTRY.get("hitl-steps");
    expect(entry).toBe(mod.__d5HitlStepsScript);
  });
});
