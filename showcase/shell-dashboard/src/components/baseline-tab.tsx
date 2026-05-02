"use client";

import { useState, useMemo, useCallback } from "react";
import { pb } from "@/lib/pb";
import { useBaseline } from "@/hooks/useBaseline";
import { BaselineGrid } from "./baseline-grid";
import { BaselineLegend } from "./baseline-legend";
import { BaselineToastContainer } from "./baseline-toast";
import { PbAuthPrompt } from "./pb-auth-prompt";

/**
 * BaselineTab — container component that composes the header bar, grid,
 * legend, toast, and auth prompt for the Baseline tab.
 */
export function BaselineTab() {
  const { cells, status: connStatus, error, updateCell } = useBaseline();
  const [editing, setEditing] = useState(false);
  const [showAuth, setShowAuth] = useState(false);

  // Compute aggregate stats from cells map
  const stats = useMemo(() => {
    let works = 0;
    let possible = 0;
    let impossible = 0;
    let unknown = 0;

    for (const cell of cells.values()) {
      switch (cell.status) {
        case "works":
          works++;
          break;
        case "possible":
          possible++;
          break;
        case "impossible":
          impossible++;
          break;
        case "unknown":
          unknown++;
          break;
      }
    }

    const total = works + possible + impossible + unknown;
    const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

    return {
      works,
      possible,
      impossible,
      unknown,
      total,
      worksPct: pct(works),
      possiblePct: pct(possible),
      impossiblePct: pct(impossible),
      unknownPct: pct(unknown),
    };
  }, [cells]);

  // Toggle between view and edit mode, gating on PB auth
  const handleToggleEditing = useCallback(
    (wantEdit: boolean) => {
      if (!wantEdit) {
        setEditing(false);
        return;
      }
      // Toggling ON: check auth
      if (pb.authStore.isValid) {
        setEditing(true);
      } else {
        setShowAuth(true);
      }
    },
    [],
  );

  const handleAuthSuccess = useCallback(() => {
    setShowAuth(false);
    setEditing(true);
  }, []);

  const handleAuthCancel = useCallback(() => {
    setShowAuth(false);
    // editing stays false
  }, []);

  // Error state
  if (connStatus === "error") {
    return (
      <div className="flex items-center justify-center py-20 text-[var(--text-muted)]">
        <span>Baseline connection error: {error ?? "Unknown error"}</span>
      </div>
    );
  }

  return (
    <>
      {/* Header bar — sticky top z-30 */}
      <div className="sticky top-0 z-30 px-8 py-3 flex items-center gap-4 bg-[var(--bg-surface)] border-b border-[var(--border)]">
        {/* View / Edit toggle */}
        <div className="inline-flex bg-[var(--bg)] rounded-[5px] p-0.5 border border-[var(--border)]">
          <button
            type="button"
            onClick={() => handleToggleEditing(false)}
            className={`px-3 py-1 text-xs font-medium rounded-[4px] transition-colors cursor-pointer ${
              !editing
                ? "bg-[var(--accent)] text-white"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
          >
            View
          </button>
          <button
            type="button"
            onClick={() => handleToggleEditing(true)}
            className={`px-3 py-1 text-xs font-medium rounded-[4px] transition-colors cursor-pointer ${
              editing
                ? "bg-[var(--accent)] text-white"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
          >
            Edit
          </button>
        </div>

        {/* Stats */}
        <div className="flex gap-4 text-[11px]">
          <span>
            ✅ {stats.works} ({stats.worksPct}%)
          </span>
          <span>
            🛠️ {stats.possible} ({stats.possiblePct}%)
          </span>
          <span>
            ❌ {stats.impossible} ({stats.impossiblePct}%)
          </span>
          <span>
            ❓ {stats.unknown} ({stats.unknownPct}%)
          </span>
        </div>

        {connStatus === "connecting" && (
          <span className="text-[11px] text-[var(--text-muted)]">
            Connecting...
          </span>
        )}
      </div>

      <BaselineGrid cells={cells} editing={editing} onUpdate={updateCell} />
      <BaselineLegend />
      <BaselineToastContainer />

      {showAuth && (
        <PbAuthPrompt
          onSuccess={handleAuthSuccess}
          onCancel={handleAuthCancel}
        />
      )}
    </>
  );
}
