/**
 * Eval orchestrator — registers the `eval` subcommand and implements the
 * full evaluation pipeline: scope detection, baseline comparison, tiered
 * test execution, result collection, and verdict formatting.
 *
 * Pipeline:
 *   1. Parse CLI options (--d5/--d6, --pr, --scope, --parallel, etc.)
 *   2. Optionally create git worktree for PR evaluation
 *   3. Detect affected scope via git diff
 *   4. Load/pull baseline for comparison
 *   5. Start affected services + aimock via lifecycle
 *   6. Wait for health
 *   7. Run tiered tests
 *   8. Collect & format results
 *   9. Save results + optional baseline capture
 *  10. Cleanup
 */

import { Command, Option } from "commander";
import { execSync } from "node:child_process";
import path from "node:path";

import { loadConfig } from "../config.js";
import { up, down, isRunning } from "../lifecycle.js";
import { createLogger } from "../../logger.js";

// Sibling modules created by other blitz agents — imports written against
// the agreed interfaces. These will not resolve until the sibling branches
// are merged into the integration branch.
import { classifyScope, type ScopeResult } from "./scope.js";
import {
  pullBaseline,
  loadBaseline,
  captureBaseline,
  type EvalBaseline,
} from "./baseline.js";
import {
  collectResults,
  formatMatrix,
  formatVerdict,
  computeRegressions,
  saveResults,
  type EvalResults,
} from "./matrix.js";
import {
  runTiered,
  type TieredRunResult,
  type RunOptions,
} from "./runner.js";

const log = createLogger({ component: "eval" });

// ---------------------------------------------------------------------------
// CLI options interface
// ---------------------------------------------------------------------------

