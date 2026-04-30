/**
 * Declarative route table for the CopilotKit runtime fetch handler.
 *
 * Each entry owns the URL pattern (via a segment matcher), the allowed HTTP
 * method(s), and the dispatch handler. This is the single source of truth for
 * the HTTP surface — `fetch-router.ts` (URL → RouteInfo), `fetch-handler.ts`
 * (RouteInfo → handler), and the route metadata used by hooks all derive from
 * this table.
 *
 * Adding a new route requires a single new entry in `ALL_ROUTES`.
 *
 * @example
 * ```typescript
 * // Hypothetical /threads/:threadId/star route — one entry in this file:
 * {
 *   id: "threads/star",
 *   methods: ["POST"],
 *   match: (segments) =>
 *     segments.length >= 3 &&
 *     segments[segments.length - 3] === "threads" &&
 *     segments[segments.length - 1] === "star"
 *       ? matchThreadIdAt(segments, segments.length - 2, "threads/star")
 *       : null,
 *   handler: ({ runtime, request, route }) =>
 *     handleStarThread({ runtime, request, threadId: route.threadId }),
 * }
 * ```
 */
import type { CopilotRuntimeLike } from "./runtime";
import type { RouteInfo } from "./hooks";
import { handleRunAgent } from "../handlers/handle-run";
import { handleConnectAgent } from "../handlers/handle-connect";
import { handleStopAgent } from "../handlers/handle-stop";
import { handleGetRuntimeInfo } from "../handlers/get-runtime-info";
import { handleTranscribe } from "../handlers/handle-transcribe";
import { handleDebugEvents } from "../handlers/handle-debug-events";
import {
  handleClearThreads,
  handleListThreads,
  handleSubscribeToThreads,
  handleUpdateThread,
  handleArchiveThread,
  handleDeleteThread,
  handleGetThreadMessages,
  handleGetThreadEvents,
  handleGetThreadState,
} from "../handlers/handle-threads";

/* ------------------------------------------------------------------------------------------------
 * Types
 * --------------------------------------------------------------------------------------------- */

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface RouteHandlerContext {
  runtime: CopilotRuntimeLike;
  request: Request;
  route: RouteInfo;
}

export type RouteHandler = (ctx: RouteHandlerContext) => Promise<Response>;

/**
 * Match a list of trailing path segments against a route's pattern.
 *
 * Returns the populated `RouteInfo` (with any extracted params) when the
 * pattern matches, or `null` to fall through to the next route. The router
 * iterates `ALL_ROUTES` in order and returns the first match.
 */
export type SegmentMatcher = (segments: string[]) => RouteInfo | null;

export interface RouteEntry {
  /** Stable identifier — matches the discriminator in `RouteInfo.method`. */
  id: RouteInfo["method"];
  /** Allowed HTTP method(s). Multiple methods (e.g. PATCH+DELETE) are dispatched to the same handler — the handler then disambiguates. */
  methods: readonly HttpMethod[];
  /** Pattern matcher that consumes the trailing path segments. */
  match: SegmentMatcher;
  /** Dispatch handler. */
  handler: RouteHandler;
}

/* ------------------------------------------------------------------------------------------------
 * Helpers
 * --------------------------------------------------------------------------------------------- */

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Route table
 *
 * NOTE: order matters. Entries are tried in sequence. More specific patterns
 * (e.g. `/threads/clear`, `/threads/subscribe`) must precede the catch-all
 * `/threads/:threadId` entry that would otherwise swallow them.
 * --------------------------------------------------------------------------------------------- */

