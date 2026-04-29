import type { LitElement, ReactiveController, ReactiveControllerHost } from "lit";

/**
 * Lit ReactiveController encapsulating the pointer-driven horizontal
 * resize behavior of the threads view's left/right divider.
 *
 * The host owns the persisted width value (so persistence stays unchanged);
 * this controller calls `setWidth` with the new clamped width on each
 * pointer-move and triggers a host update via `host.requestUpdate()`.
 *
 * Behavior matches the original inline handlers exactly:
 *   - On pointer-down, capture the pointer and snapshot start state.
 *   - On pointer-move, compute newWidth = startWidth + (clientX - startX),
 *     clamped to [min, max].
 *   - On pointer-up / pointer-cancel, release pointer capture and clear
 *     resizing state.
 */
export class ThreadDividerController implements ReactiveController {
  private host: ReactiveControllerHost & LitElement;
  private getWidth: () => number;
  private setWidth: (n: number) => void;
  private min: number;
  private max: number;

  private resizing = false;
  private pointerId = -1;
  private startX = 0;
  private startWidth = 0;

  constructor(
    host: ReactiveControllerHost & LitElement,
    getWidth: () => number,
    setWidth: (n: number) => void,
    options?: { min?: number; max?: number },
  ) {
    this.host = host;
    this.getWidth = getWidth;
    this.setWidth = setWidth;
    this.min = options?.min ?? 180;
    this.max = options?.max ?? 480;
    host.addController(this);
  }

  hostConnected(): void {
    // No-op. State is per-interaction; nothing to set up on connect.
  }

  hostDisconnected(): void {
    // Clear in-flight resize state in case the host is removed mid-drag.
    this.resizing = false;
    this.pointerId = -1;
  }

  onPointerDown = (event: PointerEvent): void => {
    this.resizing = true;
    this.pointerId = event.pointerId;
    this.startX = event.clientX;
    this.startWidth = this.getWidth();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  onPointerMove = (event: PointerEvent): void => {
    if (!this.resizing || this.pointerId !== event.pointerId) return;
    const delta = event.clientX - this.startX;
    const next = Math.max(
      this.min,
      Math.min(this.max, this.startWidth + delta),
    );
    this.setWidth(next);
    this.host.requestUpdate();
  };

  onPointerUp = (event: PointerEvent): void => {
    if (this.pointerId !== event.pointerId) return;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(this.pointerId)) {
      target.releasePointerCapture(this.pointerId);
    }
    this.resizing = false;
  };
}
