import { LitElement, html, nothing } from "lit";

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

  connectedCallback(): void {
    super.connectedCallback();
    // If the unlock cookie is already present, immediately notify the parent
    // so it can skip the gate UI entirely (matches the prior behavior on
    // WebInspectorElement.hydrateStateFromStorageEarly).
    if (
      typeof document !== "undefined" &&
      document.cookie.includes("cpk_threads_access=1")
    ) {
      this.dispatchEvent(
        new CustomEvent("unlock", { bubbles: true, composed: true }),
      );
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
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
      <div style="
        position:relative;
        display:flex;
        flex-direction:column;
        align-items:center;
        justify-content:center;
        padding:40px 24px;
        min-height:100%;
        text-align:center;
        background:linear-gradient(135deg,#f5f4ff 0%,#ede9fe 100%);
        overflow:hidden;
      ">
        <!-- Blurred ellipses from Figma/storybook -->
        <div style="position:absolute;width:570px;height:570px;border-radius:50%;top:-80px;left:-120px;opacity:0.25;background:#757CF2;filter:blur(120px);pointer-events:none;"></div>
        <div style="position:absolute;width:570px;height:570px;border-radius:50%;bottom:-100px;right:-80px;opacity:0.2;background:#FFAC4D;filter:blur(120px);pointer-events:none;"></div>
        <div style="position:absolute;width:400px;height:400px;border-radius:50%;bottom:20px;left:-60px;opacity:0.15;background:#FFAC4D;filter:blur(100px);pointer-events:none;"></div>

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
    return html`
      <div
        style="
          position:relative;
          z-index:1;
          background:#ffffff;
          border:1px solid #E5E5EA;
          border-radius:20px;
          box-shadow:0 16px 48px rgba(1,5,7,0.12),0 2px 6px rgba(1,5,7,0.05);
          padding:28px;
          width:400px;
          max-width:100%;
          display:flex;
          flex-direction:column;
          gap:18px;
          text-align:left;
          font-family:'Plus Jakarta Sans', system-ui, sans-serif;
        "
      >
        <!-- Kicker pill -->
        <div>
          <span
            style="
              display:inline-flex;
              align-items:center;
              gap:4px;
              padding:4px 10px;
              border-radius:999px;
              background:#F3F3FC;
              color:#757CF2;
              font-family:'Spline Sans Mono', ui-monospace, monospace;
              font-size:10px;
              font-weight:500;
              letter-spacing:0.08em;
              text-transform:uppercase;
            "
            >Early Access</span
          >
        </div>

        <!-- Title + description -->
        <div style="display:flex;flex-direction:column;gap:8px;">
          <h2
            style="
              font-family:'Plus Jakarta Sans', system-ui, sans-serif;
              font-size:24px;
              font-weight:700;
              color:#010507;
              line-height:1.2;
              letter-spacing:-0.015em;
              margin:0;
            "
          >
            <span
              style="
                background:linear-gradient(90deg, #757CF2 0%, #5AE4BB 100%);
                -webkit-background-clip:text;
                background-clip:text;
                color:transparent;
                -webkit-text-fill-color:transparent;
              "
              >Threads</span
            >
            are in private beta
          </h2>
          <p
            style="
              font-size:14px;
              font-weight:500;
              color:#5C5C66;
              line-height:1.55;
              margin:0;
            "
          >
            Spin up separate conversations with your agent, one per task, bug,
            or feature, and jump back into any of them without losing context.
          </p>
        </div>

        <!-- Bullets -->
        <div
          style="display:flex;flex-direction:column;gap:8px;padding:4px 0;"
        >
          ${[
            "One agent, many conversations",
            "Persistent history across sessions",
            "Jump between threads in a click",
          ].map(
            (label) => html`
              <div style="display:flex;align-items:center;gap:10px;">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#010507"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  style="flex-shrink:0;"
                >
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                <span style="font-size:13px;font-weight:500;color:#010507;"
                  >${label}</span
                >
              </div>
            `,
          )}
        </div>

        <!-- Primary CTA: dark MonoPillButton with adjacent arrow circle -->
        <div>
          <a
            href=${CpkThreadGate.THREADS_REQUEST_URL}
            target="_blank"
            rel="noopener noreferrer"
            style="
              display:inline-flex;
              align-items:center;
              gap:8px;
              text-decoration:none;
              cursor:pointer;
            "
          >
            <span
              style="
                display:inline-flex;
                align-items:center;
                justify-content:center;
                background:#010507;
                color:#ffffff;
                font-family:'Spline Sans Mono', ui-monospace, monospace;
                font-size:13px;
                font-weight:500;
                letter-spacing:0.06em;
                text-transform:uppercase;
                padding:14px 22px;
                border-radius:999px;
                box-shadow:0 4px 12px rgba(1,5,7,0.18);
              "
              >Request Early Access</span
            >
            <span
              style="
                display:inline-flex;
                align-items:center;
                justify-content:center;
                width:36px;
                height:36px;
                border-radius:999px;
                background:#010507;
                color:#ffffff;
                box-shadow:0 4px 12px rgba(1,5,7,0.18);
              "
            >
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
        <div
          style="
            display:flex;
            flex-direction:column;
            gap:8px;
            padding-top:14px;
            border-top:1px dashed #E5E5EA;
          "
        >
          <span style="font-size:12px;font-weight:500;color:#8A8A94;"
            >Have an invite code?</span
          >
          <div style="display:flex;gap:8px;">
            <div
              style="
                flex:1;
                background:#ffffff;
                border:1px solid ${invalid ? "#FA5F67" : "#E5E5EA"};
                border-radius:10px;
                padding:2px 4px 2px 12px;
                transition:border-color 150ms ease;
              "
            >
              <input
                id="cpk-gate-input"
                type="text"
                placeholder="Enter access code"
                style="
                  width:100%;
                  padding:10px 0;
                  font-family:'Plus Jakarta Sans', system-ui, sans-serif;
                  font-size:13px;
                  font-weight:500;
                  color:#010507;
                  background:transparent;
                  border:none;
                  outline:none;
                "
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
              style="
                background:#010507;
                color:#ffffff;
                border:none;
                border-radius:10px;
                padding:0 16px;
                font-family:'Spline Sans Mono', ui-monospace, monospace;
                font-size:11px;
                font-weight:500;
                letter-spacing:0.06em;
                text-transform:uppercase;
                cursor:pointer;
                white-space:nowrap;
              "
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
                  <div style="font-size: 11px; font-weight: 500; color: #fa5f67">
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
      <div
        style="
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
          font-family: &quot;Plus Jakarta Sans&quot;, system-ui, sans-serif;
        "
      >
        <div
          style="
            width: 56px;
            height: 56px;
            border-radius: 999px;
            background: linear-gradient(135deg, #bec2ff 0%, #85ecce 100%);
            display: flex;
            align-items: center;
            justify-content: center;
          "
        >
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
        <div style="font-size: 18px; font-weight: 700; color: #010507">
          Welcome to Threads
        </div>
        <div style="font-size: 13px; color: #5c5c66; line-height: 1.5">
          Loading your conversations…
        </div>
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
        this._threadsUnlocking = false;
        this._threadsUnlockingTimer = null;
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
        this._threadsGateCodeInvalid = false;
        this._threadsGateInvalidTimer = null;
        this.requestUpdate();
      }, 1600);
    }
    this.requestUpdate();
  }
}

if (!customElements.get("cpk-thread-gate")) {
  customElements.define("cpk-thread-gate", CpkThreadGate);
}
