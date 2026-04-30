import { WebInspectorElement } from "../index";
import {
  CopilotKitCore,
  CopilotKitCoreRuntimeConnectionStatus,
  type CopilotKitCoreSubscriber,
} from "@copilotkit/core";
import type { AbstractAgent, AgentSubscriber } from "@ag-ui/client";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Types for accessing LitElement-private reactive properties ---
// WebInspectorElement stores these as private Lit reactive properties.
// There's no public API to read them, so the cast is unavoidable in tests.

type InspectorInternals = {
  flattenedEvents: Array<{ type: string }>;
  agentMessages: Map<string, Array<{ contentText?: string }>>;
  agentStates: Map<string, unknown>;
  cachedTools: Array<{ name: string }>;
  _ownedThreadStores: Map<string, unknown>;
  _threadStoreSubscriptions: Map<string, () => void>;
  _threadsByAgent: Map<string, Array<{ id: string; agentId: string }>>;
  _threads: Array<{ id: string; agentId: string }>;
  selectedThreadId: string | null;
};

type InspectorContextInternals = {
  contextStore: Record<string, { description?: string; value: unknown }>;
  copyContextValue: (value: unknown, id: string) => Promise<void>;
  persistState: () => void;
};

// --- Mock agent factory ---

type MockAgentExtras = Partial<{
  messages: unknown;
  state: unknown;
  toolHandlers: Record<string, unknown>;
  toolRenderers: Record<string, unknown>;
}>;

type MockAgentController = {
  // Each subscriber method has a different parameter shape — TypeScript
  // can't narrow a dynamic key lookup, so the internal cast is unavoidable.
  emit: (key: keyof AgentSubscriber, payload: unknown) => void;
  /** Simulate AbstractAgent.setState(): mutate the mock's state and notify subscribers. */
  simulateSetState: (newState: Record<string, unknown>) => void;
};

function createMockAgent(
  agentId: string,
  extras: MockAgentExtras = {},
): { agent: AbstractAgent; controller: MockAgentController } {
  const subscribers = new Set<AgentSubscriber>();

  const agentObj = {
    agentId,
    ...extras,
    subscribe(subscriber: AgentSubscriber) {
      subscribers.add(subscriber);
      return {
        unsubscribe: () => subscribers.delete(subscriber),
      };
    },
  };

  const emit = (key: keyof AgentSubscriber, payload: unknown) => {
    subscribers.forEach((subscriber) => {
      const handler = subscriber[key];
      if (handler) {
        (handler as (arg: unknown) => void)(payload);
      }
    });
  };

  const simulateSetState = (newState: Record<string, unknown>) => {
    agentObj.state = newState;
    emit("onStateChanged", {
      state: newState,
      messages: agentObj.messages ?? [],
      agent: agentObj,
    });
  };

  // AbstractAgent is an abstract class — our plain-object mock satisfies
  // the subset the inspector uses but can't extend the class.
  return {
    agent: agentObj as unknown as AbstractAgent,
    controller: { emit, simulateSetState },
  };
}

// --- Mock core factory ---

type MockCore = {
  agents: Record<string, AbstractAgent>;
  context: Record<string, unknown>;
  properties: Record<string, unknown>;
  headers: Record<string, string>;
  runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus;
  runtimeUrl?: string;
  subscribe: (subscriber: CopilotKitCoreSubscriber) => {
    unsubscribe: () => void;
  };
  getThreadStores: () => Record<string, unknown>;
  getThreadStore: (agentId: string) => unknown;
  registerThreadStore: (agentId: string, store: unknown) => void;
  unregisterThreadStore: (agentId: string) => void;
};