interface EvalOptions {
  level?: string;
  d5?: boolean;
  d6?: boolean;
  pr?: string;
  branch?: string;
  scope?: string;
  parallel?: string;
  baseline?: string;
  keep?: boolean;
  json?: boolean;
  timeout?: string;
  slug?: string;
  tier?: string;
  failFast?: boolean; // commander negates --no-fail-fast to failFast: false
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerEvalCommand(program: Command): void {
  program
    .command("eval")
    .description(
      "Run the D5 evaluation matrix against showcase integrations",
    )
    .addOption(
      new Option("--level <level>", "probe depth")
        .choices(["d5", "d6"])
        .default("d5"),
    )
    .option("--d5", "shorthand for --level d5")
    .option("--d6", "shorthand for --level d6")
    .option("--pr <number>", "fetch PR into worktree and eval")
    .option("--branch <name>", "eval a specific branch in a worktree")
    .option("--scope <mode>", "affected or all", "affected")
    .option("--parallel <n>", "max concurrent test runners", "4")
    .option("--baseline <action>", "capture or compare")
    .option("--keep", "leave containers running after eval")
    .option("--json", "JSON output for CI")
    .option("--timeout <ms>", "per-test timeout", "45000")
    .option("--slug <slugs>", "override scope (comma-separated)")
    .option("--tier <n>", "run only tiers 1 through N")
    .option("--no-fail-fast", "don't stop on Tier 1 failure")
    .action(async (opts: EvalOptions) => {
      await runEval(opts);
    });
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function runEval(opts: EvalOptions): Promise<void> {
  const config = loadConfig();

  // -- 1. Resolve level ------------------------------------------------------
  const shorthands = [opts.d5, opts.d6].filter(Boolean);
  if (shorthands.length > 1) {
    console.error("Error: specify at most one of --d5, --d6");
    process.exit(1);
  }
  const shorthand = opts.d5 ? "d5" : opts.d6 ? "d6" : null;
  if (shorthand && opts.level && opts.level !== "d5") {
    console.error(
      "Error: --level and shorthand flags (--d5, --d6) are mutually exclusive",
    );
    process.exit(1);
  }
  const level = shorthand ?? opts.level ?? "d5";

  const parallel = parseInt(opts.parallel ?? "4", 10);
  const timeout = parseInt(opts.timeout ?? "45000", 10);
  const maxTier = opts.tier ? parseInt(opts.tier, 10) : undefined;
  const failFast = opts.failFast !== false; // default true; --no-fail-fast sets to false

  log.info("eval starting", {
    level,
    parallel,
    timeout,
    scope: opts.scope,
    baseline: opts.baseline,
    failFast,
  });

  // -- 2. PR worktree setup --------------------------------------------------
  let worktreeDir: string | null = null;
  let originalCwd: string | null = null;

  if (opts.pr) {
    log.info("setting up PR worktree", { pr: opts.pr });
    const prNumber = opts.pr;
    const worktreePath = path.join(
      config.showcaseDir,
      "..",
      `.eval-pr-${prNumber}`,
    );
    worktreeDir = worktreePath;
    originalCwd = process.cwd();

    try {
      execSync(`git fetch origin pull/${prNumber}/head:eval-pr-${prNumber}`, {
        cwd: config.showcaseDir,
        stdio: "pipe",
        encoding: "utf-8",
      });
      execSync(
        `git worktree add ${worktreePath} eval-pr-${prNumber}`,
        {
          cwd: config.showcaseDir,
          stdio: "pipe",
          encoding: "utf-8",
        },
      );
      process.chdir(worktreePath);
      log.info("worktree created", { path: worktreePath });
    } catch (err) {
      console.error(
        `Failed to set up PR worktree: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  } else if (opts.branch) {
    log.info("setting up branch worktree", { branch: opts.branch });
    const worktreePath = path.join(
      config.showcaseDir,
      "..",
      `.eval-branch-${opts.branch.replace(/\//g, "-")}`,
    );
    worktreeDir = worktreePath;
    originalCwd = process.cwd();

    try {
      execSync(`git worktree add ${worktreePath} ${opts.branch}`, {
        cwd: config.showcaseDir,
        stdio: "pipe",
        encoding: "utf-8",
      });
      process.chdir(worktreePath);
      log.info("worktree created", { path: worktreePath });
    } catch (err) {
      console.error(
        `Failed to set up branch worktree: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  }

  // -- 3. Detect scope -------------------------------------------------------
  const allSlugs = Object.keys(config.localPorts);
  let scopeResult: ScopeResult;

  if (opts.slug) {
    const slugs = opts.slug.split(",").map((s) => s.trim()).filter(Boolean);
    scopeResult = { slugs, mode: "all", reason: `manual override: ${slugs.join(", ")}` };
    log.info("manual scope override", { slugs });
  } else if (opts.scope === "all") {
    scopeResult = { slugs: [...allSlugs], mode: "all", reason: "user specified --scope all" };
    log.info("scope: all", { count: allSlugs.length });
  } else {
    let diffOutput = "";
    try {
      diffOutput = execSync("git diff --name-only origin/main...HEAD", {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    } catch {
      diffOutput = execSync("git diff --name-only origin/main HEAD", {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    }
    const changedFiles = diffOutput.split("\n").map((f) => f.trim()).filter(Boolean);
    scopeResult = classifyScope(changedFiles, allSlugs);
    log.info("scope detected", { mode: scopeResult.mode, slugs: scopeResult.slugs });
  }

  if (scopeResult.slugs.length === 0) {
    console.log("\n  No showcase integrations affected by this change.\n");
    await cleanup(worktreeDir, originalCwd, config.showcaseDir);
    return;
  }

  console.log(
    `\n  \x1b[36mEval scope:\x1b[0m ${scopeResult.slugs.join(", ")} (${scopeResult.mode})\n`,
  );

  // -- 4. Baseline -----------------------------------------------------------
  const baselinePath = path.join(config.showcaseDir, ".eval-baseline.json");
  let baseline: EvalBaseline | null = null;

  if (opts.baseline === "compare") {
    baseline = loadBaseline(baselinePath);
    if (!baseline) {
      log.info("no local baseline, pulling from harness");
      try {
        baseline = await pullBaseline(undefined, baselinePath);
      } catch (err) {
        log.warn("failed to pull baseline", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      log.info("loaded local baseline", {
        slugCount: Object.keys(baseline.results).length,
      });
    }

    if (!baseline) {
      console.warn(
        "  \x1b[33mWarning: no baseline found for comparison, proceeding without\x1b[0m\n",
      );
    }
  }

  // -- 5. Build + start services ---------------------------------------------
  const slugsToStart = [...scopeResult.slugs];
  // Always ensure aimock is running
  if (!slugsToStart.includes("aimock")) {
    slugsToStart.push("aimock");
  }

  const autoStarted: string[] = [];
  for (const slug of slugsToStart) {
    const running = await isRunning(slug);
    if (!running) {
      autoStarted.push(slug);
    }
  }

  if (autoStarted.length > 0) {
    console.log(
      `  \x1b[36mStarting services:\x1b[0m ${autoStarted.join(", ")}`,
    );
    // up() includes health checks internally
    await up(autoStarted);
    console.log("  \x1b[32mAll services healthy\x1b[0m\n");
  }

  // -- 6-7. Run tiered tests -------------------------------------------------
  const healthySlugs = scopeResult.slugs.filter((s) => {
    try {
      const result = execSync(
        `docker inspect --format='{{.State.Health.Status}}' showcase-${s}`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
      ).trim();
      return result === "healthy";
    } catch {
      return false;
    }
  });

  let tieredResult: TieredRunResult;

  try {
    const runOptions: RunOptions = {
      level,
      maxParallel: parallel,
      timeout,
      showcaseDir: config.showcaseDir,
      maxTier,
      noFailFast: !failFast,
      onSlugStart: (slug, tier) => {
        if (!opts.json) console.log(`  \x1b[2m[${tier}] testing ${slug}...\x1b[0m`);
      },
      onSlugComplete: (result, tier) => {
        const icon = result.status === "pass" ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
        if (!opts.json) console.log(`  ${icon} [${tier}] ${result.slug} (${result.duration_ms}ms)`);
      },
    };

    tieredResult = await runTiered(scopeResult.slugs, healthySlugs, runOptions);
  } catch (err) {
    console.error(
      `\x1b[31mEval run failed:\x1b[0m ${err instanceof Error ? err.message : String(err)}`,
    );
    await teardown(autoStarted, opts.keep, worktreeDir, originalCwd, config.showcaseDir);
    process.exit(1);
  }

  // -- 8. Collect results ----------------------------------------------------
  const branchName = (() => {
    try {
      return execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
    } catch { return opts.pr ? `PR #${opts.pr}` : opts.branch ?? "unknown"; }
  })();

  // runner.SlugResult and matrix.SlugResult are structurally compatible but
  // runner uses plain `string` for test status while matrix uses a union type.
  // Safe cast since the runner only produces values from the union.
  const evalResults: EvalResults = collectResults(
    tieredResult.results as import("./matrix.js").SlugResult[], {
    branch: branchName,
    base: "origin/main",
    level,
    scope: { mode: scopeResult.mode, reason: scopeResult.reason, slugs: scopeResult.slugs },
  });

  // -- 9. Format + print -----------------------------------------------------
  const baselineAsResults = baseline as unknown as EvalResults | undefined;

  if (opts.json) {
    console.log(JSON.stringify(evalResults, null, 2));
  } else {
    const matrix = formatMatrix(evalResults, baselineAsResults ?? undefined);
    console.log(matrix);

    if (baseline && opts.baseline === "compare") {
      const regressions = computeRegressions(evalResults, baselineAsResults);
      if (regressions.count > 0) {
        console.log(
          `\n  \x1b[31mRegressions detected: ${regressions.count}\x1b[0m`,
        );
        for (const r of regressions.details) {
          console.log(`    - ${r.slug}: ${r.test}`);
        }
      }
    }

    const verdict = formatVerdict(evalResults, baselineAsResults ?? undefined);
    console.log(verdict);
  }

  // -- 10. Save results ------------------------------------------------------
  const savedPath = saveResults(evalResults, config.showcaseDir);
  log.info("results saved", { path: savedPath });

  if (opts.baseline === "capture") {
    const evalResultsDir = path.join(config.showcaseDir, ".eval-results");
    captureBaseline(evalResultsDir, baselinePath);
    log.info("baseline captured");
  }

  // -- 11. Cleanup -----------------------------------------------------------
  await teardown(autoStarted, opts.keep, worktreeDir, originalCwd, config.showcaseDir);

  // Exit with failure if any tests failed
  const totalFailed = evalResults.summary?.fail ?? 0;
  if (totalFailed > 0) {
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function teardown(
  autoStarted: string[],
  keep: boolean | undefined,
  worktreeDir: string | null,
  originalCwd: string | null,
  showcaseDir: string,
): Promise<void> {
  if (!keep && autoStarted.length > 0) {
    console.log(
      `\n  \x1b[2mStopping auto-started services: ${autoStarted.join(", ")}\x1b[0m`,
    );
    try {
      await down(autoStarted);
    } catch (err) {
      log.warn("failed to stop services during teardown", {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await cleanup(worktreeDir, originalCwd, showcaseDir);
}

async function cleanup(
  worktreeDir: string | null,
  originalCwd: string | null,
  showcaseDir: string,
): Promise<void> {
  if (worktreeDir && originalCwd) {
    process.chdir(originalCwd);
    try {
      execSync(`git worktree remove --force ${worktreeDir}`, {
        cwd: showcaseDir,
        stdio: "pipe",
        encoding: "utf-8",
      });
      log.info("worktree removed", { path: worktreeDir });
    } catch (err) {
      log.warn("failed to remove worktree", {
        path: worktreeDir,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
