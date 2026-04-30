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
  _loadingMessages: boolean;
  _loadingEvents: boolean;
  _loadingState: boolean;
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
      const promise = new Promise<Response>((resolve, reject) => {
        const call: FetchCall = {
          url,
          signal: init?.signal ?? undefined,
          resolve,
          reject,
        };
        calls.push(call);
        // Forward AbortController.abort() into the pending promise so
        // production code's `signal: controller.signal` path resolves.
        // Production code's `signal.aborted` short-circuit handles the
        // aborted case, so we still reject with AbortError to mirror the
        // browser's fetch behavior.
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
      // Attach a no-op .catch so an AbortError rejection doesn't surface as
      // an unhandled promise rejection in tests that switch threadIds before
      // resolving the original fetch. Production code awaits these promises
      // and short-circuits via signal.aborted; the no-op catch is purely a
      // test-environment stability shim.
      promise.catch(() => {});
      return promise;
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
    // noUncheckedIndexedAccess: explicit non-null after the length check
    // above makes this safe and keeps the destructure type-clean.
    const msgs1 = mock.calls[0]!;
    const events1 = mock.calls[1]!;
    const state1 = mock.calls[2]!;
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
    expect(new URL(mock.calls[3]!.url).pathname).toBe("/threads/t2/messages");
    expect(new URL(mock.calls[4]!.url).pathname).toBe("/threads/t2/events");
    expect(new URL(mock.calls[5]!.url).pathname).toBe("/threads/t2/state");
  });

  it("disconnectedCallback aborts all in-flight fetches", () => {
    const el = makeEl();
    el.runtimeUrl = "http://runtime.test";
    el.threadId = "t1";
    el.updated(new Map([["threadId", null]]));
    expect(mock.calls).toHaveLength(3);
    const msgs = mock.calls[0]!;
    const events = mock.calls[1]!;
    const state = mock.calls[2]!;

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

  it("clears all per-tab loading flags when threadId transitions to null", async () => {
    // Regression: aborted fetches' finally blocks only clear the loading flag
    // when the controller is the currently-active one. On threadId → null,
    // _abortAllFetches() aborts the in-flight controllers and the `if
    // (this.threadId)` guard skips the new fetches, so without an explicit
    // reset in updated() the three loading flags would stay true forever and
    // the renderer would be stuck on "Loading…".
    const el = makeEl();
    el.runtimeUrl = "http://runtime.test";

    el.threadId = "t1";
    el.updated(new Map([["threadId", null]]));
    // Three fetches start; the in-flight loading flags are now true.
    expect(mock.calls).toHaveLength(3);
    expect(el._loadingMessages).toBe(true);
    expect(el._loadingEvents).toBe(true);
    expect(el._loadingState).toBe(true);

    // Transition threadId → null while fetches are still pending.
    el.threadId = null;
    el.updated(new Map([["threadId", "t1"]]));
    // Drain microtasks so any aborted fetch's finally blocks run.
    await new Promise((r) => setTimeout(r, 0));

    expect(el._loadingMessages).toBe(false);
    expect(el._loadingEvents).toBe(false);
    expect(el._loadingState).toBe(false);
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

  it("does not let an older fetch's resumed microtask clobber a newer thread's data (CR R3 #9)", async () => {
    // Reproduces the race fixed in CPK-7193 review round 3: between
    // `await fetch(...)` and `await res.json()`, a fast threadId switch
    // aborts the original controller. Without the post-json aborted-check,
    // the older fetch's resumed microtask still writes its parsed payload
    // into _conversation/_fetchedEvents/_fetchedState, overwriting the
    // newer thread's already-loaded data.
    const el = makeEl();
    el.runtimeUrl = "http://runtime.test";

    // Kick off t1's fetches.
    el.threadId = "t1";
    el.updated(new Map([["threadId", null]]));
    expect(mock.calls).toHaveLength(3);

    // Capture t1's calls. We resolve t1's fetch BEFORE switching threadId,
    // but we DON'T let the resulting microtask drain — that microtask is
    // what carries the post-`await res.json()` write. The `init?.signal`
    // wired by installFetchMock will still fire abort when threadId
    // changes, so the await-aborted-check is the only thing that prevents
    // the late write.
    const t1Messages = mock.calls.find(
      (c) => c.url === "http://runtime.test/threads/t1/messages",
    )!;
    const t1Events = mock.calls.find(
      (c) => c.url === "http://runtime.test/threads/t1/events",
    )!;
    const t1State = mock.calls.find(
      (c) => c.url === "http://runtime.test/threads/t1/state",
    )!;

    // Resolve t1's responses so `await res.json()` is queued as a
    // microtask. Crucially, do NOT yield to the event loop yet — the
    // microtasks are queued but won't run until we await later.
    t1Messages.resolve(
      jsonResponse({
        messages: [{ id: "m1", role: "user", content: "FROM T1" }],
      }),
    );
    t1Events.resolve(
      jsonResponse({ events: [{ type: "T1_EVENT", timestamp: 1 }] }),
    );
    t1State.resolve(jsonResponse({ state: { from: "t1" } }));

    // Now switch to t2. updated() aborts t1's controllers, then kicks off
    // t2's fetches. Resolve t2's synchronously and drain to settle.
    el.threadId = "t2";
    el.updated(new Map([["threadId", "t1"]]));
    expect(mock.calls).toHaveLength(6);
    const t2Messages = mock.calls.find(
      (c) => c.url === "http://runtime.test/threads/t2/messages",
    )!;
    const t2Events = mock.calls.find(
      (c) => c.url === "http://runtime.test/threads/t2/events",
    )!;
    const t2State = mock.calls.find(
      (c) => c.url === "http://runtime.test/threads/t2/state",
    )!;
    t2Messages.resolve(
      jsonResponse({
        messages: [{ id: "m2", role: "user", content: "FROM T2" }],
      }),
    );
    t2Events.resolve(
      jsonResponse({ events: [{ type: "T2_EVENT", timestamp: 2 }] }),
    );
    t2State.resolve(jsonResponse({ state: { from: "t2" } }));

    // Drain microtasks. Both t1's and t2's queued `await res.json()`
    // microtasks resume now. With the fix, t1's resumed microtasks see
    // controller.signal.aborted === true and bail BEFORE writing.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // Final state should reflect t2's data, not t1's stale write.
    const conv = el._conversation as Array<{ content: string }>;
    expect(conv).toHaveLength(1);
    expect(conv[0]!.content).toBe("FROM T2");
    const events = el._fetchedEvents as Array<{ type: string }>;
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("T2_EVENT");
    expect(el._fetchedState).toEqual({ from: "t2" });
  });
});
