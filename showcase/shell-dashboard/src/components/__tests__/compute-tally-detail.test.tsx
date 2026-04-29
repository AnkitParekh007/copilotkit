import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LiveStatusMap, StatusRow } from "@/lib/live-status";
import type { Integration, Feature } from "@/lib/registry";

// Mock registry module — registry.json is generated at build time and
// not available in the test environment.
vi.mock("@/lib/registry", () => ({
  getIntegrations: vi.fn(() => []),
  getFeatures: vi.fn(() => []),
  getFeatureCategories: vi.fn(() => []),
}));

// Mock live-status module before importing the function under test
vi.mock("@/lib/live-status", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/live-status")>(
      "@/lib/live-status",
    );
  return {
    ...actual,
    keyFor: vi.fn(actual.keyFor),
    resolveCell: vi.fn(),
  };
});

import { computeColumnTallyDetail } from "@/components/feature-grid";
import { keyFor, resolveCell } from "@/lib/live-status";
import type { CellState, BadgeRender } from "@/lib/live-status";

const mockedResolveCell = vi.mocked(resolveCell);

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function makeRow(overrides: Partial<StatusRow> = {}): StatusRow {
  return {
    id: "row-1",
    key: "health:test-slug",
    dimension: "health",
    state: "green",
    signal: null,
    observed_at: "2026-04-28T00:00:00Z",
    transitioned_at: "2026-04-28T00:00:00Z",
    fail_count: 0,
    first_failure_at: null,
    ...overrides,
  };
}

function makeBadge(tone: string): BadgeRender {
  return {
    tone: tone as BadgeRender["tone"],
    label: tone,
    tooltip: "",
    row: null,
  };
}

function makeCellState(e2eTone: string): CellState {
  return {
    e2e: makeBadge(e2eTone),
    smoke: makeBadge("gray"),
    health: makeBadge("gray"),
    d5: makeBadge("gray"),
    d6: makeBadge("gray"),
    rollup: e2eTone as CellState["rollup"],
  };
}

function makeIntegration(slug: string, demoIds: string[]): Integration {
  return {
    slug,
    name: slug,
    language: "python",
    backend_url: `https://${slug}.example.com`,
    docs_url: "",
    source_url: "",
    demos: demoIds.map((id) => ({
      id,
      route: `/${id}`,
      command: "",
    })),
  } as Integration;
}

function makeFeature(id: string, name: string): Feature {
  return {
    id,
    name,
    description: "",
    category: "core",
    kind: "standard",
  } as Feature;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                               */
/* ------------------------------------------------------------------ */

describe("computeColumnTallyDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns unknown: true with empty arrays when connection is error", () => {
    const integration = makeIntegration("test-int", ["feat-1"]);
    const features = [makeFeature("feat-1", "Feature 1")];
    const liveStatus: LiveStatusMap = new Map();

    const result = computeColumnTallyDetail(
      integration,
      features,
      liveStatus,
      "error",
    );

    expect(result).toEqual({
      green: [],
      amber: [],
      red: [],
      unknown: true,
    });
    // resolveCell should NOT be called when connection is error
    expect(mockedResolveCell).not.toHaveBeenCalled();
  });

  it("collects health green + 1 e2e green + 1 e2e red", () => {
    const integration = makeIntegration("my-int", ["feat-a", "feat-b"]);
    const features = [
      makeFeature("feat-a", "Feature A"),
      makeFeature("feat-b", "Feature B"),
    ];

    const healthKey = keyFor("health", "my-int");
    const liveStatus: LiveStatusMap = new Map([
      [healthKey, makeRow({ key: healthKey, state: "green" })],
    ]);

    // feat-a e2e → green, feat-b e2e → red
    mockedResolveCell
      .mockReturnValueOnce(makeCellState("green"))
      .mockReturnValueOnce(makeCellState("red"));

    const result = computeColumnTallyDetail(
      integration,
      features,
      liveStatus,
      "live",
    );

    expect(result.unknown).toBe(false);
    expect(result.green).toEqual([
      { label: "Health (Up)", dimension: "health" },
      { label: "Feature A", dimension: "e2e", featureId: "feat-a" },
    ]);
    expect(result.red).toEqual([
      { label: "Feature B", dimension: "e2e", featureId: "feat-b" },
    ]);
    expect(result.amber).toEqual([]);
  });

  it("collects amber e2e features when no health data exists", () => {
    const integration = makeIntegration("no-health", ["feat-x", "feat-y"]);
    const features = [
      makeFeature("feat-x", "Feature X"),
      makeFeature("feat-y", "Feature Y"),
    ];
    const liveStatus: LiveStatusMap = new Map();

    // Both features → amber
    mockedResolveCell
      .mockReturnValueOnce(makeCellState("amber"))
      .mockReturnValueOnce(makeCellState("amber"));

    const result = computeColumnTallyDetail(
      integration,
      features,
      liveStatus,
      "live",
    );

    expect(result.unknown).toBe(false);
    expect(result.green).toEqual([]);
    expect(result.red).toEqual([]);
    expect(result.amber).toEqual([
      { label: "Feature X", dimension: "e2e", featureId: "feat-x" },
      { label: "Feature Y", dimension: "e2e", featureId: "feat-y" },
    ]);
  });

  it("skips features that have no matching demo", () => {
    // Integration only has demo for feat-1, not feat-2
    const integration = makeIntegration("partial", ["feat-1"]);
    const features = [
      makeFeature("feat-1", "Feature 1"),
      makeFeature("feat-2", "Feature 2"),
    ];
    const liveStatus: LiveStatusMap = new Map();

    mockedResolveCell.mockReturnValueOnce(makeCellState("green"));

    const result = computeColumnTallyDetail(
      integration,
      features,
      liveStatus,
      "live",
    );

    expect(result.unknown).toBe(false);
    // Only feat-1 appears (has a demo); feat-2 is absent
    expect(result.green).toEqual([
      { label: "Feature 1", dimension: "e2e", featureId: "feat-1" },
    ]);
    expect(result.amber).toEqual([]);
    expect(result.red).toEqual([]);
    // resolveCell was only called once (for feat-1)
    expect(mockedResolveCell).toHaveBeenCalledTimes(1);
  });

  it("routes degraded health to amber bucket", () => {
    const integration = makeIntegration("degraded-int", []);
    const features: Feature[] = [];

    const healthKey = keyFor("health", "degraded-int");
    const liveStatus: LiveStatusMap = new Map([
      [healthKey, makeRow({ key: healthKey, state: "degraded" })],
    ]);

    const result = computeColumnTallyDetail(
      integration,
      features,
      liveStatus,
      "live",
    );

    expect(result.amber).toEqual([
      { label: "Health (Up)", dimension: "health" },
    ]);
    expect(result.green).toEqual([]);
    expect(result.red).toEqual([]);
    expect(result.unknown).toBe(false);
  });

  it("routes red health to red bucket", () => {
    const integration = makeIntegration("red-int", []);
    const features: Feature[] = [];

    const healthKey = keyFor("health", "red-int");
    const liveStatus: LiveStatusMap = new Map([
      [healthKey, makeRow({ key: healthKey, state: "red" })],
    ]);

    const result = computeColumnTallyDetail(
      integration,
      features,
      liveStatus,
      "live",
    );

    expect(result.red).toEqual([{ label: "Health (Up)", dimension: "health" }]);
    expect(result.green).toEqual([]);
    expect(result.amber).toEqual([]);
    expect(result.unknown).toBe(false);
  });
});
