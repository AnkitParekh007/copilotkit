import type { Browser } from "playwright";

interface Slot {
  browser: Browser;
  contextCount: number;
}

interface Waiter {
  resolve: (browser: Browser) => void;
  reject: (err: Error) => void;
}

export interface BrowserPoolStats {
  size: number;
  available: number;
  inUse: number;
  totalRecycles: number;
}

export class BrowserPool {
  private readonly poolSize: number;
  private readonly recycleAfter: number;
  private slots: Slot[] = [];
  private available: Slot[] = [];
  private waiters: Waiter[] = [];
  private totalRecycles = 0;
  private inFlightRecycles = new Set<Promise<void>>();
  private isShutdown = false;

  // Tracks which Browser instance maps to which Slot, so release() can find
  // the slot in O(1) even after the slot was removed from `available`.
  private browserToSlot = new Map<Browser, Slot>();

  constructor(size = 4, recycleAfter?: number) {
    this.poolSize = size;
    const envRecycle = process.env.BROWSER_POOL_RECYCLE_AFTER
      ? parseInt(process.env.BROWSER_POOL_RECYCLE_AFTER, 10)
      : undefined;
    this.recycleAfter =
      recycleAfter ??
      (envRecycle !== undefined && !Number.isNaN(envRecycle)
        ? envRecycle
        : 100);
  }

  async init(): Promise<void> {
    const { chromium } =
      (await import("playwright")) as typeof import("playwright");
    this.launchBrowser = () =>
      chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });

    for (let i = 0; i < this.poolSize; i++) {
      const browser = await this.launchBrowser();
      const slot: Slot = { browser, contextCount: 0 };
      this.slots.push(slot);
      this.available.push(slot);
      this.browserToSlot.set(browser, slot);
    }
  }

  // Assigned during init() after the dynamic import resolves.
  private launchBrowser!: () => Promise<Browser>;

  async acquire(timeoutMs = 30_000): Promise<Browser> {
    if (this.isShutdown) {
      throw new Error("BrowserPool is shut down");
    }

    const slot = this.available.shift();
    if (slot) {
      return slot.browser;
    }

    return new Promise<Browser>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject };
      const timer = setTimeout(() => {
        const idx = this.waiters.indexOf(waiter);
        if (idx !== -1) this.waiters.splice(idx, 1);
        reject(new Error("BrowserPool acquire timeout"));
      }, timeoutMs);

      // Wrap resolve/reject so the timeout is always cleared.
      const origResolve = waiter.resolve;
      const origReject = waiter.reject;
      waiter.resolve = (browser: Browser) => {
        clearTimeout(timer);
        origResolve(browser);
      };
      waiter.reject = (err: Error) => {
        clearTimeout(timer);
        origReject(err);
      };

      this.waiters.push(waiter);
    });
  }

  release(browser: Browser): void {
    if (this.isShutdown) return;

    const slot = this.browserToSlot.get(browser);

    // Browser was already recycled or doesn't belong to this pool.
    if (!slot) return;

    slot.contextCount++;

    if (slot.contextCount >= this.recycleAfter) {
      this.recycleSlot(slot);
      return;
    }

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve(slot.browser);
    } else {
      this.available.push(slot);
    }
  }

  async shutdown(): Promise<void> {
    this.isShutdown = true;

    // Reject any queued waiters.
    for (const waiter of this.waiters) {
      waiter.reject(new Error("BrowserPool is shutting down"));
    }
    this.waiters = [];

    // Wait for in-flight recycles to finish before closing everything.
    if (this.inFlightRecycles.size > 0) {
      await Promise.allSettled(Array.from(this.inFlightRecycles));
    }

    // Close every browser we know about.
    const closers = this.slots.map((slot) =>
      slot.browser.close().catch(() => {}),
    );
    await Promise.allSettled(closers);

    this.slots = [];
    this.available = [];
    this.browserToSlot.clear();
  }

  stats(): BrowserPoolStats {
    const availableCount = this.available.length;
    return {
      size: this.slots.length,
      available: availableCount,
      inUse: this.slots.length - availableCount,
      totalRecycles: this.totalRecycles,
    };
  }

  private recycleSlot(slot: Slot): void {
    this.totalRecycles++;

    // Remove the old browser from the lookup map immediately so a
    // double-release of the stale reference is a no-op.
    this.browserToSlot.delete(slot.browser);

    // Remove from available in case it's still there (shouldn't be in
    // the normal path, but defensive).
    const availIdx = this.available.indexOf(slot);
    if (availIdx !== -1) {
      this.available.splice(availIdx, 1);
    }

    const oldBrowser = slot.browser;

    const recyclePromise = (async () => {
      try {
        await oldBrowser.close();
      } catch {
        // Best effort — the browser may have already crashed.
      }

      if (this.isShutdown) return;

      try {
        const fresh = await this.launchBrowser();

        if (this.isShutdown) {
          // Shutdown was initiated while we were launching. Close the
          // fresh browser and don't hand it to anyone.
          await fresh.close().catch(() => {});
          return;
        }

        slot.browser = fresh;
        slot.contextCount = 0;
        this.browserToSlot.set(fresh, slot);

        const waiter = this.waiters.shift();
        if (waiter) {
          waiter.resolve(fresh);
        } else {
          this.available.push(slot);
        }
      } catch (err) {
        // Launch failed — remove this slot from the pool entirely so
        // stats reflect the reduced capacity.
        const idx = this.slots.indexOf(slot);
        if (idx !== -1) {
          this.slots.splice(idx, 1);
        }
        console.error(
          `[BrowserPool] recycleSlot launch failed (slot ${idx}, pool size now ${this.slots.length}):`,
          err,
        );

        // If pool is completely exhausted with waiters pending, reject
        // them all — no remaining slots can ever serve them.
        if (this.slots.length === 0 && this.waiters.length > 0) {
          const stale = this.waiters.splice(0);
          for (const w of stale) {
            w.reject(
              new Error("BrowserPool exhausted: all slots failed to launch"),
            );
          }
        }
      }
    })();

    this.inFlightRecycles.add(recyclePromise);
    recyclePromise.finally(() => {
      this.inFlightRecycles.delete(recyclePromise);
    });
  }
}
