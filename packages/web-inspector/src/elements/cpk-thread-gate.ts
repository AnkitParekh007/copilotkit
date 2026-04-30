import { LitElement, css, html, nothing } from "lit";
import { getCookie } from "../lib/safe";

// ─── cpk-thread-gate ─────────────────────────────────────────────────────────
// Owns the early-access gate UI and its state. Reads the unlock cookie on
// connect; on successful unlock writes the cookie and dispatches a bubbling
// "unlock" CustomEvent (composed: true) so the parent inspector can mirror
// the unlocked state.

class CpkThreadGate extends LitElement {
  static properties = {
    _threadsUnlocking: { state: true },
    _threadsGateError: { state: true },
    _threadsGateCodeInvalid: { state: true },
  };

  /** Hosted invite-form URL — used by the "Request early access" CTA. */
  private static readonly THREADS_REQUEST_URL =
    "https://r3x69.share-na2.hsforms.com/2uiZg8EkiT7a_KykeXV1ajQ";

  private _threadsUnlocking = false;
  private _threadsGateError: string | null = null;
  private _threadsGateCodeInvalid = false;
  private _threadsGateInvalidTimer: ReturnType<typeof setTimeout> | null = null;
  private _threadsUnlockingTimer: ReturnType<typeof setTimeout> | null = null;

  static styles = css`
    :host {
      display: block;
      height: 100%;
    }

    .cpk-gate {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px 24px;
      min-height: 100%;
      text-align: center;
      background: linear-gradient(135deg, #f5f4ff 0%, #ede9fe 100%);
      overflow: hidden;
    }

    /* Blurred ellipses from Figma/storybook */
    .cpk-gate__blob {
      position: absolute;
      border-radius: 50%;
      pointer-events: none;
    }

    .cpk-gate__blob--a {
      width: 570px;
      height: 570px;
      top: -80px;
      left: -120px;
      opacity: 0.25;
      background: #757cf2;
      filter: blur(120px);
    }

    .cpk-gate__blob--b {
      width: 570px;
      height: 570px;
      bottom: -100px;
      right: -80px;
      opacity: 0.2;
      background: #ffac4d;
      filter: blur(120px);
    }

    .cpk-gate__blob--c {
      width: 400px;
      height: 400px;
      bottom: 20px;
      left: -60px;
      opacity: 0.15;
      background: #ffac4d;
      filter: blur(100px);
    }

    /* ── Early-access card ── */
    .cpk-gate__card {
      position: relative;
      z-index: 1;
      background: #ffffff;
      border: 1px solid #e5e5ea;
      border-radius: 20px;
      box-shadow:
        0 16px 48px rgba(1, 5, 7, 0.12),
        0 2px 6px rgba(1, 5, 7, 0.05);
      padding: 28px;
      width: 400px;
      max-width: 100%;
      display: flex;
      flex-direction: column;
      gap: 18px;
      text-align: left;
      font-family: "Plus Jakarta Sans", system-ui, sans-serif;
    }

    .cpk-gate__pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      border-radius: 999px;
      background: #f3f3fc;
      color: #757cf2;
      font-family: "Spline Sans Mono", ui-monospace, monospace;
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .cpk-gate__heading {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .cpk-gate__title {
      font-family: "Plus Jakarta Sans", system-ui, sans-serif;
      font-size: 24px;
      font-weight: 700;
      color: #010507;
      line-height: 1.2;
      letter-spacing: -0.015em;
      margin: 0;
    }

    .cpk-gate__title-accent {
      background: linear-gradient(90deg, #757cf2 0%, #5ae4bb 100%);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
      -webkit-text-fill-color: transparent;
    }

    .cpk-gate__description {
      font-size: 14px;
      font-weight: 500;
      color: #5c5c66;
      line-height: 1.55;
      margin: 0;
    }

    .cpk-gate__bullets {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 4px 0;
    }

    .cpk-gate__bullet {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .cpk-gate__bullet-icon {
      flex-shrink: 0;
    }

    .cpk-gate__bullet-label {
      font-size: 13px;
      font-weight: 500;
      color: #010507;
    }

    .cpk-gate__cta {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      text-decoration: none;
      cursor: pointer;
    }

    .cpk-gate__cta-pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #010507;
      color: #ffffff;
      font-family: "Spline Sans Mono", ui-monospace, monospace;
      font-size: 13px;
      font-weight: 500;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      padding: 14px 22px;
      border-radius: 999px;
      box-shadow: 0 4px 12px rgba(1, 5, 7, 0.18);
    }

    .cpk-gate__cta-arrow {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border-radius: 999px;
      background: #010507;
      color: #ffffff;
      box-shadow: 0 4px 12px rgba(1, 5, 7, 0.18);
    }

    .cpk-gate__invite {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-top: 14px;
      border-top: 1px dashed #e5e5ea;
    }

    .cpk-gate__invite-label {
      font-size: 12px;
      font-weight: 500;
      color: #8a8a94;
    }

    .cpk-gate__invite-row {
      display: flex;
      gap: 8px;
    }

    .cpk-gate__input-wrap {
      flex: 1;
      background: #ffffff;
      border: 1px solid #e5e5ea;
      border-radius: 10px;
      padding: 2px 4px 2px 12px;
      transition: border-color 150ms ease;
    }

    .cpk-gate__input-wrap--invalid {
      border-color: #fa5f67;
    }

    .cpk-gate__input {
      width: 100%;
      padding: 10px 0;
      font-family: "Plus Jakarta Sans", system-ui, sans-serif;
      font-size: 13px;
      font-weight: 500;
      color: #010507;
      background: transparent;
      border: none;
      outline: none;
    }

    .cpk-gate__submit {
      background: #010507;
      color: #ffffff;
      border: none;
      border-radius: 10px;
      padding: 0 16px;
      font-family: "Spline Sans Mono", ui-monospace, monospace;
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      cursor: pointer;
      white-space: nowrap;
    }

    .cpk-gate__error {
      font-size: 11px;
      font-weight: 500;
      color: #fa5f67;
    }

    /* ── Unlocking confirmation card ── */
    .cpk-gate__welcome {
      position: relative;
      z-index: 1;
      background: #ffffff;
      border: 1px solid #e5e5ea;
      border-radius: 20px;
      box-shadow:
        0 16px 48px rgba(1, 5, 7, 0.12),
        0 2px 6px rgba(1, 5, 7, 0.05);
      padding: 32px;
      width: 340px;
      max-width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      text-align: center;
      font-family: "Plus Jakarta Sans", system-ui, sans-serif;
    }

    .cpk-gate__welcome-badge {
      width: 56px;
      height: 56px;
      border-radius: 999px;
      background: linear-gradient(135deg, #bec2ff 0%, #85ecce 100%);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .cpk-gate__welcome-title {
      font-size: 18px;
      font-weight: 700;
      color: #010507;
    }

    .cpk-gate__welcome-sub {
      font-size: 13px;
      color: #5c5c66;
      line-height: 1.5;
    }
  `;

