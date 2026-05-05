"use client";

import { PostHogProvider as PostHogProviderBase } from "posthog-js/react";
import posthog from "posthog-js";
import { useEffect, useState, useRef } from "react";
import { usePathname } from "next/navigation";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
// Reverse-proxied via /ingest/* rewrites in next.config.ts so requests
// flow through the docs host instead of *.i.posthog.com — bypasses
// ad blockers / tracking-protection that target the PostHog hostname.
const POSTHOG_HOST = "/ingest";
const POSTHOG_UI_HOST = "https://eu.posthog.com";

/**
 * Normalize a pathname for analytics tracking.
 * Strips trailing slashes (except for root) so URL variants don't fragment funnels.
 */
function normalizePathnameForAnalytics(pathname: string): string {
  if (!pathname) return "/";
  return pathname === "/" ? "/" : pathname.replace(/\/$/, "");
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const isInitializedRef = useRef(false);

  // Read session_id from URL only on client side to avoid hydration mismatch
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      setSessionId(params.get("session_id"));
    }
  }, []);

  // Initialize PostHog once (only on mount)
  useEffect(() => {
    if (POSTHOG_KEY && !posthog?.__loaded && !isInitializedRef.current) {
      isInitializedRef.current = true;

      // Read sessionId from URL at initialization time
      const params =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search)
          : null;
      const initSessionId = params?.get("session_id") ?? sessionId;

      // Suppress all PostHog-related console errors and warnings
      const originalError = console.error;
      const originalWarn = console.warn;
      const originalLog = console.log;

      const suppressPostHogErrors = () => {
        console.error = (...args: unknown[]) => {
          const errorString = args.join(" ");
          const isPostHogError =
            errorString.includes("posthog") ||
            errorString.includes("PostHog") ||
            errorString.includes("request.ts") ||
            errorString.includes("posthog-core.ts") ||
            errorString.includes("ERR_BLOCKED_BY_CONTENT_BLOCKER") ||
            args.some((arg) => {
              if (typeof arg === "string") return arg.includes("posthog");
              if (arg && typeof arg === "object") {
                const maybeErr = arg as { stack?: string; message?: string };
                return (
                  maybeErr.stack?.includes("posthog") ||
                  maybeErr.message?.includes("posthog")
                );
              }
              return false;
            });

          if (isPostHogError) {
            // Suppress in production, log as warning in development
            if (process.env.NODE_ENV === "development") {
              originalWarn("[PostHog] Error suppressed:", ...args);
            }
            return;
          }
          originalError(...args);
        };

        console.warn = (...args: unknown[]) => {
          const warnString = args.join(" ");
          const isPostHogWarn =
            warnString.includes("posthog") ||
            warnString.includes("PostHog") ||
            warnString.includes("[PostHog.js]");

          if (isPostHogWarn) {
            // Suppress in production, log in development
            if (process.env.NODE_ENV === "development") {
              originalLog("[PostHog] Warning suppressed:", ...args);
            }
            return;
          }
          originalWarn(...args);
        };
      };

      try {
        // Suppress PostHog errors permanently (they're just noise from ad blockers)
        suppressPostHogErrors();

        posthog.init(POSTHOG_KEY, {
          api_host: POSTHOG_HOST,
          ui_host: POSTHOG_UI_HOST,
          person_profiles: "identified_only",
          bootstrap: initSessionId
            ? {
                sessionID: initSessionId,
              }
            : undefined,
          // Disable automatic pageview capture (we do it manually)
          capture_pageview: false,
          // Skip dead-clicks-autocapture.js to trim LCP analytics surface
          capture_dead_clicks: false,
          // Reduce network requests by batching
          request_batching: true,
          // Don't enable debug mode - it causes too much logging
        });
      } catch (error) {
        // Silently fail if PostHog init fails (e.g., network issues, blocked by ad blockers)
        if (process.env.NODE_ENV === "development") {
          originalWarn("PostHog initialization failed:", error);
        }
      }
    }
    // Only run once on mount; sessionId is captured via window.location.search above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Capture pageview only after PostHog is initialized
  useEffect(() => {
    if (POSTHOG_KEY && posthog?.__loaded) {
      try {
        const normalizedPathname = normalizePathnameForAnalytics(pathname);
        posthog.capture("$pageview", {
          $current_url:
            typeof window !== "undefined"
              ? `${window.location.origin}${normalizedPathname}`
              : normalizedPathname,
        });
      } catch (error) {
        // Silently fail if PostHog capture fails (e.g., network issues)
        if (process.env.NODE_ENV === "development") {
          console.warn("PostHog capture failed:", error);
        }
      }
    }
  }, [pathname]);

  return <PostHogProviderBase client={posthog}>{children}</PostHogProviderBase>;
}
