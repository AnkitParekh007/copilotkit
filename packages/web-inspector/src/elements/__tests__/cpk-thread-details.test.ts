import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Importing the module registers the custom element. We construct the element
// directly and exercise its methods rather than mounting it, so we don't have
// to drive a full Lit render lifecycle in jsdom.
import "../cpk-thread-details";

// The element exposes its behavior through private members. There is no
// public API equivalent for these state slots, so the test-only cast is
// unavoidable. We mirror the gate-test pattern for consistency.
type DetailsInternals = {
  threadId: string | null;
  runtimeUrl: string;
  headers: Record<string, string>;
  conversationOverride: unknown;
  // Private state under test.
  _conversation: unknown[];
  _fetchedEvents: unknown;
  _fetchedState: unknown;
  _eventsNotAvailable: boolean;
  _stateNotAvailable: boolean;
  _messagesAbort: AbortController | null;
  _eventsAbort: AbortController | null;
  _stateAbort: AbortController | null;
  // Private methods we drive directly. updated() is Lit's protected lifecycle
  // hook; calling it manually is the equivalent of "the prop changed and Lit
  // committed".
  updated: (changed: Map<string, unknown>) => void;
  disconnectedCallback: () => void;
};

function makeEl(): HTMLElement & DetailsInternals {
  const el = document.createElement(
    "cpk-thread-details",
  ) as unknown as HTMLElement & DetailsInternals;
  // Stub render — we're testing fetch/abort behavior, not template output.
  Object.defineProperty(el, "render", { value: () => null });
  return el;
}

type FetchCall = {
  url: string;
  signal: AbortSignal | undefined;
  resolve: (res: Response) => void;
  reject: (err: Error) => void;
};

/**
 * Installs a controllable fetch mock. Each call returns a Promise that the
 * test resolves manually, so we can interleave "start fetch A, change
 * threadId, observe A's signal aborted" sequences deterministically.
 */
