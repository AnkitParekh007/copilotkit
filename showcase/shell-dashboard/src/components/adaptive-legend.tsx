"use client";
/**
 * AdaptiveLegend — legend that only shows symbols relevant to
 * currently active overlays.
 */

type Overlay = "links" | "depth" | "health" | "parity" | "docs";

export interface AdaptiveLegendProps {
  overlays: Set<Overlay>;
}

/** Single legend entry — inline flex with icon/symbol + explanation. */
function LegendItem({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-1.5">{children}</div>;
}

/* ------------------------------------------------------------------ */
/*  Section renderers                                                  */
/* ------------------------------------------------------------------ */

function LinksLegend() {
  return (
    <>
      <LegendItem>
        <span className="text-[var(--accent)] font-medium">Demo ↗</span>
        open hosted preview
      </LegendItem>
      <LegendItem>
        <span className="text-[var(--accent)] font-medium">Code {"</>"}</span>
        open source
      </LegendItem>
    </>
  );
}

function DepthLegend() {
  return (
    <>
      <LegendItem>
        <span className="font-semibold text-[var(--text-secondary)]">
          D0-D4
        </span>
        integration wiring depth (D0 = listed, D4 = full tool rendering)
      </LegendItem>
      <LegendItem>
        <span className="text-[var(--danger)] font-medium">▼</span>
        depth regression from previous run
      </LegendItem>
    </>
  );
}

function HealthLegend() {
  return (
    <>
      <LegendItem>
        <span className="font-semibold text-[var(--text-secondary)]">
          L1-L4 Strip
        </span>
        per-integration health levels shown in column header
      </LegendItem>
      <LegendItem>
        <span className="text-[var(--ok)]">E2E ✓</span>/
        <span className="text-[var(--amber)]">~</span>/
        <span className="text-[var(--danger)]">✗</span>
        end-to-end smoke (green &lt;6h / amber stale / red fail)
      </LegendItem>
      <LegendItem>
        <span className="text-[var(--ok)]">D5</span>/
        <span className="text-[var(--amber)]">D5</span>/
        <span className="text-[var(--danger)]">D5</span>
        depth-5 tool rendering (green pass / amber stale / red fail)
      </LegendItem>
      <LegendItem>
        <span className="text-[var(--ok)]">D6</span>/
        <span className="text-[var(--amber)]">D6</span>/
        <span className="text-[var(--danger)]">D6</span>
        depth-6 multi-agent (green pass / amber stale / red fail)
      </LegendItem>
      <LegendItem>
        <span className="text-[var(--text-muted)]">?</span>
        probe has not yet ticked since deploy
      </LegendItem>
      <LegendItem>
        <span className="text-[var(--text-muted)]">—</span>
        supported, no demo yet
      </LegendItem>
    </>
  );
}

function ParityLegend() {
  return (
    <>
      <LegendItem>
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider border bg-purple-600/20 text-purple-400 border-purple-500/30">
          REF
        </span>
        reference integration (feature-complete baseline)
      </LegendItem>
      <LegendItem>
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider border bg-[var(--ok)]/20 text-[var(--ok)] border-[var(--ok)]/30">
          AT PARITY
        </span>
        matches reference across all features
      </LegendItem>
      <LegendItem>
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider border bg-[var(--amber)]/20 text-[var(--amber)] border-[var(--amber)]/30">
          PARTIAL
        </span>
        some features wired, some missing
      </LegendItem>
      <LegendItem>
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider border bg-[var(--amber)]/20 text-[var(--amber)] border-[var(--amber)]/30 opacity-60">
          MINIMAL
        </span>
        basic wiring only
      </LegendItem>
      <LegendItem>
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider border bg-[var(--text-muted)]/10 text-[var(--text-muted)] border-[var(--text-muted)]/20">
          NOT WIRED
        </span>
        integration exists in catalog but not wired
      </LegendItem>
    </>
  );
}

function DocsLegend() {
  return (
    <LegendItem>
      <span className="text-[var(--ok)]">docs-og ✓</span>
      {" / "}
      <span className="text-[var(--text-muted)]">·</span>
      {" / "}
      <span className="text-[var(--danger)]">docs-shell ✗</span>
      {" / "}
      <span className="text-[var(--amber)]">!</span> docs: ok / missing / 404 /
      probe error
    </LegendItem>
  );
}

/** Always-shown legend items regardless of active overlays. */
function AlwaysLegend() {
  return (
    <>
      <LegendItem>
        <span className="text-[var(--text-secondary)]">testing</span>
        rows are muted &amp; hide docs (primary feature = has docs)
      </LegendItem>
      <LegendItem>
        <span className="text-[var(--danger)]">✗</span>
        not supported
      </LegendItem>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function AdaptiveLegend({ overlays }: AdaptiveLegendProps) {
  return (
    <div
      data-testid="adaptive-legend"
      className="fixed bottom-0 left-0 right-0 z-40 px-8 py-3 flex flex-wrap gap-x-6 gap-y-2 text-xs text-[var(--text-muted)] bg-[var(--bg-surface)] border-t border-[var(--border)]"
    >
      {overlays.has("links") && <LinksLegend />}
      {overlays.has("depth") && <DepthLegend />}
      {overlays.has("health") && <HealthLegend />}
      {overlays.has("parity") && <ParityLegend />}
      {overlays.has("docs") && <DocsLegend />}
      <AlwaysLegend />
    </div>
  );
}