function createMockCore(
  initialAgents: Record<string, AbstractAgent> = {},
  options: { runtimeUrl?: string; headers?: Record<string, string> } = {},
) {
  const subscribers = new Set<CopilotKitCoreSubscriber>();
  const stores = new Map<string, unknown>();
  const core: MockCore = {
    agents: initialAgents,
    context: {},
    properties: {},
    headers: options.headers ?? {},
    runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Connected,
    runtimeUrl: options.runtimeUrl,
    subscribe(subscriber: CopilotKitCoreSubscriber) {
      subscribers.add(subscriber);
      return { unsubscribe: () => subscribers.delete(subscriber) };
    },
    getThreadStores() {
      return Object.fromEntries(stores);
    },
    getThreadStore(agentId: string) {
      return stores.get(agentId);
    },
    registerThreadStore(agentId: string, store: unknown) {
      const previous = stores.get(agentId);
      // Re-registering the same store is a no-op in the real registry, mirror
      // that here so listeners don't see a phantom unregister/register pair.
      if (previous === store) return;
      stores.set(agentId, store);
      // Match production order from ThreadStoreRegistry.register: emit
      // unregistered for the previous store FIRST (with the new store already
      // installed in `stores`), then emit registered for the new store. This
      // is the contract listeners rely on when cleaning up subscriptions
      // tied to the prior store reference.
      if (previous && previous !== store) {
        subscribers.forEach((subscriber) =>
          subscriber.onThreadStoreUnregistered?.({
            copilotkit: core as unknown as CopilotKitCore,
            agentId,
            store: previous as never,
          }),
        );
      }
      subscribers.forEach((subscriber) =>
        subscriber.onThreadStoreRegistered?.({
          copilotkit: core as unknown as CopilotKitCore,
          agentId,
          // ɵThreadStore is an internal alias the inspector consumes via the
          // real type; the test mock only models the subset used by Lit's
          // reactive subscription path.
          store: store as never,
        }),
      );
    },
    unregisterThreadStore(agentId: string) {
      const previous = stores.get(agentId);
      if (!previous) return;
      stores.delete(agentId);
      subscribers.forEach((subscriber) =>
        subscriber.onThreadStoreUnregistered?.({
          copilotkit: core as unknown as CopilotKitCore,
          agentId,
          store: previous as never,
        }),
      );
    },
  };

  return {
    core,
    emitAgentsChanged(nextAgents = core.agents) {
      core.agents = nextAgents;
      // CopilotKitCore is a full class — our mock only covers what the
      // inspector reads, so this cast is unavoidable.
      subscribers.forEach((subscriber) =>
        subscriber.onAgentsChanged?.({
          copilotkit: core as unknown as CopilotKitCore,
          agents: core.agents,
        }),
      );
    },
    emitContextChanged(nextContext: Record<string, unknown>) {
      core.context = nextContext;
      subscribers.forEach((subscriber) =>
        subscriber.onContextChanged?.({
          copilotkit: core as unknown as CopilotKitCore,
          context: core.context as unknown as Readonly<
            Record<string, { value: string; description: string }>
          >,
        }),
      );
    },
    emitHeadersChanged(nextHeaders: Record<string, string>) {
      core.headers = nextHeaders;
      subscribers.forEach((subscriber) =>
        subscriber.onHeadersChanged?.({
          copilotkit: core as unknown as CopilotKitCore,
          headers: core.headers as Readonly<Record<string, string>>,
        }),
      );
    },
    emitRuntimeConnectionStatusChanged(
      nextStatus: CopilotKitCoreRuntimeConnectionStatus,
    ) {
      core.runtimeConnectionStatus = nextStatus;
      subscribers.forEach((subscriber) =>
        subscriber.onRuntimeConnectionStatusChanged?.({
          copilotkit: core as unknown as CopilotKitCore,
          status: nextStatus,
        }),
      );
    },
    /** Snapshot of currently-registered stores in the registry. */
    stores,
  };
}

// --- Test helpers ---

/** Create inspector, attach to DOM, wire up mock core. */
function createInspectorWithCore(core: MockCore) {
  const inspector = new WebInspectorElement();
  document.body.appendChild(inspector);
  // WebInspectorElement["core"] is a CopilotKitCore instance — our MockCore
  // only implements the subset exercised by these tests.
  inspector.core = core as unknown as WebInspectorElement["core"];
  return inspector;
}

/** Access private Lit reactive properties on the inspector. */
function getInternals(inspector: WebInspectorElement) {
  return inspector as unknown as InspectorInternals;
}