function installFetchMock(): {
  calls: FetchCall[];
  restore: () => void;
} {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = vi.fn(
    (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      return new Promise<Response>((resolve, reject) => {
        const call: FetchCall = {
          url,
          signal: init?.signal ?? undefined,
          resolve,
          reject,
        };
        calls.push(call);
        // Forward AbortController.abort() into the pending promise so
        // production code's `signal: controller.signal` path resolves.
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    },
  ) as unknown as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("cpk-thread-details", () => {
  let mock: ReturnType<typeof installFetchMock>;

  beforeEach(() => {
    mock = installFetchMock();
  });

  afterEach(() => {
    mock.restore();
  });

  it("registers as cpk-thread-details", () => {
    expect(customElements.get("cpk-thread-details")).toBeDefined();
  });

  it("starts a /messages, /events, and /state fetch when threadId becomes set", () => {
    const el = makeEl();
    el.runtimeUrl = "http://runtime.test";
    el.threadId = "t1";
    el.updated(new Map([["threadId", null]]));

    const paths = mock.calls.map((c) => new URL(c.url).pathname);
    expect(paths).toEqual([
      "/threads/t1/messages",
      "/threads/t1/events",
      "/threads/t1/state",
    ]);
  });

  it("aborts the previous thread's in-flight fetches when threadId changes", async () => {
    const el = makeEl();
    el.runtimeUrl = "http://runtime.test";

    el.threadId = "t1";
    el.updated(new Map([["threadId", null]]));
    expect(mock.calls).toHaveLength(3);
    const [msgs1, events1, state1] = mock.calls;
    // Each tab has its own AbortController, so each call sees a distinct,
    // not-yet-aborted signal.
    expect(msgs1.signal?.aborted).toBe(false);
    expect(events1.signal?.aborted).toBe(false);
    expect(state1.signal?.aborted).toBe(false);
    expect(msgs1.signal).not.toBe(events1.signal);
    expect(events1.signal).not.toBe(state1.signal);

    // Switch threads. The three previous controllers must all abort.
    el.threadId = "t2";
    el.updated(new Map([["threadId", "t1"]]));
    expect(msgs1.signal?.aborted).toBe(true);
    expect(events1.signal?.aborted).toBe(true);
    expect(state1.signal?.aborted).toBe(true);

    // And three brand-new fetches should have been issued for t2.
    expect(mock.calls).toHaveLength(6);
    expect(new URL(mock.calls[3].url).pathname).toBe("/threads/t2/messages");
    expect(new URL(mock.calls[4].url).pathname).toBe("/threads/t2/events");
    expect(new URL(mock.calls[5].url).pathname).toBe("/threads/t2/state");
  });

  it("disconnectedCallback aborts all in-flight fetches", () => {
    const el = makeEl();
    el.runtimeUrl = "http://runtime.test";
    el.threadId = "t1";
    el.updated(new Map([["threadId", null]]));
    const [msgs, events, state] = mock.calls;

    el.disconnectedCallback();

    expect(msgs.signal?.aborted).toBe(true);
    expect(events.signal?.aborted).toBe(true);
    expect(state.signal?.aborted).toBe(true);
    // Field references cleared so no stale controller hangs around.
    expect(el._messagesAbort).toBeNull();
    expect(el._eventsAbort).toBeNull();
    expect(el._stateAbort).toBeNull();
  });

  it("a 501 from /events sets _eventsNotAvailable and clears fetched events", async () => {
    const el = makeEl();
    el.runtimeUrl = "http://runtime.test";
    el.threadId = "t1";
    el.updated(new Map([["threadId", null]]));

    const eventsCall = mock.calls.find((c) =>
      c.url.endsWith("/events"),
    ) as FetchCall;
    eventsCall.resolve(new Response(null, { status: 501 }));
    // Resolve the other two so unhandled rejections don't fire.
    mock.calls
      .find((c) => c.url.endsWith("/messages"))!
      .resolve(jsonResponse({ messages: [] }));
    mock.calls
      .find((c) => c.url.endsWith("/state"))!
      .resolve(jsonResponse({ state: null }));
    // Drain microtasks so the fetcher's await chain commits state.
    await new Promise((r) => setTimeout(r, 0));

    expect(el._eventsNotAvailable).toBe(true);
    expect(el._fetchedEvents).toBeNull();
    // The other tab's sentinel must not have been touched.
    expect(el._stateNotAvailable).toBe(false);
  });

  it("a 501 from /state sets _stateNotAvailable and clears fetched state", async () => {
    const el = makeEl();
    el.runtimeUrl = "http://runtime.test";
    el.threadId = "t1";
    el.updated(new Map([["threadId", null]]));

    const stateCall = mock.calls.find((c) =>
      c.url.endsWith("/state"),
    ) as FetchCall;
    stateCall.resolve(new Response(null, { status: 501 }));
    mock.calls
      .find((c) => c.url.endsWith("/messages"))!
      .resolve(jsonResponse({ messages: [] }));
    mock.calls
      .find((c) => c.url.endsWith("/events"))!
      .resolve(jsonResponse({ events: [] }));
    await new Promise((r) => setTimeout(r, 0));

    expect(el._stateNotAvailable).toBe(true);
    expect(el._fetchedState).toBeNull();
    expect(el._eventsNotAvailable).toBe(false);
  });

  it("a 200 /events response populates _fetchedEvents and leaves the sentinel false", async () => {
    const el = makeEl();
    el.runtimeUrl = "http://runtime.test";
    el.threadId = "t1";
    el.updated(new Map([["threadId", null]]));

    const events = [
      { type: "RUN_STARTED", timestamp: 1, payload: {} },
      { type: "TEXT_MESSAGE_CONTENT", timestamp: 2, payload: { delta: "hi" } },
    ];
    mock.calls
      .find((c) => c.url.endsWith("/events"))!
      .resolve(jsonResponse({ events }));
    mock.calls
      .find((c) => c.url.endsWith("/messages"))!
      .resolve(jsonResponse({ messages: [] }));
    mock.calls
      .find((c) => c.url.endsWith("/state"))!
      .resolve(jsonResponse({ state: { foo: "bar" } }));
    await new Promise((r) => setTimeout(r, 0));

    expect(el._eventsNotAvailable).toBe(false);
    expect(Array.isArray(el._fetchedEvents)).toBe(true);
    expect((el._fetchedEvents as unknown[]).length).toBe(2);
  });

  it("a 200 /state response populates _fetchedState and leaves the sentinel false", async () => {
    const el = makeEl();
    el.runtimeUrl = "http://runtime.test";
    el.threadId = "t1";
    el.updated(new Map([["threadId", null]]));

    mock.calls
      .find((c) => c.url.endsWith("/state"))!
      .resolve(jsonResponse({ state: { count: 7 } }));
    mock.calls
      .find((c) => c.url.endsWith("/messages"))!
      .resolve(jsonResponse({ messages: [] }));
    mock.calls
      .find((c) => c.url.endsWith("/events"))!
      .resolve(jsonResponse({ events: [] }));
    await new Promise((r) => setTimeout(r, 0));

    expect(el._stateNotAvailable).toBe(false);
    expect(el._fetchedState).toEqual({ count: 7 });
  });

  it("a 200 /messages response with a user message is mapped into the conversation", async () => {
    const el = makeEl();
    el.runtimeUrl = "http://runtime.test";
    el.threadId = "t1";
    el.updated(new Map([["threadId", null]]));

    mock.calls.find((c) => c.url.endsWith("/messages"))!.resolve(
      jsonResponse({
        messages: [{ id: "m1", role: "user", content: "hello" }],
      }),
    );
    mock.calls
      .find((c) => c.url.endsWith("/events"))!
      .resolve(jsonResponse({ events: [] }));
    mock.calls
      .find((c) => c.url.endsWith("/state"))!
      .resolve(jsonResponse({ state: null }));
    await new Promise((r) => setTimeout(r, 0));

    expect(el._conversation).toHaveLength(1);
    const first = el._conversation[0] as { type: string; content: string };
    expect(first.type).toBe("user");
    expect(first.content).toBe("hello");
  });
});
