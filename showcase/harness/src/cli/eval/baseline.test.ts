import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  transformHarnessResponse,
  loadBaseline,
  saveBaseline,
  captureBaseline,
  type EvalBaseline,
} from "./baseline.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "baseline-test-"));
}

// ---------------------------------------------------------------------------
// transformHarnessResponse
// ---------------------------------------------------------------------------

describe("transformHarnessResponse", () => {
  it("converts API probe list to eval baseline format", () => {
    const response = {
      probes: [
        {
          id: "e2e-deep",
          kind: "e2e",
          lastRun: {
            startedAt: "2025-06-01T00:00:00.000Z",
            finishedAt: "2025-06-01T00:05:00.000Z",
            durationMs: 300_000,
            state: "completed" as const,
            summary: { total: 10, passed: 8, failed: 2 },
          },
        },
        {
          id: "smoke-quick",
          kind: "smoke",
          lastRun: {
            startedAt: "2025-06-01T00:00:00.000Z",
            finishedAt: "2025-06-01T00:01:00.000Z",
            durationMs: 60_000,
            state: "completed" as const,
            summary: { total: 5, passed: 5, failed: 0 },
          },
        },
      ],
    };

    const baseline = transformHarnessResponse(response);

    expect(baseline.version).toBe(1);
    expect(baseline.source).toBe("harness-prod");
    expect(baseline.timestamp).toBeTruthy();
    expect(baseline.results["e2e-deep"]).toBeDefined();
    expect(baseline.results["e2e-deep"]["default"]).toEqual({
      status: "fail",
      total: 10,
      passed: 8,
      failed: 2,
    });
    expect(baseline.results["smoke-quick"]["default"]).toEqual({
      status: "pass",
      total: 5,
      passed: 5,
      failed: 0,
    });
    expect(baseline.summary).toEqual({
      total: 2,
      pass: 1,
      fail: 1,
      skip: 0,
    });
  });

  it("skips probes with null lastRun", () => {
    const response = {
      probes: [
        {
          id: "never-ran",
          kind: "e2e",
          lastRun: null,
        },
        {
          id: "did-run",
          kind: "smoke",
          lastRun: {
            startedAt: "2025-06-01T00:00:00.000Z",
            finishedAt: "2025-06-01T00:01:00.000Z",
            durationMs: 60_000,
            state: "completed" as const,
            summary: { total: 3, passed: 3, failed: 0 },
          },
        },
      ],
    };

    const baseline = transformHarnessResponse(response);

    expect(baseline.results["never-ran"]).toBeUndefined();
    expect(baseline.results["did-run"]).toBeDefined();
    expect(baseline.summary.total).toBe(1);
    expect(baseline.summary.skip).toBe(0);
  });

  it("skips probes with null summary", () => {
    const response = {
      probes: [
        {
          id: "no-summary",
          kind: "e2e",
          lastRun: {
            startedAt: "2025-06-01T00:00:00.000Z",
            finishedAt: "2025-06-01T00:01:00.000Z",
            durationMs: 60_000,
            state: "completed" as const,
            summary: null,
          },
        },
        {
          id: "has-summary",
          kind: "smoke",
          lastRun: {
            startedAt: "2025-06-01T00:00:00.000Z",
            finishedAt: "2025-06-01T00:01:00.000Z",
            durationMs: 60_000,
            state: "completed" as const,
            summary: { total: 2, passed: 2, failed: 0 },
          },
        },
      ],
    };

    const baseline = transformHarnessResponse(response);

    expect(baseline.results["no-summary"]).toBeUndefined();
    expect(baseline.results["has-summary"]).toBeDefined();
    expect(baseline.summary.total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// loadBaseline
// ---------------------------------------------------------------------------

describe("loadBaseline", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when file does not exist", () => {
    const result = loadBaseline(path.join(dir, "nonexistent.json"));
    expect(result).toBeNull();
  });

  it("reads valid JSON from disk", () => {
    const baseline: EvalBaseline = {
      version: 1,
      timestamp: "2025-06-01T00:00:00.000Z",
      source: "harness-prod",
      branch: "",
      base: "",
      level: "deep",
      results: {
        "e2e-deep": {
          default: { status: "pass", total: 10, passed: 10, failed: 0 },
        },
      },
      summary: { total: 1, pass: 1, fail: 0, skip: 0 },
    };
    const filePath = path.join(dir, "baseline.json");
    fs.writeFileSync(filePath, JSON.stringify(baseline));

    const loaded = loadBaseline(filePath);
    expect(loaded).toEqual(baseline);
  });
});

// ---------------------------------------------------------------------------
// saveBaseline
// ---------------------------------------------------------------------------

describe("saveBaseline", () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes valid JSON to disk", () => {
    const baseline: EvalBaseline = {
      version: 1,
      timestamp: "2025-06-01T00:00:00.000Z",
      source: "local-capture",
      branch: "main",
      base: "",
      level: "deep",
      results: {
        "smoke-quick": {
          default: { status: "pass", total: 5, passed: 5, failed: 0 },
        },
      },
      summary: { total: 1, pass: 1, fail: 0, skip: 0 },
    };
    const filePath = path.join(dir, "out.json");

    saveBaseline(baseline, filePath);

    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual(baseline);
  });
});

// ---------------------------------------------------------------------------
// captureBaseline
// ---------------------------------------------------------------------------

describe("captureBaseline", () => {
  let dir: string;
  let outDir: string;

  beforeEach(() => {
    dir = tmpDir();
    outDir = tmpDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it("copies latest eval result as baseline with source: local-capture", () => {
    // Write two fake eval results — captureBaseline should pick the most
    // recently modified one.
    const older: EvalBaseline = {
      version: 1,
      timestamp: "2025-05-01T00:00:00.000Z",
      source: "harness-prod",
      branch: "old",
      base: "",
      level: "deep",
      results: {},
      summary: { total: 0, pass: 0, fail: 0, skip: 0 },
    };
    const newer: EvalBaseline = {
      version: 1,
      timestamp: "2025-06-01T00:00:00.000Z",
      source: "harness-prod",
      branch: "new",
      base: "",
      level: "deep",
      results: {
        "e2e-deep": {
          default: { status: "pass", total: 3, passed: 3, failed: 0 },
        },
      },
      summary: { total: 1, pass: 1, fail: 0, skip: 0 },
    };

    const olderPath = path.join(dir, "eval-2025-05-01.json");
    const newerPath = path.join(dir, "eval-2025-06-01.json");
    fs.writeFileSync(olderPath, JSON.stringify(older));
    // Ensure newer file has a later mtime
    const futureTime = new Date(Date.now() + 2000);
    fs.writeFileSync(newerPath, JSON.stringify(newer));
    fs.utimesSync(newerPath, futureTime, futureTime);

    const baselinePath = path.join(outDir, "baseline.json");
    captureBaseline(dir, baselinePath);

    const captured = JSON.parse(fs.readFileSync(baselinePath, "utf-8"));
    expect(captured.source).toBe("local-capture");
    expect(captured.branch).toBe("new");
    expect(captured.results).toEqual(newer.results);
  });
});
