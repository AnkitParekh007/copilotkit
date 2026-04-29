import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Importing the module registers the custom element. We never mount it into
// the DOM in these tests because jsdom 29's CSS shorthand parser chokes on
// the gate's `linear-gradient(...)` background strings during template
// parse. Constructing the element directly and exercising methods/state is
// enough to cover the behaviors that matter (cookie I/O, code validation,
// timer-driven transitions, unlock event).
import "../cpk-thread-gate";

// The gate exposes its behavior through a few private members. There is no
// public API equivalent, so the test-only cast is unavoidable.
type GateInternals = {
  _submitThreadsCode: (value: string) => void;
  _threadsUnlocking: boolean;
  _threadsGateCodeInvalid: boolean;
  connectedCallback: () => void;
  disconnectedCallback: () => void;
  addEventListener: HTMLElement["addEventListener"];
  removeEventListener: HTMLElement["removeEventListener"];
  isConnected: boolean;
};

function makeGate(): HTMLElement & GateInternals {
  const el = document.createElement("cpk-thread-gate") as unknown as HTMLElement &
    GateInternals;
  // Stub render to avoid jsdom 29's CSS-shorthand parser crash on the
  // gate's `linear-gradient(...)` background strings during template parse.
  // We're testing behavior (cookie I/O, code validation, timers, events),
  // not template output.
  Object.defineProperty(el, "render", { value: () => null });
  return el;
}

/**
 * Make a gate and connect it to the document so `isConnected` is true.
 * Required for tests that drive timer callbacks — the gate's setTimeout
 * bodies bail when `!this.isConnected` so they don't mutate state on a
 * torn-down element.
 */
function makeConnectedGate(): HTMLElement & GateInternals {
  const el = makeGate();
  document.body.appendChild(el);
  return el;
}

let cookieJar = "";
let lastWrittenCookie = "";

function installCookieMock(initial: string): void {
  cookieJar = initial;
  lastWrittenCookie = "";
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => cookieJar,
    set: (next: string) => {
      lastWrittenCookie = next;
      cookieJar = cookieJar ? `${cookieJar}; ${next}` : next;
    },
  });
}

describe("cpk-thread-gate", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    installCookieMock("");
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers as cpk-thread-gate", () => {
    expect(customElements.get("cpk-thread-gate")).toBeDefined();
  });

  it("dispatches `unlock` (composed + bubbles) when the cookie is already set on connect", () => {
    installCookieMock("cpk_threads_access=1; SameSite=Lax");
    const gate = makeGate();
    let received: CustomEvent | null = null;
    gate.addEventListener("unlock", (e) => {
      received = e as CustomEvent;
    });
    // Invoke connectedCallback directly. Connecting via appendChild would
    // trigger the gate's render → jsdom CSS parser blowup on linear-gradient.
    gate.connectedCallback();
    expect(received).not.toBeNull();
    const ev = received as unknown as CustomEvent;
    expect(ev.bubbles).toBe(true);
    expect(ev.composed).toBe(true);
  });

  it("does NOT dispatch `unlock` on connect when the cookie is absent", () => {
    installCookieMock("");
    const gate = makeGate();
    let dispatched = false;
    gate.addEventListener("unlock", () => {
      dispatched = true;
    });
    gate.connectedCallback();
    expect(dispatched).toBe(false);
  });

  it("flashes invalid-code state on a wrong code, then auto-clears after 1600ms", () => {
    installCookieMock("");
    const gate = makeConnectedGate();
    gate._submitThreadsCode("nope");
    expect(gate._threadsGateCodeInvalid).toBe(true);
    // No cookie should have been written for an invalid code.
    expect(lastWrittenCookie).toBe("");

    vi.advanceTimersByTime(1599);
    expect(gate._threadsGateCodeInvalid).toBe(true);
    vi.advanceTimersByTime(1);
    expect(gate._threadsGateCodeInvalid).toBe(false);
  });

  it("on correct code: writes the cookie immediately and dispatches `unlock` after 2000ms", () => {
    installCookieMock("");
    const gate = makeConnectedGate();
    let unlockedCount = 0;
    gate.addEventListener("unlock", () => {
      unlockedCount++;
    });

    gate._submitThreadsCode("EarlyAccess");

    // Cookie format must match the original implementation exactly.
    expect(lastWrittenCookie).toBe(
      "cpk_threads_access=1; path=/; max-age=31536000; SameSite=Lax",
    );
    expect(gate._threadsUnlocking).toBe(true);
    expect(unlockedCount).toBe(0);

    vi.advanceTimersByTime(1999);
    expect(unlockedCount).toBe(0);
    vi.advanceTimersByTime(1);
    expect(unlockedCount).toBe(1);
    expect(gate._threadsUnlocking).toBe(false);
  });

  it("trims whitespace and is case-insensitive when comparing the access code", () => {
    installCookieMock("");
    const gate = makeConnectedGate();
    gate._submitThreadsCode("  earlyaccess  ");
    expect(gate._threadsUnlocking).toBe(true);
    expect(lastWrittenCookie).toContain("cpk_threads_access=1");
  });
});