  connectedCallback(): void {
    super.connectedCallback();
    // If the unlock cookie is already present, immediately notify the parent
    // so it can skip the gate UI entirely (matches the prior behavior on
    // WebInspectorElement.hydrateStateFromStorageEarly).
    // getCookie matches the exact name so a substring like
    // "xcpk_threads_access" can never satisfy this check.
    if (getCookie("cpk_threads_access") === "1") {
      this.dispatchEvent(
        new CustomEvent("unlock", { bubbles: true, composed: true }),
      );
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    // Pending timers must be cleared so they cannot fire after teardown and
    // call requestUpdate() / mutate state on a disconnected element.
    if (this._threadsGateInvalidTimer !== null) {
      clearTimeout(this._threadsGateInvalidTimer);
      this._threadsGateInvalidTimer = null;
    }
    if (this._threadsUnlockingTimer !== null) {
      clearTimeout(this._threadsUnlockingTimer);
      this._threadsUnlockingTimer = null;
    }
  }

  render() {
    return this.renderThreadsGate();
  }

  private renderThreadsGate() {
    return html`
      <div class="cpk-gate">
        <div class="cpk-gate__blob cpk-gate__blob--a"></div>
        <div class="cpk-gate__blob cpk-gate__blob--b"></div>
        <div class="cpk-gate__blob cpk-gate__blob--c"></div>

        ${
          this._threadsUnlocking
            ? this._renderUnlockingCard()
            : this._renderEarlyAccessCard()
        }
      </div>
    `;
  }

  private _renderEarlyAccessCard() {
    const invalid = this._threadsGateCodeInvalid;
    const inputWrapClass = invalid
      ? "cpk-gate__input-wrap cpk-gate__input-wrap--invalid"
      : "cpk-gate__input-wrap";
    return html`
      <div class="cpk-gate__card">
        <!-- Kicker pill -->
        <div>
          <span class="cpk-gate__pill">Early Access</span>
        </div>

        <!-- Title + description -->
        <div class="cpk-gate__heading">
          <h2 class="cpk-gate__title">
            <span class="cpk-gate__title-accent">Threads</span>
            are in private beta
          </h2>
          <p class="cpk-gate__description">
            Spin up separate conversations with your agent, one per task, bug,
            or feature, and jump back into any of them without losing context.
          </p>
        </div>

        <!-- Bullets -->
        <div class="cpk-gate__bullets">
          ${[
            "One agent, many conversations",
            "Persistent history across sessions",
            "Jump between threads in a click",
          ].map(
            (label) => html`
              <div class="cpk-gate__bullet">
                <svg
                  class="cpk-gate__bullet-icon"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#010507"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                <span class="cpk-gate__bullet-label">${label}</span>
              </div>
            `,
          )}
        </div>

        <!-- Primary CTA: dark MonoPillButton with adjacent arrow circle -->
        <div>
          <a
            class="cpk-gate__cta"
            href=${CpkThreadGate.THREADS_REQUEST_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span class="cpk-gate__cta-pill">Request Early Access</span>
            <span class="cpk-gate__cta-arrow">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <line x1="5" y1="12" x2="19" y2="12"></line>
                <polyline points="12 5 19 12 12 19"></polyline>
              </svg>
            </span>
          </a>
        </div>

        <!-- Divider + invite-code section -->
        <div class="cpk-gate__invite">
          <span class="cpk-gate__invite-label">Have an invite code?</span>
          <div class="cpk-gate__invite-row">
            <div class=${inputWrapClass}>
              <input
                id="cpk-gate-input"
                class="cpk-gate__input"
                type="text"
                placeholder="Enter access code"
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === "Enter") {
                    this._submitThreadsCode(
                      (e.currentTarget as HTMLInputElement).value,
                    );
                  }
                }}
              />
            </div>
            <button
              class="cpk-gate__submit"
              @click=${() => {
                const input = this.shadowRoot?.getElementById(
                  "cpk-gate-input",
                ) as HTMLInputElement | null;
                if (input) this._submitThreadsCode(input.value);
              }}
            >
              Unlock
            </button>
          </div>
          ${
            invalid
              ? html`
                  <div class="cpk-gate__error">
                    That code isn't valid. Double-check your invite email.
                  </div>
                `
              : nothing
          }
        </div>
      </div>
    `;
  }

  private _renderUnlockingCard() {
    return html`
      <div class="cpk-gate__welcome">
        <div class="cpk-gate__welcome-badge">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#010507"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        <div class="cpk-gate__welcome-title">Welcome to Threads</div>
        <div class="cpk-gate__welcome-sub">Loading your conversations…</div>
      </div>
    `;
  }

  private _submitThreadsCode(value: string): void {
    if (value.trim().toLowerCase() === "earlyaccess") {
      // Persist the unlock so subsequent loads bypass the gate, then show
      // the brief "Welcome to Threads" confirmation before swapping to the
      // real Threads UI ~2s later.
      document.cookie =
        "cpk_threads_access=1; path=/; max-age=31536000; SameSite=Lax";
      this._threadsGateError = null;
      this._threadsGateCodeInvalid = false;
      this._threadsUnlocking = true;
      if (this._threadsUnlockingTimer !== null) {
        clearTimeout(this._threadsUnlockingTimer);
      }
      this._threadsUnlockingTimer = setTimeout(() => {
        this._threadsUnlockingTimer = null;
        // Defense in depth — disconnectedCallback already nulls the timer
        // ref, but if a stale closure ever fired post-teardown we don't want
        // to call requestUpdate() / dispatch an event on a torn-down element.
        if (!this.isConnected) return;
        this._threadsUnlocking = false;
        this.dispatchEvent(
          new CustomEvent("unlock", { bubbles: true, composed: true }),
        );
        this.requestUpdate();
      }, 2000);
    } else {
      // Invalid: flash the input border + error copy, auto-clear after
      // 1600ms (matches the design's invalid-code window).
      this._threadsGateCodeInvalid = true;
      this._threadsGateError = null;
      if (this._threadsGateInvalidTimer !== null) {
        clearTimeout(this._threadsGateInvalidTimer);
      }
      this._threadsGateInvalidTimer = setTimeout(() => {
        this._threadsGateInvalidTimer = null;
        if (!this.isConnected) return;
        this._threadsGateCodeInvalid = false;
        this.requestUpdate();
      }, 1600);
    }
    this.requestUpdate();
  }
}

if (!customElements.get("cpk-thread-gate")) {
  customElements.define("cpk-thread-gate", CpkThreadGate);
}
