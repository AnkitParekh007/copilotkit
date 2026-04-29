import { describe, it, expect } from "vitest";
import { matchRoute } from "../core/fetch-router";

describe("fetch-router", () => {
  describe("with basePath (strict prefix stripping)", () => {
    const basePath = "/api/copilotkit";

    it("matches GET /info", () => {
      const result = matchRoute("/api/copilotkit/info", basePath);
      expect(result).toEqual({ method: "info" });
    });

    it("matches POST /transcribe", () => {
      const result = matchRoute("/api/copilotkit/transcribe", basePath);
      expect(result).toEqual({ method: "transcribe" });
    });

    it("matches POST /agent/:agentId/run", () => {
      const result = matchRoute("/api/copilotkit/agent/myAgent/run", basePath);
      expect(result).toEqual({ method: "agent/run", agentId: "myAgent" });
    });

    it("matches POST /agent/:agentId/connect", () => {
      const result = matchRoute(
        "/api/copilotkit/agent/myAgent/connect",
        basePath,
      );
      expect(result).toEqual({ method: "agent/connect", agentId: "myAgent" });
    });

    it("matches POST /agent/:agentId/stop/:threadId", () => {
      const result = matchRoute(
        "/api/copilotkit/agent/myAgent/stop/thread-123",
        basePath,
      );
      expect(result).toEqual({
        method: "agent/stop",
        agentId: "myAgent",
        threadId: "thread-123",
      });
    });

    it("returns null for paths not starting with basePath", () => {
      const result = matchRoute("/other/info", basePath);
      expect(result).toBeNull();
    });

    it("returns null for unmatched subpaths after basePath", () => {
      const result = matchRoute("/api/copilotkit/unknown", basePath);
      expect(result).toBeNull();
    });

    it("matches GET /threads", () => {
      const result = matchRoute("/api/copilotkit/threads", basePath);
      expect(result).toEqual({ method: "threads/list" });
    });

    it("matches POST /threads/subscribe", () => {
      const result = matchRoute("/api/copilotkit/threads/subscribe", basePath);
      expect(result).toEqual({ method: "threads/subscribe" });
    });

    it("matches PATCH /threads/:threadId", () => {
      const result = matchRoute("/api/copilotkit/threads/thread-abc", basePath);
      expect(result).toEqual({
        method: "threads/update",
        threadId: "thread-abc",
      });
    });

    it("matches POST /threads/:threadId/archive", () => {
      const result = matchRoute(
        "/api/copilotkit/threads/thread-abc/archive",
        basePath,
      );
      expect(result).toEqual({
        method: "threads/archive",
        threadId: "thread-abc",
      });
    });

    it("matches GET /threads/:threadId/messages", () => {
      const result = matchRoute(
        "/api/copilotkit/threads/thread-abc/messages",
        basePath,
      );
      expect(result).toEqual({
        method: "threads/messages",
        threadId: "thread-abc",
      });
    });

    describe("threads/:threadId/events", () => {
      it("matches GET /threads/:threadId/events with simple id", () => {
        const result = matchRoute(
          "/api/copilotkit/threads/abc-123/events",
          basePath,
        );
        expect(result).toEqual({
          method: "threads/events",
          threadId: "abc-123",
        });
      });

      it("matches with a UUID-style threadId", () => {
        const result = matchRoute(
          "/api/copilotkit/threads/3f5b9e88-1d2a-4c5e-90f6-2c9bbb3f1234/events",
          basePath,
        );
        expect(result).toEqual({
          method: "threads/events",
          threadId: "3f5b9e88-1d2a-4c5e-90f6-2c9bbb3f1234",
        });
      });

      it("decodes a URL-encoded threadId", () => {
        const result = matchRoute(
          "/api/copilotkit/threads/thread%2F123/events",
          basePath,
        );
        expect(result).toEqual({
          method: "threads/events",
          threadId: "thread/123",
        });
      });

      it("does not match the events route for /threads//events (empty threadId segment)", () => {
        // The empty segment is filtered out by split("/").filter(Boolean), so
        // the path collapses to /threads/events — only 2 segments. That fails
        // the 3-segment events pattern but does match the 2-segment
        // /threads/:threadId update pattern with threadId="events". The
        // method-validation layer in fetch-handler.ts would then reject a GET
        // request because "threads/update" only accepts PATCH/DELETE. The
        // router-level invariant we care about here is that the events
        // handler is NOT selected for this malformed URL.
        const result = matchRoute(
          "/api/copilotkit/threads//events",
          basePath,
        );
        expect(result?.method).not.toBe("threads/events");
      });

      it("does not match the events route for /threads/foo/events/extra (extra trailing segment)", () => {
        // Suffix matching only inspects the trailing segments. /…/events/extra
        // ends in `extra`, not `events`, so the events pattern cannot match
        // and we expect either a different match or null — never threads/events.
        const result = matchRoute(
          "/api/copilotkit/threads/foo/events/extra",
          basePath,
        );
        expect(result?.method).not.toBe("threads/events");
      });
    });

    describe("threads/:threadId/state", () => {
      it("matches GET /threads/:threadId/state with simple id", () => {
        const result = matchRoute(
          "/api/copilotkit/threads/abc-123/state",
          basePath,
        );
        expect(result).toEqual({
          method: "threads/state",
          threadId: "abc-123",
        });
      });

      it("matches with a UUID-style threadId", () => {
        const result = matchRoute(
          "/api/copilotkit/threads/3f5b9e88-1d2a-4c5e-90f6-2c9bbb3f1234/state",
          basePath,
        );
        expect(result).toEqual({
          method: "threads/state",
          threadId: "3f5b9e88-1d2a-4c5e-90f6-2c9bbb3f1234",
        });
      });

      it("decodes a URL-encoded threadId", () => {
        const result = matchRoute(
          "/api/copilotkit/threads/thread%2F123/state",
          basePath,
        );
        expect(result).toEqual({
          method: "threads/state",
          threadId: "thread/123",
        });
      });

      it("does not match the state route for /threads//state (empty threadId segment)", () => {
        // See the events parallel above: the empty segment is filtered out
        // before pattern matching, so this falls back to the
        // /threads/:threadId update pattern. We assert only that the state
        // handler is NOT selected for the malformed URL.
        const result = matchRoute(
          "/api/copilotkit/threads//state",
          basePath,
        );
        expect(result?.method).not.toBe("threads/state");
      });

      it("does not match the state route for /threads/foo/state/extra (extra trailing segment)", () => {
        const result = matchRoute(
          "/api/copilotkit/threads/foo/state/extra",
          basePath,
        );
        expect(result?.method).not.toBe("threads/state");
      });
    });

    it("handles URL-encoded threadId in thread routes", () => {
      const result = matchRoute(
        "/api/copilotkit/threads/thread%2F123",
        basePath,
      );
      expect(result).toEqual({
        method: "threads/update",
        threadId: "thread/123",
      });
    });

    it("returns null when basePath is a prefix but not a segment boundary", () => {
      const result = matchRoute("/api/copilotkitextra/info", basePath);
      expect(result).toBeNull();
    });

    it("handles basePath with trailing slash", () => {
      const result = matchRoute("/api/copilotkit/info", "/api/copilotkit/");
      expect(result).toEqual({ method: "info" });
    });

    it("handles URL-encoded agentId", () => {
      const result = matchRoute(
        "/api/copilotkit/agent/my%20agent/run",
        basePath,
      );
      expect(result).toEqual({ method: "agent/run", agentId: "my agent" });
    });

    it("handles URL-encoded threadId", () => {
      const result = matchRoute(
        "/api/copilotkit/agent/ag/stop/thread%2F123",
        basePath,
      );
      expect(result).toEqual({
        method: "agent/stop",
        agentId: "ag",
        threadId: "thread/123",
      });
    });

    it("matches basePath with just root /", () => {
      const result = matchRoute("/info", "/");
      expect(result).toEqual({ method: "info" });
    });

    it("matches GET /cpk-debug-events", () => {
      const result = matchRoute("/api/copilotkit/cpk-debug-events", basePath);
      expect(result).toEqual({ method: "cpk-debug-events" });
    });
  });

  describe("without basePath (suffix matching)", () => {
    it("matches /info suffix", () => {
      const result = matchRoute("/anything/info");
      expect(result).toEqual({ method: "info" });
    });

    it("matches /transcribe suffix", () => {
      const result = matchRoute("/anything/transcribe");
      expect(result).toEqual({ method: "transcribe" });
    });

    it("matches /agent/:agentId/run suffix", () => {
      const result = matchRoute("/anything/agent/myAgent/run");
      expect(result).toEqual({ method: "agent/run", agentId: "myAgent" });
    });

    it("matches /agent/:agentId/connect suffix", () => {
      const result = matchRoute("/anything/agent/myAgent/connect");
      expect(result).toEqual({
        method: "agent/connect",
        agentId: "myAgent",
      });
    });

    it("matches /agent/:agentId/stop/:threadId suffix", () => {
      const result = matchRoute("/anything/agent/ag/stop/t1");
      expect(result).toEqual({
        method: "agent/stop",
        agentId: "ag",
        threadId: "t1",
      });
    });

    it("returns null when no known suffix matches", () => {
      const result = matchRoute("/anything/unknown");
      expect(result).toBeNull();
    });

    it("matches /threads suffix", () => {
      const result = matchRoute("/anything/threads");
      expect(result).toEqual({ method: "threads/list" });
    });

    it("matches /threads/subscribe suffix", () => {
      const result = matchRoute("/anything/threads/subscribe");
      expect(result).toEqual({ method: "threads/subscribe" });
    });

    it("matches /threads/:threadId suffix", () => {
      const result = matchRoute("/anything/threads/t1");
      expect(result).toEqual({ method: "threads/update", threadId: "t1" });
    });

    it("matches /threads/:threadId/archive suffix", () => {
      const result = matchRoute("/anything/threads/t1/archive");
      expect(result).toEqual({ method: "threads/archive", threadId: "t1" });
    });

    it("matches /threads/:threadId/messages suffix", () => {
      const result = matchRoute("/anything/threads/t1/messages");
      expect(result).toEqual({ method: "threads/messages", threadId: "t1" });
    });

    it("matches /threads/:threadId/events suffix", () => {
      const result = matchRoute("/anything/threads/t1/events");
      expect(result).toEqual({ method: "threads/events", threadId: "t1" });
    });

    it("matches /threads/:threadId/state suffix", () => {
      const result = matchRoute("/anything/threads/t1/state");
      expect(result).toEqual({ method: "threads/state", threadId: "t1" });
    });

    it("works with deeply nested mount prefix", () => {
      const result = matchRoute("/api/v2/copilotkit/agent/a1/run");
      expect(result).toEqual({ method: "agent/run", agentId: "a1" });
    });

    it("matches /cpk-debug-events suffix", () => {
      const result = matchRoute("/api/copilotkit/cpk-debug-events");
      expect(result).toEqual({ method: "cpk-debug-events" });
    });

    it("matches bare /cpk-debug-events", () => {
      const result = matchRoute("/cpk-debug-events");
      expect(result).toEqual({ method: "cpk-debug-events" });
    });
  });

  describe("cpk-debug-events route with basePath", () => {
    it("matches /cpk-debug-events with /api basePath", () => {
      const result = matchRoute("/api/cpk-debug-events", "/api");
      expect(result).toEqual({ method: "cpk-debug-events" });
    });
  });
});
