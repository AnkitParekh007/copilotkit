"use client";

import { useGoogleAnalytics } from "@/lib/hooks/use-google-analytics";
import { useRB2B } from "@/lib/hooks/use-rb2b";
import { CopyTracker } from "@/lib/providers/copy-tracker";

/**
 * Client-side wrapper that mounts analytics/visitor-id hooks.
 *
 * layout.tsx is a server component, so any hook-based telemetry must run
 * inside a "use client" boundary. Mirrors upstream's `ProvidersWrapper`
 * pattern: one client boundary, all hooks together.
 */
export function AnalyticsClient() {
  useRB2B();
  useGoogleAnalytics();
  return <CopyTracker />;
}
