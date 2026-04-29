"use client";
/**
 * ComposedCell — overlay-aware cell renderer.
 *
 * Composes different content layers (Links, Depth, Health, Docs) based on
 * which overlays are currently active. Replaces per-tab cell renderers with
 * a single composable component that stacks only the active layers.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type { CellContext } from "@/components/feature-grid";
import { CellStatus, DocsRow, urlsFor } from "@/components/cell-pieces";
import { CellDrilldown } from "@/components/cell-drilldown";
import { CommandCell } from "@/components/command-cell";
import { DepthChip } from "@/components/depth-chip";
import { deriveDepth } from "@/components/depth-utils";
import type { CatalogCell } from "@/components/depth-utils";

/** Overlay types — defined locally; canonical types live in a sibling module. */
export type Overlay = "links" | "depth" | "health" | "parity" | "docs";

export interface ComposedCellProps {
  ctx: CellContext;
  overlays: Set<Overlay>;
  catalogCell?: CatalogCell;
}

/**
 * Render the Links layer: Demo + Code links.
 * For command demos, renders CommandCell instead.
 */
function LinksLayer({ ctx }: { ctx: CellContext }) {
  if (ctx.demo.command) {
    return <CommandCell ctx={ctx} />;
  }

  const links = urlsFor(ctx);

  return (
    <div className="flex items-center gap-2.5">
      <a
        href={links.demoUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="whitespace-nowrap text-[var(--accent)] hover:underline"
      >
        <span className="text-[var(--text-muted)]">Demo</span> <span>↗</span>
      </a>
      <a
        href={links.codeUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="whitespace-nowrap text-[var(--accent)] hover:underline"
      >
        <span className="text-[var(--text-muted)]">Code</span>{" "}
        <span>{"</>"}</span>
      </a>
    </div>
  );
}

/**
 * Render the Depth layer: DepthChip showing D0-D4 with regression marker.
 * Clicking the chip opens a CellDrilldown popup with per-badge dimension details.
 */
function DepthLayer({
  ctx,
  catalogCell,
}: {
  ctx: CellContext;
  catalogCell?: CatalogCell;
}) {
  const [drilldownOpen, setDrilldownOpen] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const closeDrilldown = useCallback(() => setDrilldownOpen(false), []);

  // Close drilldown on click-outside
  useEffect(() => {
    if (!drilldownOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setDrilldownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [drilldownOpen]);

  if (!catalogCell) return null;

  const depth = deriveDepth(catalogCell, ctx.liveStatus);

  return (
    <div
      ref={containerRef}
      className="flex items-center gap-1 relative"
      data-testid="depth-layer"
    >
      <button
        type="button"
        data-testid={`depth-btn-${ctx.integration.slug}-${ctx.feature.id}`}
        className="cursor-pointer bg-transparent border-none p-0"
        onClick={() => setDrilldownOpen((prev) => !prev)}
      >
        <DepthChip
          depth={depth.achieved}
          status={catalogCell.status}
          regression={depth.isRegression}
        />
      </button>
      {drilldownOpen && (
        <CellDrilldown
          slug={ctx.integration.slug}
          featureId={ctx.feature.id}
          integrationName={ctx.integration.name}
          featureName={ctx.feature.name}
          liveStatus={ctx.liveStatus}
          connection={ctx.connection}
          onClose={closeDrilldown}
        />
      )}
    </div>
  );
}

/**
 * Render the Health layer: E2E, D5, D6 badge chips via CellStatus.
 */
function HealthLayer({ ctx }: { ctx: CellContext }) {
  return (
    <div data-testid="health-layer">
      <CellStatus ctx={ctx} />
    </div>
  );
}

/**
 * Render the Docs layer: docs-og + docs-shell row.
 */
function DocsLayer({ ctx }: { ctx: CellContext }) {
  return (
    <div data-testid="docs-layer">
      <DocsRow
        integration={ctx.integration}
        feature={ctx.feature}
        shellUrl={ctx.shellUrl}
      />
    </div>
  );
}

/**
 * ComposedCell — stacks active overlay layers top-to-bottom:
 *   1. Links (when "links" active)
 *   2. Depth (when "depth" active)
 *   3. Health (when "health" active)
 *   4. Docs (when "docs" active)
 *
 * "parity" overlay adds no per-cell content — if only parity is active,
 * the cell renders empty.
 */
export function ComposedCell({
  ctx,
  overlays,
  catalogCell,
}: ComposedCellProps) {
  const isTesting = ctx.feature.kind === "testing";
  const hasLinks = overlays.has("links");
  const hasDepth = overlays.has("depth");
  const hasHealth = overlays.has("health");
  const hasDocs = overlays.has("docs");

  // Check if any layer will produce content
  const hasContent = hasLinks || hasDepth || hasHealth || hasDocs;

  if (!hasContent) {
    return <div data-testid="composed-cell-empty" />;
  }

  return (
    <div
      data-testid="composed-cell"
      className={`flex flex-col items-center gap-1 text-[11px] ${isTesting ? "opacity-60" : ""}`}
    >
      {hasLinks && <LinksLayer ctx={ctx} />}
      {hasDepth && <DepthLayer ctx={ctx} catalogCell={catalogCell} />}
      {hasHealth && <HealthLayer ctx={ctx} />}
      {hasDocs && !hasHealth && <DocsLayer ctx={ctx} />}
    </div>
  );
}
