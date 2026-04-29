import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type { Overlay, OverlaySet } from "@/lib/overlay-types";
import {
  ALL_OVERLAYS,
  DEFAULT_OVERLAYS,
  PRESETS,
  LEGACY_REDIRECTS,
  FILTER_TRIGGER_OVERLAYS,
} from "@/lib/overlay-types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = "dashboard:overlays";
const HASH_PREFIX = "matrix:";

// ---------------------------------------------------------------------------
// URL hash helpers
// ---------------------------------------------------------------------------

/** Parse the current URL hash into a tab + overlay set, handling legacy redirects. */
function parseHash(): {
  tab: "matrix" | "ops";
  overlays: OverlaySet | null;
} {
  const raw =
    typeof window !== "undefined" ? window.location.hash.slice(1) : "";
  if (!raw) return { tab: "matrix", overlays: null };

  // #ops — switch to ops tab
  if (raw === "ops") {
    return { tab: "ops", overlays: null };
  }

  // Legacy redirect check
  if (raw in LEGACY_REDIRECTS) {
    const mapped = LEGACY_REDIRECTS[raw];
    // "status" redirects to ops tab
    if (mapped.length === 0) {
      return { tab: "ops", overlays: null };
    }
    const set = new Set(mapped) as OverlaySet;
    return { tab: "matrix", overlays: set };
  }

  // #matrix or #matrix:links,depth,...
  if (raw === "matrix") {
    return { tab: "matrix", overlays: null };
  }

  if (raw.startsWith(HASH_PREFIX)) {
    const parts = raw.slice(HASH_PREFIX.length).split(",");
    const valid = parts.filter((p): p is Overlay =>
      ALL_OVERLAYS.includes(p as Overlay),
    );
    if (valid.length > 0) {
      return { tab: "matrix", overlays: new Set(valid) as OverlaySet };
    }
    return { tab: "matrix", overlays: null };
  }

  return { tab: "matrix", overlays: null };
}

/** Replace hash via replaceState (no history entry, no navigation). */
function writeHash(tab: "matrix" | "ops", overlays?: OverlaySet): void {
  if (typeof window === "undefined") return;
  if (tab === "ops") {
    window.history.replaceState(null, "", "#ops");
    return;
  }
  if (overlays && overlays.size > 0) {
    const sorted = [...overlays].sort(
      (a, b) => ALL_OVERLAYS.indexOf(a) - ALL_OVERLAYS.indexOf(b),
    );
    window.history.replaceState(null, "", `#${HASH_PREFIX}${sorted.join(",")}`);
  } else {
    window.history.replaceState(null, "", "#matrix");
  }
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function loadFromStorage(): OverlaySet | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const arr: string[] = JSON.parse(raw);
    const valid = arr.filter((s): s is Overlay =>
      ALL_OVERLAYS.includes(s as Overlay),
    );
    return valid.length > 0 ? (new Set(valid) as OverlaySet) : null;
  } catch {
    return null;
  }
}

function saveToStorage(overlays: OverlaySet): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...overlays]));
  } catch {
    // Silently ignore storage errors (quota, private browsing, etc.)
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseOverlaysReturn {
  overlays: OverlaySet;
  activeTab: "matrix" | "ops";
  toggle: (overlay: Overlay) => void;
  applyPreset: (presetId: string) => void;
  setTab: (tab: "matrix" | "ops") => void;
  activePreset: string | null;
  showFilters: boolean;
  has: (overlay: Overlay) => boolean;
}

export function useOverlays(): UseOverlaysReturn {
  const initialized = useRef(false);

  const [overlays, setOverlays] = useState<OverlaySet>(
    () => new Set(DEFAULT_OVERLAYS) as OverlaySet,
  );
  const [activeTab, setActiveTabRaw] = useState<"matrix" | "ops">("matrix");

  // Sync from URL hash / localStorage after hydration
  useEffect(() => {
    const { tab, overlays: fromHash } = parseHash();
    const resolved =
      fromHash ?? loadFromStorage() ?? (new Set(DEFAULT_OVERLAYS) as OverlaySet);
    setOverlays(resolved);
    setActiveTabRaw(tab);
  }, []);

  // On mount, write hash to reflect actual state (handles legacy redirects
  // and fallback from localStorage where the URL had no hash).
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      writeHash(activeTab, overlays);
    }
  }, [activeTab, overlays]);

  // Sync hash + localStorage whenever overlays change after initialization.
  const updateOverlays = useCallback((next: OverlaySet) => {
    setOverlays(next);
    writeHash("matrix", next);
    saveToStorage(next);
  }, []);

  const toggle = useCallback((overlay: Overlay) => {
    setOverlays((prev) => {
      // Minimum-one rule: toggling the last active overlay is a no-op
      if (prev.has(overlay) && prev.size === 1) return prev;

      const next = new Set(prev) as OverlaySet;
      if (next.has(overlay)) {
        next.delete(overlay);
      } else {
        next.add(overlay);
      }
      writeHash("matrix", next);
      saveToStorage(next);
      return next;
    });
  }, []);

  const applyPreset = useCallback(
    (presetId: string) => {
      const preset = PRESETS.find((p) => p.id === presetId);
      if (!preset) return;
      const next = new Set(preset.overlays) as OverlaySet;
      updateOverlays(next);
    },
    [updateOverlays],
  );

  const setTab = useCallback(
    (tab: "matrix" | "ops") => {
      setActiveTabRaw(tab);
      writeHash(tab, overlays);
    },
    [overlays],
  );

  const activePreset = useMemo(() => {
    for (const preset of PRESETS) {
      if (
        preset.overlays.length === overlays.size &&
        preset.overlays.every((o) => overlays.has(o))
      ) {
        return preset.id;
      }
    }
    return null;
  }, [overlays]);

  const showFilters = useMemo(
    () => FILTER_TRIGGER_OVERLAYS.some((o) => overlays.has(o)),
    [overlays],
  );

  const has = useCallback(
    (overlay: Overlay) => overlays.has(overlay),
    [overlays],
  );

  return {
    overlays,
    activeTab,
    toggle,
    applyPreset,
    setTab,
    activePreset,
    showFilters,
    has,
  };
}
