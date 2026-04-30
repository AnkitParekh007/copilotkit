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
  options: { runtimeUrl?: string } = {},
) {
  const subscribers = new Set<CopilotKitCoreSubscriber>();
  const stores = new Map<string, unknown>();
  const core: MockCore = {
    agents: initialAgents,
    context: {},
    properties: {},
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
      stores.set(agentId, store);
      // Fire the registration event so subscribers (e.g. the inspector)
      // hook up their per-store subscriptions, mirroring the real registry.
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
      // If a previous store existed, the registry would also have unregistered
      // it. Fire the unregister event with the prior store so the inspector's
      // cleanup path is exercised against the real core contract.
      if (previous && previous !== store) {
        subscribers.forEach((subscriber) =>
          subscriber.onThreadStoreUnregistered?.({
            copilotkit: core as unknown as CopilotKitCore,
            agentId,
            store: previous as never,
          }),
        );
      }
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
});
