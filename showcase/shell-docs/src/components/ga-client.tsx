"use client";

import { useGoogleAnalytics } from "@/lib/hooks/use-google-analytics";

/**
 * Client-only mount point for the Google Analytics hook.
 *
 * The GA hook subscribes to pathname changes and emits pageviews via
 * react-ga4. It must run inside a client component, so this thin
 * wrapper exists purely so the server-rendered RootLayout can mount
 * the hook without becoming a client component itself.
 */
export function GoogleAnalyticsClient() {
  useGoogleAnalytics();
  return null;
}
