import { describe, it, expect, vi, beforeEach } from "vitest";
import { ThreadStoreRegistry } from "../core/thread-store-registry";
import { CopilotKitCore } from "../core/core";
import type { CopilotKitCoreSubscriber } from "../core/core";
import type { ɵThreadStore } from "../threads";

// Minimal mock of CopilotKitCore that supports subscribing and notification
function createMockCore() {
  const subscribers = new Set<CopilotKitCoreSubscriber>();

  const core = {
    // Friends-access method used by ThreadStoreRegistry internally
    notifySubscribers: vi.fn(
      async (fn: (s: CopilotKitCoreSubscriber) => unknown) => {
        for (const subscriber of subscribers) {
          await fn(subscriber);
        }
      },
    ),
    subscribe(subscriber: CopilotKitCoreSubscriber) {
      subscribers.add(subscriber);
      return { unsubscribe: () => subscribers.delete(subscriber) };
    },
  } as unknown as CopilotKitCore;

  return { core, subscribers };
}

function makeStore(id = "store-a"): ɵThreadStore {
  return {
    id,
    select: vi.fn(),
    getState: vi.fn(),
    dispatch: vi.fn(),
  } as unknown as ɵThreadStore;
}

describe("ThreadStoreRegistry", () => {
  let registry: ThreadStoreRegistry;
  let core: CopilotKitCore;

  beforeEach(() => {
    ({ core } = createMockCore());
    registry = new ThreadStoreRegistry(core);
  });

  it("register then get returns the same store", () => {
    const store = makeStore();
    registry.register("agent-1", store);
    expect(registry.get("agent-1")).toBe(store);
  });

  it("getAll returns all registered stores", () => {
    const storeA = makeStore("a");
    const storeB = makeStore("b");
    registry.register("agent-1", storeA);
    registry.register("agent-2", storeB);
    const all = registry.getAll();
    expect(all["agent-1"]).toBe(storeA);
    expect(all["agent-2"]).toBe(storeB);
  });

  it("second register for the same agentId replaces the first and fires unregistered then registered", async () => {
    const onRegistered = vi.fn();
    const onUnregistered = vi.fn();
    const subscriber: CopilotKitCoreSubscriber = {
      onThreadStoreRegistered: onRegistered,
      onThreadStoreUnregistered: onUnregistered,
    };
    (
      core as unknown as { subscribe: (s: CopilotKitCoreSubscriber) => unknown }
    ).subscribe(subscriber);

    const first = makeStore("first");
    const second = makeStore("second");
    registry.register("agent-1", first);
    await Promise.resolve();
    expect(onRegistered).toHaveBeenCalledTimes(1);
    expect(onUnregistered).not.toHaveBeenCalled();

    registry.register("agent-1", second);
    await Promise.resolve();

    expect(registry.get("agent-1")).toBe(second);
    expect(onUnregistered).toHaveBeenCalledTimes(1);
    expect(onUnregistered).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agent-1", store: first }),
    );
    expect(onRegistered).toHaveBeenCalledTimes(2);
    expect(onRegistered).toHaveBeenLastCalledWith(
      expect.objectContaining({ agentId: "agent-1", store: second }),
    );
  });

  it("unregister removes the store", () => {
    registry.register("agent-1", makeStore());
    registry.unregister("agent-1");
    expect(registry.get("agent-1")).toBeUndefined();
  });

  it("unregister on a missing key is a no-op and does not throw", () => {
    expect(() => registry.unregister("nonexistent")).not.toThrow();
  });

  it("register fires onThreadStoreRegistered on subscribers", async () => {
    const onRegistered = vi.fn();
    const subscriber: CopilotKitCoreSubscriber = {
      onThreadStoreRegistered: onRegistered,
    };
    // Attach subscriber directly so notifySubscribers reaches it
    (
      core as unknown as { subscribe: (s: CopilotKitCoreSubscriber) => unknown }
    ).subscribe(subscriber);

    const store = makeStore();
    registry.register("agent-1", store);

    // notifyRegistered is fire-and-forget (void); flush microtasks
    await Promise.resolve();

    expect(onRegistered).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agent-1", store }),
    );
  });

  it("unregister fires onThreadStoreUnregistered on subscribers", async () => {
    const onUnregistered = vi.fn();
    const subscriber: CopilotKitCoreSubscriber = {
      onThreadStoreUnregistered: onUnregistered,
    };
    (
      core as unknown as { subscribe: (s: CopilotKitCoreSubscriber) => unknown }
    ).subscribe(subscriber);

    const store = makeStore();
    registry.register("agent-1", store);
    registry.unregister("agent-1");

    await Promise.resolve();

    expect(onUnregistered).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agent-1", store }),
    );
  });

  it("unregister does not fire event when key was never registered", async () => {
    const onUnregistered = vi.fn();
    const subscriber: CopilotKitCoreSubscriber = {
      onThreadStoreUnregistered: onUnregistered,
    };
    (
      core as unknown as { subscribe: (s: CopilotKitCoreSubscriber) => unknown }
    ).subscribe(subscriber);

    registry.unregister("nonexistent");
    await Promise.resolve();

    expect(onUnregistered).not.toHaveBeenCalled();
  });

  it("re-registering the same store instance is a no-op for listeners (no flicker)", async () => {
    const onRegistered = vi.fn();
    const onUnregistered = vi.fn();
    const subscriber: CopilotKitCoreSubscriber = {
      onThreadStoreRegistered: onRegistered,
      onThreadStoreUnregistered: onUnregistered,
    };
    (
      core as unknown as { subscribe: (s: CopilotKitCoreSubscriber) => unknown }
    ).subscribe(subscriber);

    const store = makeStore();
    registry.register("agent-1", store);
    await Promise.resolve();
    expect(onRegistered).toHaveBeenCalledTimes(1);
    expect(onUnregistered).not.toHaveBeenCalled();

    // Same instance — should NOT re-fire registered or unregistered.
    registry.register("agent-1", store);
    await Promise.resolve();
    await Promise.resolve();

    expect(onRegistered).toHaveBeenCalledTimes(1);
    expect(onUnregistered).not.toHaveBeenCalled();
    expect(registry.get("agent-1")).toBe(store);
  });

  it("on replace, listeners observe the new store mapped to the id and receive the old store on the unregistered payload", async () => {
    // Documents the registry's replace convention: the id maps to the NEW
    // store while both the unregistered (for the old store) and registered
    // (for the new store) events are dispatched. There is no intermediate
    // "missing" state observable to listeners. The unregistered event carries
    // the OLD store on its payload so listeners can clean up subscriptions
    // tied to that reference without needing to capture it themselves.
    const observedDuringUnregistered: Array<ɵThreadStore | undefined> = [];
    const observedDuringRegistered: Array<ɵThreadStore | undefined> = [];
    const unregisteredPayloadStores: Array<ɵThreadStore> = [];

    const subscriber: CopilotKitCoreSubscriber = {
      onThreadStoreUnregistered: ({ store }) => {
        observedDuringUnregistered.push(registry.get("agent-1"));
        unregisteredPayloadStores.push(store);
      },
      onThreadStoreRegistered: () => {
        observedDuringRegistered.push(registry.get("agent-1"));
      },
    };
    (
      core as unknown as { subscribe: (s: CopilotKitCoreSubscriber) => unknown }
    ).subscribe(subscriber);

    const first = makeStore("first");
    const second = makeStore("second");

    registry.register("agent-1", first);
    await Promise.resolve();
    await Promise.resolve();

    registry.register("agent-1", second);
    await Promise.resolve();
    await Promise.resolve();

    // Initial register: only registered fires, mapping is `first`.
    expect(observedDuringRegistered[0]).toBe(first);

    // Replace: unregistered observes `second` (already swapped in), and
    // registered also observes `second`.
    expect(observedDuringUnregistered[0]).toBe(second);
    expect(observedDuringRegistered[1]).toBe(second);

    // The unregistered payload still carries the OLD store reference even
    // though the registry mapping has already advanced to the new store.
    expect(unregisteredPayloadStores).toEqual([first]);
  });

  it("replace fires unregistered before registered", async () => {
    const calls: string[] = [];
    const subscriber: CopilotKitCoreSubscriber = {
      onThreadStoreUnregistered: () => {
        calls.push("unregistered");
      },
      onThreadStoreRegistered: () => {
        calls.push("registered");
      },
    };
    (
      core as unknown as { subscribe: (s: CopilotKitCoreSubscriber) => unknown }
    ).subscribe(subscriber);

    registry.register("agent-1", makeStore("first"));
    await Promise.resolve();
    await Promise.resolve();

    // Reset so the array reflects only the replace pair, not the initial
    // register. Without this, an implementation that swapped the local pair
    // ordering on replace would still produce the same overall sequence and
    // the test would not catch the regression.
    calls.length = 0;

    registry.register("agent-1", makeStore("second"));
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toEqual(["unregistered", "registered"]);
  });

  it("auto-unregisters thread stores when their agent is removed via onAgentsChanged", async () => {
    // CopilotKitCore subscribes internally to onAgentsChanged and drops any
    // thread store whose agentId is no longer present in the new agents map.
    // This guards the inspector teardown path: when an agent is removed, its
    // store must not leak in the registry.
    const ck = new CopilotKitCore({});
    const onUnregistered = vi.fn();
    ck.subscribe({ onThreadStoreUnregistered: onUnregistered });

    const store = makeStore("agent-going-away");
    ck.registerThreadStore("agent-going-away", store);
    expect(ck.getThreadStore("agent-going-away")).toBe(store);

    // Replace the agents map so "agent-going-away" is no longer present.
    ck.setAgents__unsafe_dev_only({});
    // Allow the subscriber microtask chain to flush.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(ck.getThreadStore("agent-going-away")).toBeUndefined();
    expect(onUnregistered).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agent-going-away", store }),
    );
  });
});
