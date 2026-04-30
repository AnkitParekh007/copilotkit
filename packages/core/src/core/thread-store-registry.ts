import type { ɵThreadStore } from "../threads";
import type { CopilotKitCore } from "./core";
import type {
  CopilotKitCoreFriendsAccess,
  CopilotKitCoreSubscriber,
} from "./core";

export class ThreadStoreRegistry {
  private _stores: Record<string, ɵThreadStore> = {};

  constructor(private core: CopilotKitCore) {}

  register(agentId: string, store: ɵThreadStore): void {
    const existing = this._stores[agentId];
    // Re-registering the exact same store instance is a no-op for listeners,
    // so we don't emit unregistered/registered. This avoids a flicker when a
    // host element re-runs registration with no actual change.
    if (existing === store) {
      return;
    }
    if (existing !== undefined) {
      // Replace ordering: emit unregistered for the old store BEFORE
      // registering the new one. During notifyUnregistered, the new store is
      // already installed in _stores — listeners that read get(agentId) from
      // within the unregistered handler will observe the new store. The
      // intent of the unregistered event is "the previous store binding is
      // gone"; the new binding is observable on the subsequent registered
      // event. Listeners that need to clean up subscriptions tied to the old
      // store reference must use the `store` field on the unregistered event
      // payload, since `get(agentId)` already returns the new store at that
      // point.
      const oldStore = existing;
      this._stores[agentId] = store;
      void this.notifyUnregistered(agentId, oldStore);
      void this.notifyRegistered(agentId, store);
      return;
    }
    this._stores[agentId] = store;
    void this.notifyRegistered(agentId, store);
  }

  unregister(agentId: string): void {
    const oldStore = this._stores[agentId];
    if (oldStore === undefined) return;
    delete this._stores[agentId];
    void this.notifyUnregistered(agentId, oldStore);
  }

  get(agentId: string): ɵThreadStore | undefined {
    return this._stores[agentId];
  }

  getAll(): Readonly<Record<string, ɵThreadStore>> {
    return this._stores;
  }

  private async notifyRegistered(
    agentId: string,
    store: ɵThreadStore,
  ): Promise<void> {
    await (
      this.core as unknown as CopilotKitCoreFriendsAccess
    ).notifySubscribers(
      (subscriber: CopilotKitCoreSubscriber) =>
        subscriber.onThreadStoreRegistered?.({
          copilotkit: this.core,
          agentId,
          store,
        }),
      "Subscriber onThreadStoreRegistered error:",
    );
  }

  private async notifyUnregistered(
    agentId: string,
    store: ɵThreadStore,
  ): Promise<void> {
    await (
      this.core as unknown as CopilotKitCoreFriendsAccess
    ).notifySubscribers(
      (subscriber: CopilotKitCoreSubscriber) =>
        subscriber.onThreadStoreUnregistered?.({
          copilotkit: this.core,
          agentId,
          store,
        }),
      "Subscriber onThreadStoreUnregistered error:",
    );
  }
}