/** Access context-related private properties on the inspector. */
function getContextInternals(inspector: WebInspectorElement) {
  return inspector as unknown as InspectorContextInternals;
}

// --- Tests ---

describe("WebInspectorElement", () => {
  let mockClipboard: { writeText: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    document.body.innerHTML = "";

    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        for (const key of Object.keys(store)) delete store[key];
      },
      get length() {
        return Object.keys(store).length;
      },
      key: (index: number) => Object.keys(store)[index] ?? null,
    });

    mockClipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    // navigator.clipboard is readonly in DOM types — assigning
    // the mock requires a cast in jsdom-style test environments.
    (navigator as unknown as { clipboard: typeof mockClipboard }).clipboard =
      mockClipboard;
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it("records agent events and syncs state/messages/tools", async () => {
    const { agent, controller } = createMockAgent("alpha", {
      messages: [{ id: "m1", role: "user", content: "hi there" }],
      state: { foo: "bar" },
      toolHandlers: {
        greet: { description: "hello", parameters: { type: "object" } },
      },
    });
    const { core, emitAgentsChanged } = createMockCore({ alpha: agent });
    const inspector = createInspectorWithCore(core);

    emitAgentsChanged();
    await inspector.updateComplete;

    controller.emit("onRunStartedEvent", { event: { id: "run-1" } });
    controller.emit("onMessagesSnapshotEvent", { event: { id: "msg-1" } });
    await inspector.updateComplete;

    const internals = getInternals(inspector);

    expect(
      internals.flattenedEvents.some((evt) => evt.type === "RUN_STARTED"),
    ).toBe(true);
    expect(
      internals.flattenedEvents.some((evt) => evt.type === "MESSAGES_SNAPSHOT"),
    ).toBe(true);
    expect(internals.agentMessages.get("alpha")?.[0]?.contentText).toContain(
      "hi there",
    );
    expect(internals.agentStates.get("alpha")).toBeDefined();
    expect(internals.cachedTools.some((tool) => tool.name === "greet")).toBe(
      true,
    );
  });

  it("normalizes context, persists state, and copies context values", async () => {
    const { core, emitContextChanged } = createMockCore();
    const inspector = createInspectorWithCore(core);

    emitContextChanged({
      ctxA: { value: { nested: true } },
      ctxB: { description: "Described", value: 5 },
    });
    await inspector.updateComplete;

    const contextInternals = getContextInternals(inspector);
    const ctxA = contextInternals.contextStore.ctxA!;
    const ctxB = contextInternals.contextStore.ctxB!;
    expect(ctxA.value).toMatchObject({ nested: true });
    expect(ctxB.description).toBe("Described");

    await contextInternals.copyContextValue({ nested: true }, "ctxA");
    expect(mockClipboard.writeText).toHaveBeenCalledTimes(1);

    contextInternals.persistState();
    expect(localStorage.getItem("cpk:inspector:state")).toBeTruthy();
  });

  it("re-registers an owned thread store after agent removal + re-add (no stale-orphan leak)", async () => {
    // Reproduces the bug fixed in CPK-7193 review round 1:
    //
    //   register store → remove agent → core auto-unregisters →
    //   add the same agent back → ensureOwnedThreadStore must NOT early-return
    //   on the stale local entry, otherwise the threads view never repopulates.
    //
    // The inspector's onThreadStoreUnregistered handler is responsible for
    // dropping the local owned-store entry when core fires the unregister
    // event with the (now-removed) `store`. After that,
    // ensureOwnedThreadStore can register a fresh store and the new instance
    // ends up in _ownedThreadStores.
    const { agent: agentA } = createMockAgent("alpha");
    const mockCore = createMockCore(
      { alpha: agentA },
      { runtimeUrl: "http://runtime.test" },
    );
    const inspector = createInspectorWithCore(mockCore.core);

    mockCore.emitAgentsChanged();
    await inspector.updateComplete;

    const internals = getInternals(inspector);
    const initialStore = internals._ownedThreadStores.get("alpha");
    expect(initialStore).toBeDefined();
    // Core registry should also know about it (registerThreadStore was called
    // by ensureOwnedThreadStore).
    expect(mockCore.stores.get("alpha")).toBe(initialStore);

    // Remove the agent. processAgentsChanged sees alpha is gone, but per the
    // file's invariant it does NOT teardown owned stores there. Simulate the
    // core also unregistering the store (which fires
    // onThreadStoreUnregistered with the unregistered store).
    mockCore.emitAgentsChanged({});
    mockCore.core.unregisterThreadStore("alpha");
    await inspector.updateComplete;

    // After the unregister fires, the local owned-stores Map must no
    // longer reference the stale store — otherwise re-registration below
    // short-circuits on the early-return.
    expect(internals._ownedThreadStores.has("alpha")).toBe(false);

    // Re-add the agent. ensureOwnedThreadStore should NOT early-return: it
    // should create a fresh store and register it with core.
    const { agent: agentA2 } = createMockAgent("alpha");
    mockCore.emitAgentsChanged({ alpha: agentA2 });
    await inspector.updateComplete;

    const refreshedStore = internals._ownedThreadStores.get("alpha");
    expect(refreshedStore).toBeDefined();
    // The new store must NOT be the same instance as the original — otherwise
    // we're still pointing at a torn-down store from the previous lifecycle.
    expect(refreshedStore).not.toBe(initialStore);
    // Core registry should also have the new instance.
    expect(mockCore.stores.get("alpha")).toBe(refreshedStore);
  });

  it("stops the unregistered owned store when a replacement registration happens (CR R2 #1)", async () => {
    // Synthetic-revert scenario: when a foreign caller (e.g. useThreads())
    // registers a NEW store while the inspector already owns one, the
    // registry fires onThreadStoreUnregistered with the OLD store as
    // `event.store` and immediately fires onThreadStoreRegistered for the
    // new one. The inspector's handler must stop+drop the old owned store.
    //
    // Before this fix, the handler read `event.oldStore` (which never
    // existed on the contract — it was always undefined). The defensive
    // fallback `getThreadStore(agentId) === undefined` handled the plain
    // unregister case but NOT this replace case (where getThreadStore
    // returns the new replacement store), so the old store leaked.
    const { agent: agentA } = createMockAgent("alpha");
    const mockCore = createMockCore(
      { alpha: agentA },
      { runtimeUrl: "http://runtime.test" },
    );
    const inspector = createInspectorWithCore(mockCore.core);

    mockCore.emitAgentsChanged();
    await inspector.updateComplete;

    const internals = getInternals(inspector);
    const ownedStore = internals._ownedThreadStores.get("alpha");
    expect(ownedStore).toBeDefined();
    // Spy on stop() so we can assert the inspector cleaned up the old store.
    const stopSpy = vi.spyOn(
      ownedStore as unknown as { stop: () => void },
      "stop",
    );

    // Foreign caller registers a NEW store. The mock's registerThreadStore
    // fires onThreadStoreUnregistered({ store: previous }) for the OLD one,
    // then onThreadStoreRegistered for the NEW one — this is the replace
    // contract that the broken `oldStore` read could not detect.
    //
    // Inspector subscribes via `store.select(...).subscribe(...)`, so the
    // replacement must mirror that minimal selector-observable API.
    const replacementStore = {
      stop: vi.fn(),
      start: vi.fn(),
      setContext: vi.fn(),
      // Inspector subscribes via `store.select(...).subscribe(...)` and then
      // immediately reads `store.getState()` to seed the threads list.
      select: vi.fn(() => ({
        subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
      })),
      getState: vi.fn(() => ({ threads: [] })),
    };
    mockCore.core.registerThreadStore("alpha", replacementStore);
    await inspector.updateComplete;

    // The previous owned store should have been stopped — that's the cleanup
    // path the broken code missed because the defensive fallback only fires
    // when getThreadStore() returns undefined, which it doesn't on a replace.
    expect(stopSpy).toHaveBeenCalledTimes(1);
    // The owned-store map must no longer reference the stale store.
    expect(internals._ownedThreadStores.get("alpha")).not.toBe(ownedStore);
    // Core registry now points at the replacement.
    expect(mockCore.stores.get("alpha")).toBe(replacementStore);
  });

  it("syncs agent state on direct setState (onStateChanged without pipeline events)", async () => {
    // Simulates a selfManagedAgent where agent.setState() is called directly
    // from UI code, bypassing the AG-UI event pipeline. Before the fix,
    // only pipeline event handlers (onStateSnapshotEvent, onStateDeltaEvent)
    // updated the inspector — onStateChanged was not subscribed to, so
    // direct setState() left the inspector stale.
    const { agent, controller } = createMockAgent("counter", {
      state: { counter: 0 },
    });
    const { core, emitAgentsChanged } = createMockCore({ counter: agent });
    const inspector = createInspectorWithCore(core);

    emitAgentsChanged();
    await inspector.updateComplete;

    const internals = getInternals(inspector);

    // Initial state should be captured on subscription
    expect(internals.agentStates.get("counter")).toEqual({ counter: 0 });

    // Simulate agent.setState({ counter: 1 })
    controller.simulateSetState({ counter: 1 });
    await inspector.updateComplete;
    expect(internals.agentStates.get("counter")).toEqual({ counter: 1 });

    // Simulate a second setState to verify repeated updates propagate
    controller.simulateSetState({ counter: 5 });
    await inspector.updateComplete;
    expect(internals.agentStates.get("counter")).toEqual({ counter: 5 });
  });

  it("propagates core.headers to owned thread stores on onHeadersChanged (CR R3 #2)", async () => {
    // Reproduces the bug fixed in CPK-7193 review round 3:
    //
    //   ensureOwnedThreadStore() previously hardcoded headers: {} when it
    //   created the owned store, and onHeadersChanged was not subscribed to.
    //   That meant authenticated runtimes never saw their auth headers on
    //   thread-list fetches. After the fix, header rotations push fresh
    //   headers into every owned store via store.setContext().
    const { agent } = createMockAgent("alpha");
    const mockCore = createMockCore(
      { alpha: agent },
      {
        runtimeUrl: "http://runtime.test",
        headers: { Authorization: "Bearer initial-token" },
      },
    );
    const inspector = createInspectorWithCore(mockCore.core);

    mockCore.emitAgentsChanged();
    await inspector.updateComplete;

    const internals = getInternals(inspector);
    const ownedStore = internals._ownedThreadStores.get("alpha") as
      | { setContext: (ctx: unknown) => void }
      | undefined;
    expect(ownedStore).toBeDefined();

    // Spy on the existing owned store's setContext, then rotate the headers.
    // We assert the new headers are pushed through with the correct
    // runtimeUrl/agentId envelope — the inspector reads them from core, so a
    // hardcoded empty object would cause this assertion to fail.
    const setContextSpy = vi.spyOn(
      ownedStore as { setContext: (ctx: unknown) => void },
      "setContext",
    );

    mockCore.emitHeadersChanged({ Authorization: "Bearer rotated-token" });

    expect(setContextSpy).toHaveBeenCalledWith({
      runtimeUrl: "http://runtime.test",
      headers: { Authorization: "Bearer rotated-token" },
      agentId: "alpha",
    });
  });

  it("revalidates selectedThreadId when its agent's store is unregistered (CR R3 #5)", async () => {
    // After an agent's thread store is unregistered, the inspector must drop
    // any selectedThreadId that pointed into the removed list. Otherwise the
    // details panel keeps fetching against a thread no list shows.
    const { agent } = createMockAgent("alpha");
    const mockCore = createMockCore(
      { alpha: agent },
      { runtimeUrl: "http://runtime.test" },
    );
    const inspector = createInspectorWithCore(mockCore.core);

    mockCore.emitAgentsChanged();
    await inspector.updateComplete;

    const internals = getInternals(inspector);
    // Plant a selected thread that the inspector "knows" about via the per-
    // agent thread map. The thread store is the inspector's owned store, but
    // for this regression we only care about the unregister revalidation
    // pathway, not how the thread was discovered.
    internals._threadsByAgent.set("alpha", [
      { id: "thread-1", agentId: "alpha" },
    ]);
    internals._threads = [{ id: "thread-1", agentId: "alpha" }];
    internals.selectedThreadId = "thread-1";

    // Core unregisters the store. The inspector's onThreadStoreUnregistered
    // handler must call autoSelectLatestThread, which clears
    // selectedThreadId because _threads is now empty.
    mockCore.core.unregisterThreadStore("alpha");
    await inspector.updateComplete;

    expect(internals.selectedThreadId).toBeNull();
  });

  it("backfills owned thread stores when runtimeUrl is set after agents register (CR R3 #10)", async () => {
    // ensureOwnedThreadStore() early-returns when runtimeUrl is missing.
    // Without backfill, an agent registered before runtimeUrl is set would
    // never get an owned store. After the fix, the
    // onRuntimeConnectionStatusChanged handler iterates core.agents and
    // ensures any missing owned stores are created when the runtime becomes
    // connected.
    const { agent } = createMockAgent("alpha");
    // Start with no runtimeUrl so ensureOwnedThreadStore() early-returns.
    const mockCore = createMockCore({ alpha: agent });
    const inspector = createInspectorWithCore(mockCore.core);

    mockCore.emitAgentsChanged();
    await inspector.updateComplete;

    const internals = getInternals(inspector);
    expect(internals._ownedThreadStores.has("alpha")).toBe(false);

    // Now set the runtimeUrl and emit the connected status. The inspector
    // should backfill the missing owned store for the registered agent.
    mockCore.core.runtimeUrl = "http://runtime.test";
    mockCore.emitRuntimeConnectionStatusChanged(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
    await inspector.updateComplete;

    expect(internals._ownedThreadStores.has("alpha")).toBe(true);
  });

  it("backfills owned thread stores on non-connected status (e.g. connecting / error) once runtimeUrl is set (CR R4 #2)", async () => {
    // Round 4 tightens the previous backfill: it must fire whenever the
    // runtime URL is observable, not only when status reaches "connected".
    // Prior to the fix, agents registered before runtimeUrl was set would
    // never get their owned store if the runtime stayed in "connecting" or
    // transitioned to "error".
    const { agent } = createMockAgent("alpha");
    const mockCore = createMockCore({ alpha: agent });
    const inspector = createInspectorWithCore(mockCore.core);

    mockCore.emitAgentsChanged();
    await inspector.updateComplete;

    const internals = getInternals(inspector);
    expect(internals._ownedThreadStores.has("alpha")).toBe(false);

    // Set the runtimeUrl and emit "connecting" — NOT connected. Backfill
    // should still fire because the URL is now observable on core.
    mockCore.core.runtimeUrl = "http://runtime.test";
    mockCore.emitRuntimeConnectionStatusChanged(
      CopilotKitCoreRuntimeConnectionStatus.Connecting,
    );
    await inspector.updateComplete;

    expect(internals._ownedThreadStores.has("alpha")).toBe(true);
  });

  it("drops _threadsByAgent entries for removed agents (CR R4 #1)", async () => {
    // When an agent is removed from core.agents, processAgentsChanged's
    // cleanup loop must also drop the per-agent thread slice keyed by
    // agentId. Otherwise stale threads linger in the flattened _threads
    // list even though the agent is gone.
    const { agent } = createMockAgent("alpha");
    const mockCore = createMockCore(
      { alpha: agent },
      { runtimeUrl: "http://runtime.test" },
    );
    const inspector = createInspectorWithCore(mockCore.core);

    mockCore.emitAgentsChanged();
    await inspector.updateComplete;

    const internals = getInternals(inspector);
    // Plant a thread keyed under "alpha" so we have something the cleanup
    // pass can drop. Don't depend on the owned-store subscription to
    // populate it — the regression is specifically about the cleanup pass.
    internals._threadsByAgent.set("alpha", [
      { id: "thread-1", agentId: "alpha" },
    ]);
    internals._threads = [{ id: "thread-1", agentId: "alpha" }];
    internals.selectedThreadId = "thread-1";

    // Remove the agent from core. processAgentsChanged should:
    //   - delete the per-agent slice from _threadsByAgent
    //   - rebuild the flattened _threads list (now empty)
    //   - revalidate selectedThreadId (autoSelectLatestThread clears it
    //     because no threads remain)
    mockCore.emitAgentsChanged({});
    await inspector.updateComplete;

    expect(internals._threadsByAgent.has("alpha")).toBe(false);
    expect(internals._threads.some((t) => t.agentId === "alpha")).toBe(false);
    expect(internals.selectedThreadId).toBeNull();
  });

  it("globally sorts _threads by updatedAt desc across agents (CR R4 #6)", async () => {
    // Multi-agent users must see threads in chronological order, not
    // grouped by Map insertion order. This pins the flattened list assigned
    // at every site in subscribeToThreadStore.
    const { agent: agentA } = createMockAgent("alpha");
    const { agent: agentB } = createMockAgent("beta");
    const mockCore = createMockCore(
      { alpha: agentA, beta: agentB },
      { runtimeUrl: "http://runtime.test" },
    );
    const inspector = createInspectorWithCore(mockCore.core);

    mockCore.emitAgentsChanged();
    await inspector.updateComplete;

    const internals = getInternals(inspector);

    // Replace the per-agent map with overlapping timestamps so insertion
    // order does NOT match chronological order. With Map order:
    //   alpha: [t-2024-01-03, t-2024-01-01]
    //   beta:  [t-2024-01-04, t-2024-01-02]
    // → insertion-flatten: [01-03, 01-01, 01-04, 01-02]
    // → desc by updatedAt:  [01-04, 01-03, 01-02, 01-01]
    type ThreadShape = (typeof internals._threadsByAgent extends Map<
      string,
      Array<infer T>
    >
      ? T
      : never) & { updatedAt?: string };
    internals._threadsByAgent.clear();
    internals._threadsByAgent.set("alpha", [
      { id: "a-2", agentId: "alpha", updatedAt: "2024-01-03" } as ThreadShape,
      { id: "a-1", agentId: "alpha", updatedAt: "2024-01-01" } as ThreadShape,
    ]);
    internals._threadsByAgent.set("beta", [
      { id: "b-2", agentId: "beta", updatedAt: "2024-01-04" } as ThreadShape,
      { id: "b-1", agentId: "beta", updatedAt: "2024-01-02" } as ThreadShape,
    ]);

    // Trigger a recompute path: emit a fresh agents-changed so the inspector
    // re-flattens. Simpler: call the private flattenSortedThreads directly
    // via the same cast pattern used elsewhere in this file.
    const inspectorWithFlatten = inspector as unknown as {
      flattenSortedThreads: () => Array<{ id: string; updatedAt?: string }>;
    };
    const flattened = inspectorWithFlatten.flattenSortedThreads();

    expect(flattened.map((t) => t.id)).toEqual(["b-2", "a-2", "b-1", "a-1"]);
  });

  it("does not auto-attach when window global is not Core-shaped (CR R4 #4)", () => {
    // Tighten the auto-attach guard so it requires the methods/properties
    // the inspector actually invokes (`subscribe`, `agents`). Before the
    // fix, any non-null object on window.__COPILOTKIT_CORE__ would be
    // accepted and the inspector would throw on first use.
    const inspector = new WebInspectorElement();
    document.body.appendChild(inspector);

    const bogusGlobal = { someOtherField: 1 };
    (
      window as unknown as Record<string, unknown>
    ).__COPILOTKIT_CORE__ = bogusGlobal;

    // Force the auto-attach path. autoAttachCore and tryAutoAttachCore are
    // private — cast to exercise them directly without depending on
    // connectedCallback timing or attribute reflection.
    const inspectorPrivate = inspector as unknown as {
      autoAttachCore: boolean;
      attemptedAutoAttach: boolean;
      tryAutoAttachCore: () => void;
      _core: unknown;
    };
    inspectorPrivate.autoAttachCore = true;
    inspectorPrivate.attemptedAutoAttach = false;
    inspectorPrivate.tryAutoAttachCore();

    expect(inspectorPrivate._core).toBeFalsy();

    // Cleanup.
    delete (window as unknown as Record<string, unknown>).__COPILOTKIT_CORE__;
  });
});
