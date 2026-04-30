import { LitElement, css, html, nothing } from "lit";
import type { ɵThread } from "@copilotkit/core";
import { safeDate } from "../lib/safe";

// ─── cpk-thread-list ────────────────────────────────────────────────────────

class CpkThreadList extends LitElement {
  static properties = {
    threads: { attribute: false },
    selectedThreadId: { attribute: false },
    _query: { state: true },
  };
  threads: ɵThread[] = [];
  selectedThreadId: string | null = null;
  private _query = "";

  static styles = css`
    @import url("https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600&family=Spline+Sans+Mono:wght@400;500&display=swap");

    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    .cpk-tl {
      font-family: "Plus Jakarta Sans", sans-serif;
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
      background: #f7f7f9;
    }

    /* ── Search ── */
    .cpk-tl__search {
      padding: 10px 12px;
      border-bottom: 1px solid #dbdbe5;
      flex-shrink: 0;
    }

    .cpk-tl__search-input {
      width: 100%;
      box-sizing: border-box;
      font-family: "Plus Jakarta Sans", sans-serif;
      font-size: 12px;
      padding: 7px 10px;
      border-radius: 6px;
      border: 1px solid #dbdbe5;
      background: #ffffff;
      color: #010507;
      outline: none;
      transition: border-color 0.15s;
    }

    .cpk-tl__search-input:focus {
      border-color: #bec2ff;
    }

    /* ── List ── */
    .cpk-tl__list {
      flex: 1;
      overflow-y: auto;
    }

    /* ── Thread item ── */
    .cpk-tl__item {
      padding: 11px 13px;
      cursor: pointer;
      border-bottom: 1px solid #e9e9ef;
      border-left: 3px solid transparent;
      transition: background 0.1s;
    }

    .cpk-tl__item:hover {
      background: #ffffff;
    }

    .cpk-tl__item--active {
      background: #bec2ff1a;
      border-left-color: #bec2ff;
    }

    .cpk-tl__item--active:hover {
      background: #bec2ff33;
    }

    .cpk-tl__row1 {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 3px;
    }

    .cpk-tl__name {
      font-size: 12px;
      font-weight: 500;
      color: #010507;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .cpk-tl__name--unnamed {
      color: #838389;
      font-style: italic;
      font-weight: 400;
    }

    .cpk-tl__time {
      font-family: "Spline Sans Mono", monospace;
      font-size: 10px;
      color: #838389;
      flex-shrink: 0;
    }

    .cpk-tl__meta {
      display: flex;
      gap: 6px;
      align-items: center;
      flex-wrap: wrap;
    }

    .cpk-tl__pill {
      font-family: "Spline Sans Mono", monospace;
      font-size: 9px;
      padding: 1px 7px;
      border-radius: 4px;
      text-transform: uppercase;
      font-weight: 500;
      white-space: nowrap;
      background: #eee6fe;
      color: #57575b;
    }

    /* ── Empty state ── */
    .cpk-tl__empty {
      padding: 32px 16px;
      text-align: center;
      color: #838389;
      font-size: 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }

    .cpk-tl__empty-icon {
      color: #c0c0c8;
    }
  `;

  private relativeTime(dateStr: string): string {
    const date = safeDate(dateStr);
    if (!date) return "—";
    // Clamp negative diffs (clock skew, server-future timestamps) to 0
    // instead of rendering a meaningless "-3s ago".
    const diffMs = Math.max(0, Date.now() - date.getTime());
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    return `${diffD}d ago`;
  }

  private get filtered(): ɵThread[] {
    // Trim before short-circuiting so a query of "   " behaves like an empty
    // query (returning all threads) rather than filtering against whitespace.
    const q = this._query.trim().toLowerCase();
    if (!q) return this.threads;
    return this.threads.filter(
      (t) =>
        (t.name?.toLowerCase().includes(q) ?? false) ||
        t.agentId.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q),
    );
  }

  private onThreadClick(threadId: string): void {
    this.dispatchEvent(
      new CustomEvent("threadSelected", {
        detail: threadId,
        bubbles: true,
        composed: true,
      }),
    );
  }

  private onSearchInput = (event: Event): void => {
    this._query = (event.target as HTMLInputElement).value;
  };

  render() {
    const filtered = this.filtered;
    return html`
      <div class="cpk-tl">
        <!-- Search -->
        <div class="cpk-tl__search">
          <input
            type="text"
            placeholder="Search threads…"
            .value=${this._query}
            @input=${this.onSearchInput}
            class="cpk-tl__search-input"
          />
        </div>

        <!-- Thread list -->
        <div class="cpk-tl__list">
          ${filtered.map(
            (thread) => html`
              <div
                class="cpk-tl__item ${
                  this.selectedThreadId === thread.id
                    ? "cpk-tl__item--active"
                    : ""
                }"
                @click=${() => this.onThreadClick(thread.id)}
              >
                <div class="cpk-tl__row1">
                  <span
                    class="cpk-tl__name ${
                      !thread.name ? "cpk-tl__name--unnamed" : ""
                    }"
                    >${thread.name ?? "Untitled"}</span
                  >
                  <span class="cpk-tl__time"
                    >${this.relativeTime(thread.updatedAt)}</span
                  >
                </div>
                <div class="cpk-tl__meta">
                  <span class="cpk-tl__pill">${thread.agentId}</span>
                </div>
              </div>
            `,
          )}
          ${
            filtered.length === 0
              ? html`
                <div class="cpk-tl__empty">
                  ${
                    this.threads.length === 0
                      ? html`
                          <svg
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.5"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            class="cpk-tl__empty-icon"
                          >
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                          </svg>
                          No threads yet
                        `
                      : html`
                          No threads match your search.
                        `
                  }
                </div>
              `
              : nothing
          }
        </div>
      </div>
    `;
  }
}

if (!customElements.get("cpk-thread-list")) {
  customElements.define("cpk-thread-list", CpkThreadList);
}
