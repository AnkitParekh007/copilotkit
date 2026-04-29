"use client";
/**
 * OverlayColumnHeader -- overlay-aware column header that conditionally
 * shows LevelStrip, ParityBadge, and tally based on active overlays.
 */
import { LevelStrip } from "@/components/level-strip";
import { ParityBadge } from "@/components/parity-badge";
import type { ParityTier } from "@/components/parity-badge";
import { TallyTrigger } from "@/components/tally-breakdown";
import type { TallyDetail } from "@/components/tally-types";
import type { Integration } from "@/lib/registry";
import type { ConnectionStatus, LiveStatusMap } from "@/lib/live-status";

/** Overlay modes toggled by the dashboard toolbar. */
type Overlay = "links" | "depth" | "health" | "parity" | "docs";

export interface OverlayColumnHeaderProps {
  integration: Integration;
  tally?: { green: number; amber: number; red: number; unknown: boolean };
  tallyDetail?: TallyDetail;
  overlays: Set<Overlay>;
  liveStatus: LiveStatusMap;
  connection: ConnectionStatus;
  parityTier?: ParityTier;
  /** Minimum column width in pixels. */
  minWidth?: number;
}

export function OverlayColumnHeader({
  integration,
  tally,
  tallyDetail,
  overlays,
  liveStatus,
  connection: _connection,
  parityTier,
  minWidth = 220,
}: OverlayColumnHeaderProps) {
  const showHealth = overlays.has("health");
  const showParity = overlays.has("parity");

  const total = tally ? tally.green + tally.amber + tally.red : 0;
  const tallyTitle = tally?.unknown
    ? "dashboard offline -- live signal unavailable"
    : total
      ? `${tally?.green ?? 0} green \u00b7 ${tally?.amber ?? 0} amber \u00b7 ${tally?.red ?? 0} red of ${total} signals`
      : "no countable signals for this column";

  return (
    <th
      className="sticky top-0 z-20 bg-[var(--bg-muted)] px-3 py-3 text-left border-b border-l border-[var(--border)] font-normal"
      style={{ minWidth: `${minWidth}px` }}
    >
      {/* Always: integration name */}
      <div className="text-[10px] font-semibold text-[var(--text)]">
        {integration.name}
      </div>

      {/* Always: language */}
      <div className="mt-0.5 text-[9px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
        {integration.language}
      </div>

      {/* Parity overlay: ParityBadge (renders above LevelStrip when both active) */}
      {showParity && parityTier && (
        <div className="mt-1">
          <ParityBadge tier={parityTier} />
        </div>
      )}

      {/* Health overlay: LevelStrip */}
      {showHealth && (
        <div className="mt-1">
          <LevelStrip integration={integration} liveStatus={liveStatus} />
        </div>
      )}

      {/* Health overlay: tally line */}
      {showHealth && tally && (
        <div
          className="mt-1 text-[9px] tabular-nums text-[var(--text-muted)]"
          title={tallyTitle}
        >
          {tally.unknown ? (
            <span className="text-[var(--text-muted)]">? offline</span>
          ) : (
            <>
              <TallyTrigger items={tallyDetail?.green ?? []} tone="green">
                <span className="text-[var(--ok)]">
                  {"\u2713"} {tally.green}
                </span>
              </TallyTrigger>
              <span className="mx-1 text-[var(--text-muted)]">{"\u00b7"}</span>
              <TallyTrigger items={tallyDetail?.amber ?? []} tone="amber">
                <span className="text-[var(--amber)]">~ {tally.amber}</span>
              </TallyTrigger>
              <span className="mx-1 text-[var(--text-muted)]">{"\u00b7"}</span>
              <TallyTrigger items={tallyDetail?.red ?? []} tone="red">
                <span className="text-[var(--danger)]">
                  {"\u2717"} {tally.red}
                </span>
              </TallyTrigger>
            </>
          )}
        </div>
      )}
    </th>
  );
}
