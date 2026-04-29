"use client";
/**
 * CellDrilldown — popover panel showing per-badge dimension detail for a
 * single (integration, feature) cell.
 *
 * Renders all 5 badge dimensions (health, e2e, smoke, d5, d6) with tone,
 * label, tooltip, and — for red/amber badges — failure metadata: fail_count,
 * first_failure_at, and the signal payload.
 */
import { resolveCell } from "@/lib/live-status";
import type {
  CellState,
  BadgeRender,
  LiveStatusMap,
  ConnectionStatus,
} from "@/lib/live-status";
import { TONE_CLASS, DOT_BG } from "./badges";

export interface CellDrilldownProps {
  slug: string;
  featureId: string;
  integrationName: string;
  featureName: string;
  liveStatus: LiveStatusMap;
  connection?: ConnectionStatus;
  onClose: () => void;
}

/** Dimension metadata for display ordering. */
const DIMENSIONS: Array<{
  key: keyof Omit<CellState, "rollup">;
  label: string;
}> = [
  { key: "d6", label: "D6 (Parity)" },
  { key: "d5", label: "D5 (Deep)" },
  { key: "e2e", label: "E2E" },
  { key: "health", label: "Health" },
  { key: "smoke", label: "Smoke" },
];

function formatTimestamp(ts: string | null): string {
  if (!ts) return "n/a";
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return ts;
  }
}

function formatSignal(signal: unknown): string | null {
  if (signal == null) return null;
  if (typeof signal === "string") return signal || null;
  if (typeof signal === "object") {
    if (Array.isArray(signal) && signal.length === 0) return null;
    if (!Array.isArray(signal) && Object.keys(signal as object).length === 0)
      return null;
    try {
      return JSON.stringify(signal, null, 2);
    } catch {
      return null;
    }
  }
  return String(signal) || null;
}

function BadgeRow({ badge, label }: { badge: BadgeRender; label: string }) {
  const isFailure = badge.tone === "red" || badge.tone === "amber";
  const signalText = badge.row ? formatSignal(badge.row.signal) : null;

  return (
    <div
      data-testid={`drilldown-badge-${label.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
      className="py-2 border-b border-[var(--border)] last:border-b-0"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block w-2 h-2 rounded-full ${DOT_BG[badge.tone]}`}
          />
          <span className="text-xs font-medium text-[var(--text)]">
            {label}
          </span>
        </div>
        <span
          className={`text-xs font-semibold tabular-nums ${TONE_CLASS[badge.tone]}`}
        >
          {badge.label}
        </span>
      </div>
      <p className="mt-0.5 text-[10px] text-[var(--text-muted)] leading-tight">
        {badge.tooltip}
      </p>
      {isFailure && badge.row && (
        <div className="mt-1.5 pl-4 space-y-0.5">
          {badge.row.fail_count > 0 && (
            <div className="text-[10px]">
              <span className="text-[var(--text-muted)]">Failures:</span>{" "}
              <span
                data-testid="fail-count"
                className="text-[var(--danger)] font-semibold tabular-nums"
              >
                {badge.row.fail_count}
              </span>
            </div>
          )}
          {badge.row.first_failure_at && (
            <div className="text-[10px]">
              <span className="text-[var(--text-muted)]">First failure:</span>{" "}
              <span data-testid="first-failure" className="text-[var(--text)]">
                {formatTimestamp(badge.row.first_failure_at)}
              </span>
            </div>
          )}
          {signalText && (
            <div className="text-[10px]">
              <span className="text-[var(--text-muted)]">Signal:</span>
              <pre
                data-testid="signal-payload"
                className="mt-0.5 p-1.5 rounded bg-[var(--bg-muted)] text-[9px] text-[var(--text)] overflow-x-auto max-h-24 whitespace-pre-wrap break-all"
              >
                {signalText}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function CellDrilldown({
  slug,
  featureId,
  integrationName,
  featureName,
  liveStatus,
  connection = "live",
  onClose,
}: CellDrilldownProps) {
  const cell = resolveCell(liveStatus, slug, featureId, { connection });

  return (
    <div
      data-testid="cell-drilldown"
      className="absolute z-50 mt-1 w-72 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] shadow-lg"
      role="dialog"
      aria-label={`${integrationName} / ${featureName} detail`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] bg-[var(--bg-muted)] rounded-t-lg">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-[var(--text)] truncate">
            {integrationName}
          </div>
          <div className="text-[10px] text-[var(--text-muted)] truncate">
            {featureName}
          </div>
        </div>
        <button
          type="button"
          data-testid="drilldown-close"
          onClick={onClose}
          className="ml-2 p-0.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] text-sm leading-none cursor-pointer"
          aria-label="Close"
        >
          x
        </button>
      </div>
      {/* Rollup */}
      <div className="px-3 py-1.5 flex items-center gap-2 border-b border-[var(--border)]">
        <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
          Rollup
        </span>
        <span
          className={`inline-block w-2 h-2 rounded-full ${DOT_BG[cell.rollup]}`}
        />
        <span className={`text-xs font-semibold ${TONE_CLASS[cell.rollup]}`}>
          {cell.rollup}
        </span>
      </div>
      {/* Badge rows */}
      <div className="px-3 py-1">
        {DIMENSIONS.map((dim) => (
          <BadgeRow key={dim.key} badge={cell[dim.key]} label={dim.label} />
        ))}
      </div>
    </div>
  );
}