export const ALL_ROUTES: readonly RouteEntry[] = [
  // /info  (GET)
  {
    id: "info",
    methods: ["GET"],
    match: (segments) => {
      const len = segments.length;
      if (len >= 1 && segments[len - 1] === "info") {
        return { method: "info" };
      }
      return null;
    },
    handler: ({ runtime, request }) =>
      handleGetRuntimeInfo({ runtime, request }),
  },

  // /transcribe  (POST)
  {
    id: "transcribe",
    methods: ["POST"],
    match: (segments) => {
      const len = segments.length;
      if (len >= 1 && segments[len - 1] === "transcribe") {
        return { method: "transcribe" };
      }
      return null;
    },
    handler: ({ runtime, request }) => handleTranscribe({ runtime, request }),
  },

  // /cpk-debug-events  (GET)
  // Reserved route name: the `cpk-` prefix makes collision with a user-named
  // agent essentially impossible (the router only treats `agent/:agentId/...`
  // patterns as agent lookups, so a bare `cpk-debug-events` segment would
  // never fall through to one — the prefix is the real guard, not this
  // branch's position). Handler returns 404 in production.
  {
    id: "cpk-debug-events",
    methods: ["GET"],
    match: (segments) => {
      const len = segments.length;
      if (len >= 1 && segments[len - 1] === "cpk-debug-events") {
        return { method: "cpk-debug-events" };
      }
      return null;
    },
    handler: ({ runtime, request }) =>
      Promise.resolve(handleDebugEvents({ runtime, request })),
  },

  // /agent/:agentId/run  (POST)
  {
    id: "agent/run",
    methods: ["POST"],
    match: (segments) => {
      const len = segments.length;
      if (
        len >= 3 &&
        segments[len - 3] === "agent" &&
        segments[len - 1] === "run"
      ) {
        const agentId = safeDecodeURIComponent(segments[len - 2]!);
        if (!agentId) return null;
        return { method: "agent/run", agentId };
      }
      return null;
    },
    handler: ({ runtime, request, route }) => {
      if (route.method !== "agent/run") throw new Error("route mismatch");
      return handleRunAgent({ runtime, request, agentId: route.agentId });
    },
  },

  // /agent/:agentId/connect  (POST)
  {
    id: "agent/connect",
    methods: ["POST"],
    match: (segments) => {
      const len = segments.length;
      if (
        len >= 3 &&
        segments[len - 3] === "agent" &&
        segments[len - 1] === "connect"
      ) {
        const agentId = safeDecodeURIComponent(segments[len - 2]!);
        if (!agentId) return null;
        return { method: "agent/connect", agentId };
      }
      return null;
    },
    handler: ({ runtime, request, route }) => {
      if (route.method !== "agent/connect") throw new Error("route mismatch");
      return handleConnectAgent({ runtime, request, agentId: route.agentId });
    },
  },

  // /agent/:agentId/stop/:threadId  (POST)
  {
    id: "agent/stop",
    methods: ["POST"],
    match: (segments) => {
      const len = segments.length;
      if (
        len >= 4 &&
        segments[len - 4] === "agent" &&
        segments[len - 2] === "stop"
      ) {
        const agentId = safeDecodeURIComponent(segments[len - 3]!);
        const threadId = safeDecodeURIComponent(segments[len - 1]!);
        if (!agentId || !threadId) return null;
        return { method: "agent/stop", agentId, threadId };
      }
      return null;
    },
    handler: ({ runtime, request, route }) => {
      if (route.method !== "agent/stop") throw new Error("route mismatch");
      return handleStopAgent({
        runtime,
        request,
        agentId: route.agentId,
        threadId: route.threadId,
      });
    },
  },

  // /threads/subscribe  (POST)  — must precede the /threads/:threadId entry
  {
    id: "threads/subscribe",
    methods: ["POST"],
    match: (segments) => {
      const len = segments.length;
      if (
        len >= 2 &&
        segments[len - 2] === "threads" &&
        segments[len - 1] === "subscribe"
      ) {
        return { method: "threads/subscribe" };
      }
      return null;
    },
    handler: ({ runtime, request }) =>
      handleSubscribeToThreads({ runtime, request }),
  },

  // /threads/:threadId/messages  (GET)
  {
    id: "threads/messages",
    methods: ["GET"],
    match: (segments) => {
      const len = segments.length;
      if (
        len >= 3 &&
        segments[len - 3] === "threads" &&
        segments[len - 1] === "messages"
      ) {
        const threadId = safeDecodeURIComponent(segments[len - 2]!);
        if (!threadId) return null;
        return { method: "threads/messages", threadId };
      }
      return null;
    },
    handler: ({ runtime, request, route }) => {
      if (route.method !== "threads/messages")
        throw new Error("route mismatch");
      return handleGetThreadMessages({
        runtime,
        request,
        threadId: route.threadId,
      });
    },
  },

  // /threads/:threadId/events  (GET)
  {
    id: "threads/events",
    methods: ["GET"],
    match: (segments) => {
      const len = segments.length;
      if (
        len >= 3 &&
        segments[len - 3] === "threads" &&
        segments[len - 1] === "events"
      ) {
        const threadId = safeDecodeURIComponent(segments[len - 2]!);
        if (!threadId) return null;
        return { method: "threads/events", threadId };
      }
      return null;
    },
    handler: ({ runtime, request, route }) => {
      if (route.method !== "threads/events") throw new Error("route mismatch");
      return handleGetThreadEvents({
        runtime,
        request,
        threadId: route.threadId,
      });
    },
  },

  // /threads/:threadId/state  (GET)
  {
    id: "threads/state",
    methods: ["GET"],
    match: (segments) => {
      const len = segments.length;
      if (
        len >= 3 &&
        segments[len - 3] === "threads" &&
        segments[len - 1] === "state"
      ) {
        const threadId = safeDecodeURIComponent(segments[len - 2]!);
        if (!threadId) return null;
        return { method: "threads/state", threadId };
      }
      return null;
    },
    handler: ({ runtime, request, route }) => {
      if (route.method !== "threads/state") throw new Error("route mismatch");
      return handleGetThreadState({
        runtime,
        request,
        threadId: route.threadId,
      });
    },
  },

  // /threads/:threadId/archive  (POST)
  {
    id: "threads/archive",
    methods: ["POST"],
    match: (segments) => {
      const len = segments.length;
      if (
        len >= 3 &&
        segments[len - 3] === "threads" &&
        segments[len - 1] === "archive"
      ) {
        const threadId = safeDecodeURIComponent(segments[len - 2]!);
        if (!threadId) return null;
        return { method: "threads/archive", threadId };
      }
      return null;
    },
    handler: ({ runtime, request, route }) => {
      if (route.method !== "threads/archive") throw new Error("route mismatch");
      return handleArchiveThread({
        runtime,
        request,
        threadId: route.threadId,
      });
    },
  },

  // /threads/clear  (POST)  — must precede /threads/:threadId
  {
    id: "threads/clear",
    methods: ["POST"],
    match: (segments) => {
      const len = segments.length;
      if (
        len >= 2 &&
        segments[len - 2] === "threads" &&
        segments[len - 1] === "clear"
      ) {
        return { method: "threads/clear" };
      }
      return null;
    },
    handler: ({ runtime, request }) =>
      Promise.resolve(handleClearThreads({ runtime, request })),
  },

  // /threads/:threadId  (PATCH | DELETE)  — bare-thread update/delete.
  // The handler dispatches by HTTP method.
  {
    id: "threads/update",
    methods: ["PATCH", "DELETE"],
    match: (segments) => {
      const len = segments.length;
      if (
        len >= 2 &&
        segments[len - 2] === "threads" &&
        segments[len - 1] !== "subscribe" &&
        segments[len - 1] !== "clear"
      ) {
        const threadId = safeDecodeURIComponent(segments[len - 1]!);
        if (!threadId) return null;
        return { method: "threads/update", threadId };
      }
      return null;
    },
    handler: ({ runtime, request, route }) => {
      if (route.method !== "threads/update") throw new Error("route mismatch");
      if (request.method.toUpperCase() === "DELETE") {
        return handleDeleteThread({
          runtime,
          request,
          threadId: route.threadId,
        });
      }
      return handleUpdateThread({
        runtime,
        request,
        threadId: route.threadId,
      });
    },
  },

  // /threads  (GET)  — list. Last because it's the broadest /threads pattern.
  {
    id: "threads/list",
    methods: ["GET"],
    match: (segments) => {
      const len = segments.length;
      if (len >= 1 && segments[len - 1] === "threads") {
        return { method: "threads/list" };
      }
      return null;
    },
    handler: ({ runtime, request }) => handleListThreads({ runtime, request }),
  },
];

/* ------------------------------------------------------------------------------------------------
 * Lookup helpers
 * --------------------------------------------------------------------------------------------- */

/**
 * Find the first route whose pattern matches the given trailing path segments.
 */
export function matchSegmentsAgainstRoutes(
  segments: string[],
): { entry: RouteEntry; route: RouteInfo } | null {
  for (const entry of ALL_ROUTES) {
    const route = entry.match(segments);
    if (route) return { entry, route };
  }
  return null;
}

/**
 * Find the route entry by the discriminator on a resolved RouteInfo.
 */
export function findRouteEntry(
  routeMethod: RouteInfo["method"],
): RouteEntry | undefined {
  return ALL_ROUTES.find((entry) => entry.id === routeMethod);
}
