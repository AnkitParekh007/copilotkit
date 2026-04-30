/**
 * Lightweight URL router for framework-agnostic CopilotKit runtime handler.
 *
 * Two strategies:
 * - With `basePath`: strict prefix strip → match remainder
 * - Without `basePath`: suffix matching on known patterns
 *
 * The set of known routes (URL pattern + HTTP method + dispatch handler) is
 * declared in `routes.ts`. This module is a thin path-stripper that delegates
 * the actual pattern matching to that table.
 *
 * Single-route mode: delegates to `parseMethodCall` for JSON envelope dispatch.
 */

import type { RouteInfo } from "./hooks";
import { matchSegmentsAgainstRoutes } from "./routes";

/**
 * Match a request URL against known CopilotKit route patterns.
 *
 * @param pathname - The URL pathname to match
 * @param basePath - Optional base path prefix to strip first
 * @returns RouteInfo if matched, null otherwise
 */
export function matchRoute(
  pathname: string,
  basePath?: string,
): RouteInfo | null {
  let remainder: string;

  if (basePath) {
    // Normalize: ensure basePath doesn't end with /
    const normalizedBase =
      basePath.length > 1 && basePath.endsWith("/")
        ? basePath.slice(0, -1)
        : basePath;

    // Special case: basePath === "/" matches everything
    if (normalizedBase === "/") {
      remainder = pathname;
    } else {
      if (!pathname.startsWith(normalizedBase)) return null;

      // The character after basePath must be "/" or end of string
      const afterBase = pathname.slice(normalizedBase.length);
      if (afterBase.length > 0 && !afterBase.startsWith("/")) return null;

      remainder = afterBase || "/";
    }
  } else {
    // Suffix matching: find known patterns at the end of the pathname
    remainder = pathname;
  }

  const segments = remainder.split("/").filter(Boolean);
  const matched = matchSegmentsAgainstRoutes(segments);
  return matched ? matched.route : null;
}
