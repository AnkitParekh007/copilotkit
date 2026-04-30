import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";

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
  const el = document.createElement(
    "cpk-thread-gate",
  ) as unknown as HTMLElement & GateInternals;
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

// Cache the original `cookie` descriptor at module load so we can restore it
// after this test file finishes. installCookieMock redefines the property per
// beforeEach with a configurable mock; without a final restore, subsequent
// test files in the same vitest worker would inherit the stale mock and see
// confusing cookie behavior. The descriptor lives on Document.prototype in
// jsdom, so we look there first and fall back to document for safety.
const ORIGINAL_COOKIE_DESCRIPTOR =
  Object.getOwnPropertyDescriptor(Document.prototype, "cookie") ??
  Object.getOwnPropertyDescriptor(document, "cookie");

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

  afterAll(() => {
    // Restore the original document.cookie descriptor so the leftover mock
    // doesn't bleed into subsequent test files in the same vitest worker.
    if (ORIGINAL_COOKIE_DESCRIPTOR) {
      Object.defineProperty(document, "cookie", ORIGINAL_COOKIE_DESCRIPTOR);
    } else {
      // No original descriptor cached — best-effort: drop the mock so
      // accessors fall through to the prototype.
      delete (document as unknown as { cookie?: string }).cookie;
    }
  });

  it("registers as cpk-thread-gate", () => {
    expect(customElements.get("cpk-thread-gate")).toBeDefined();
  });

  it("dispatches `unlock` (composed + bubbles) when the cookie is already set on connect", async () => {
    installCookieMock("cpk_threads_access=1; SameSite=Lax");
    const gate = makeConnectedGate();
    let received: CustomEvent | null = null;
    gate.addEventListener("unlock", (e) => {
      received = e as CustomEvent;
    });
    // Invoke connectedCallback directly so we control timing. The dispatch is
    // deferred via queueMicrotask so consumers attaching a listener after
    // construction can still observe it — flush microtasks before asserting.
    gate.connectedCallback();
    // Use real timers for the microtask flush so vi.useFakeTimers (set up in
    // beforeEach) doesn't trap the queued callback.
    vi.useRealTimers();
    await Promise.resolve();
    vi.useFakeTimers();
    expect(received).not.toBeNull();
    const ev = received as unknown as CustomEvent;
    expect(ev.bubbles).toBe(true);
    expect(ev.composed).toBe(true);
  });

  it("does NOT dispatch `unlock` on connect when the cookie is absent", async () => {
    installCookieMock("");
    const gate = makeConnectedGate();
    let dispatched = false;
    gate.addEventListener("unlock", () => {
      dispatched = true;
    });
    gate.connectedCallback();
    vi.useRealTimers();
    await Promise.resolve();
    vi.useFakeTimers();
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
    // Use mixed-case input so this assertion exercises BOTH trimming and
    // case-insensitivity (the previous all-lowercase fixture only verified
    // trimming, leaving the case-folding behavior untested).
    gate._submitThreadsCode("  EarlyAccess  ");
    expect(gate._threadsUnlocking).toBe(true);
    expect(lastWrittenCookie).toContain("cpk_threads_access=1");
  });

  it("disconnecting mid-flash cancels the invalid-flash timer (no late state mutation)", () => {
    installCookieMock("");
    const gate = makeConnectedGate();
    gate._submitThreadsCode("nope");
    expect(gate._threadsGateCodeInvalid).toBe(true);

    // Tear down before the 1600ms flash timer has fired.
    document.body.removeChild(gate);
    expect(gate.isConnected).toBe(false);

    // Advance well past the flash window. The disconnectedCallback cleared
    // the timer, so the callback never runs and the field stays as it was
    // — no requestUpdate() against a torn-down element.
    vi.advanceTimersByTime(5000);
    expect(gate._threadsGateCodeInvalid).toBe(true);
  });

  it("disconnecting mid-unlock cancels the unlock-transition timer", () => {
    installCookieMock("");
    const gate = makeConnectedGate();
    let unlockedCount = 0;
    gate.addEventListener("unlock", () => {
      unlockedCount++;
    });
    gate._submitThreadsCode("earlyaccess");
    expect(gate._threadsUnlocking).toBe(true);

    // Detach before the 2000ms unlock timer has fired.
    document.body.removeChild(gate);
    expect(gate.isConnected).toBe(false);

    // Advance past the unlock window — the timer is cleared so the unlock
    // event must never fire and the unlocking flag stays true (the body
    // that would flip it back to false is skipped).
    vi.advanceTimersByTime(5000);
    expect(unlockedCount).toBe(0);
    expect(gate._threadsUnlocking).toBe(true);
  });
});
