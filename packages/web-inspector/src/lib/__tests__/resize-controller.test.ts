import type { LitElement, ReactiveControllerHost } from "lit";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ThreadDividerController } from "../resize-controller";

// Minimal stand-in for ReactiveControllerHost & LitElement that the
// controller actually exercises (`addController` + `requestUpdate`). We don't
// drive a real Lit element here because the controller's pointer-handler
// behavior is host-agnostic.
type FakeHost = {
  addController: ReturnType<typeof vi.fn>;
  requestUpdate: ReturnType<typeof vi.fn>;
};

function createHost(): FakeHost {
  return {
    addController: vi.fn(),
    requestUpdate: vi.fn(),
  };
}

// The controller's host parameter is typed as ReactiveControllerHost &
// LitElement. The fake here only exercises `addController` and
// `requestUpdate`; the cast is the standard test-only escape hatch.
function asHost(fake: FakeHost): ReactiveControllerHost & LitElement {
  return fake as unknown as ReactiveControllerHost & LitElement;
}

// Build a PointerEvent-shaped object that exposes setPointerCapture /
// hasPointerCapture / releasePointerCapture on currentTarget. Real
// PointerEvent isn't available in jsdom in a useful form, so we shape one
// the controller's handlers will accept.
function pointerEvent(opts: {
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel";
  pointerId: number;
  clientX: number;
  target?: HTMLElement;
}) {
  const target =
    opts.target ??
    ({
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn().mockReturnValue(true),
      releasePointerCapture: vi.fn(),
    } as unknown as HTMLElement);
  return {
    type: opts.type,
    pointerId: opts.pointerId,
    clientX: opts.clientX,
    currentTarget: target,
    preventDefault: vi.fn(),
  } as unknown as PointerEvent;
}

describe("ThreadDividerController", () => {
  let host: FakeHost;
  let widthValue: number;
  let setWidthCalls: number[];
  let controller: ThreadDividerController;

  beforeEach(() => {
    host = createHost();
    widthValue = 290;
    setWidthCalls = [];
    controller = new ThreadDividerController(
      asHost(host),
      () => widthValue,
      (n: number) => {
        widthValue = n;
        setWidthCalls.push(n);
      },
    );
  });

  it("registers itself with the host on construction", () => {
    expect(host.addController).toHaveBeenCalledTimes(1);
    expect(host.addController).toHaveBeenCalledWith(controller);
  });

  it("captures the pointer on pointer-down", () => {
    const target = {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn().mockReturnValue(true),
      releasePointerCapture: vi.fn(),
    } as unknown as HTMLElement;
    const ev = pointerEvent({
      type: "pointerdown",
      pointerId: 7,
      clientX: 100,
      target,
    });
    controller.onPointerDown(ev);
    expect(
      (target as unknown as { setPointerCapture: ReturnType<typeof vi.fn> })
        .setPointerCapture,
    ).toHaveBeenCalledWith(7);
    expect(ev.preventDefault).toHaveBeenCalled();
  });

  it("computes new width as startWidth + (clientX - startX) on pointer-move", () => {
    controller.onPointerDown(
      pointerEvent({ type: "pointerdown", pointerId: 1, clientX: 100 }),
    );
    controller.onPointerMove(
      pointerEvent({ type: "pointermove", pointerId: 1, clientX: 130 }),
    );
    // startWidth=290, delta=+30 → 320
    expect(setWidthCalls).toEqual([320]);
    expect(widthValue).toBe(320);
    expect(host.requestUpdate).toHaveBeenCalledTimes(1);
  });

  it("clamps new width at the configured min", () => {
    // Drag far left of start — should clamp at min (default 180).
    controller.onPointerDown(
      pointerEvent({ type: "pointerdown", pointerId: 1, clientX: 200 }),
    );
    controller.onPointerMove(
      pointerEvent({ type: "pointermove", pointerId: 1, clientX: 0 }),
    );
    expect(setWidthCalls).toEqual([180]);
    expect(widthValue).toBe(180);
  });

  it("clamps new width at the configured max", () => {
    controller.onPointerDown(
      pointerEvent({ type: "pointerdown", pointerId: 1, clientX: 100 }),
    );
    controller.onPointerMove(
      pointerEvent({ type: "pointermove", pointerId: 1, clientX: 999 }),
    );
    expect(setWidthCalls).toEqual([480]);
    expect(widthValue).toBe(480);
  });

  it("ignores pointer-move when no pointer-down was captured", () => {
    controller.onPointerMove(
      pointerEvent({ type: "pointermove", pointerId: 1, clientX: 200 }),
    );
    expect(setWidthCalls).toEqual([]);
    expect(host.requestUpdate).not.toHaveBeenCalled();
  });

  it("ignores pointer-move whose pointerId doesn't match the captured one", () => {
    controller.onPointerDown(
      pointerEvent({ type: "pointerdown", pointerId: 1, clientX: 100 }),
    );
    controller.onPointerMove(
      pointerEvent({ type: "pointermove", pointerId: 2, clientX: 200 }),
    );
    expect(setWidthCalls).toEqual([]);
    expect(host.requestUpdate).not.toHaveBeenCalled();
  });

  it("releases pointer capture and clears resize state on pointer-up", () => {
    const releaseSpy = vi.fn();
    const hasSpy = vi.fn().mockReturnValue(true);
    const target = {
      setPointerCapture: vi.fn(),
      hasPointerCapture: hasSpy,
      releasePointerCapture: releaseSpy,
    } as unknown as HTMLElement;

    controller.onPointerDown(
      pointerEvent({ type: "pointerdown", pointerId: 5, clientX: 100, target }),
    );
    controller.onPointerUp(
      pointerEvent({ type: "pointerup", pointerId: 5, clientX: 120, target }),
    );
    expect(hasSpy).toHaveBeenCalledWith(5);
    expect(releaseSpy).toHaveBeenCalledWith(5);

    // After pointer-up, subsequent moves are ignored.
    controller.onPointerMove(
      pointerEvent({ type: "pointermove", pointerId: 5, clientX: 200, target }),
    );
    expect(setWidthCalls).toEqual([]);
  });

  it("ignores pointer-up whose pointerId doesn't match", () => {
    const target = {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn().mockReturnValue(true),
      releasePointerCapture: vi.fn(),
    } as unknown as HTMLElement;
    controller.onPointerDown(
      pointerEvent({ type: "pointerdown", pointerId: 1, clientX: 100, target }),
    );
    controller.onPointerUp(
      pointerEvent({ type: "pointerup", pointerId: 99, clientX: 120, target }),
    );
    // The captured pointer is still active, so a move on pointerId 1 still
    // triggers a width change.
    controller.onPointerMove(
      pointerEvent({ type: "pointermove", pointerId: 1, clientX: 110, target }),
    );
    expect(setWidthCalls).toEqual([300]);
  });

  it("respects custom min/max options", () => {
    const otherHost = createHost();
    let w = 300;
    const setW = vi.fn((n: number) => {
      w = n;
    });
    const c = new ThreadDividerController(
      asHost(otherHost),
      () => w,
      setW,
      { min: 200, max: 350 },
    );
    c.onPointerDown(
      pointerEvent({ type: "pointerdown", pointerId: 1, clientX: 100 }),
    );
    c.onPointerMove(
      pointerEvent({ type: "pointermove", pointerId: 1, clientX: 999 }),
    );
    expect(setW).toHaveBeenLastCalledWith(350);
    c.onPointerMove(
      pointerEvent({ type: "pointermove", pointerId: 1, clientX: -999 }),
    );
    expect(setW).toHaveBeenLastCalledWith(200);
  });
});
