import { LitElement, css, html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { ɵThread } from "@copilotkit/core";
import {
  eventColors,
  formatTimestamp,
  highlightedJson,
} from "../lib/highlight";
import type {
  ApiAgentEvent,
  ApiThreadMessage,
  ConversationAssistant,
  ConversationGenerativeUIItem,
  ConversationItem,
  ConversationToolCall,
  ConversationUser,
  RenderItem,
  ThreadDetailsTab,
  ToolCallGroup,
} from "../lib/types";

// ─── cpk-thread-details ──────────────────────────────────────────────────────
// Renders the selected thread's conversation, agent state, and AG-UI events.
// Fetches per-thread history from the runtime's /threads/:id/{messages,events,state}
// endpoints whenever threadId changes. Live overrides (from the parent inspector's
// ongoing agent subscriptions) take priority when present, otherwise fetched data
// is authoritative.

class CpkThreadDetails extends LitElement {
  static properties = {
    threadId: { attribute: false },
    thread: { attribute: false },
    runtimeUrl: { attribute: false },
    headers: { attribute: false },
    agentStateInput: { attribute: false },
    agentEventsInput: { attribute: false },
    conversationOverride: { attribute: false },
    _tab: { state: true },
    _conversation: { state: true },
    _fetchedEvents: { state: true },
    _fetchedState: { state: true },
    _loadingMessages: { state: true },
    _loadingEvents: { state: true },
    _loadingState: { state: true },
    _messagesError: { state: true },
    _eventsError: { state: true },
    _stateError: { state: true },
    _expandedTools: { state: true },
    _expandedMessages: { state: true },
    _showDetailPanel: { state: true },
    _detailPanelWidth: { state: true },
    _eventsNotAvailable: { state: true },
    _stateNotAvailable: { state: true },
  };

  threadId: string | null = null;
  thread: ɵThread | null = null;
  runtimeUrl = "";
  headers: Record<string, string> = {};
  agentStateInput: Record<string, unknown> | null = null;
  agentEventsInput: ApiAgentEvent[] = [];
  conversationOverride: ConversationItem[] | null = null;

  private _tab: ThreadDetailsTab = "conversation";
  private _conversation: ConversationItem[] = [];
  private _fetchedEvents: ApiAgentEvent[] | null = null;
  private _fetchedState: Record<string, unknown> | null = null;
  private _loadingMessages = false;
  private _loadingEvents = false;
  private _loadingState = false;
  private _messagesError: string | null = null;
  private _eventsError: string | null = null;
  private _stateError: string | null = null;
  private _expandedTools = new Set<string>();
  private _expandedMessages = new Set<string>();
  private _showDetailPanel = false;
  private _detailPanelWidth = 250;
  /** True when the /events endpoint returned 501 — don't fall back to live data. */
  private _eventsNotAvailable = false;
  /** True when the /state endpoint returned 501 — don't fall back to live data. */
  private _stateNotAvailable = false;
  private _lastFetchedThreadId: string | null = null;
  private _messagesAbort: AbortController | null = null;
  private _eventsAbort: AbortController | null = null;
  private _stateAbort: AbortController | null = null;
  private _dividerResizing = false;
  private _dividerPointerId = -1;
  private _dividerStartX = 0;
  private _dividerStartWidth = 0;

  static readonly COLLAPSE_THRESHOLD = 800;
  private static readonly TAB_LIST: Array<{
    id: ThreadDetailsTab;
    label: string;
  }> = [
    { id: "conversation", label: "Conversation" },
    { id: "agent-state", label: "Agent State" },
    { id: "ag-ui-events", label: "AG-UI Events" },
  ];

  static styles = css`
    @import url("https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600&family=Spline+Sans+Mono:wght@400;500&display=swap");

    /* ── Root ────────────────────────────────────────────────────────── */
    :host {
      display: flex;
      flex-direction: row;
      overflow: hidden;
    }

    .cpk-td {
      font-family: "Plus Jakarta Sans", sans-serif;
      font-size: 13px;
      display: flex;
      flex-direction: row;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #ffffff;
    }

    /* ── Left area ───────────────────────────────────────────────────── */
    .cpk-td__left {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* ── Tab bar header ──────────────────────────────────────────────── */
    .cpk-td__tabs-header {
      /* No top/right padding so tabs and toggle sit flush against the
         top and right edges of the inspector. */
      padding: 0 0 0 12px;
      border-bottom: 1px solid #dbdbe5;
      flex-shrink: 0;
      display: flex;
      align-items: stretch;
    }

    .cpk-td__tab-group {
      display: flex;
      gap: 0;
      margin-bottom: -1px;
      /* Allow the tab list to shrink rather than pushing the panel-toggle
         button past the right edge of the inspector when horizontal space
         gets tight (the drawer being open eats noticeably into width). */
      min-width: 0;
      flex-shrink: 1;
      overflow: hidden;
    }

    .cpk-td__tab {
      font-family: "Plus Jakarta Sans", sans-serif;
      font-size: 11px;
      font-weight: 500;
      padding: 10px 12px;
      border: none;
      border-bottom: 2px solid transparent;
      cursor: pointer;
      background: transparent;
      color: #838389;
      transition:
        color 0.12s,
        border-color 0.12s;
      white-space: nowrap;
    }

    .cpk-td__tab:hover {
      color: #010507;
    }

    .cpk-td__tab--active {
      color: #010507;
      border-bottom-color: #bec2ff;
    }

    /* Toggle is a separate control, not a tab — so it does NOT use the
       tabs' bottom-border active indicator. Instead, a subtle filled
       state communicates "the drawer is open," and a vertical separator
       on the left visually divorces it from the tab group. */
    .cpk-td__panel-toggle {
      margin-left: auto;
      align-self: stretch;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 12px;
      border: none;
      border-left: 1px solid #dbdbe5;
      background: transparent;
      color: #838389;
      cursor: pointer;
      flex-shrink: 0;
      transition:
        color 0.12s,
        background 0.12s;
    }
    .cpk-td__panel-toggle:hover {
      color: #010507;
      background: #f4f4f9;
    }
    .cpk-td__panel-toggle--active {
      color: #5558b2;
      background: #eee6fe;
    }
    .cpk-td__panel-toggle--active:hover {
      background: #e4d8fc;
    }

    /* ── Scrollable content ──────────────────────────────────────────── */
    .cpk-td__content {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    /* Pin direct children so expanded tool bodies don't get flex-shrunk. */
    .cpk-td__content > * {
      flex-shrink: 0;
    }

    /* ── Empty state ─────────────────────────────────────────────────── */
    .cpk-td__empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      color: #838389;
      font-size: 13px;
      padding: 40px 0;
    }

    .cpk-td__empty-hint {
      font-size: 11px;
      color: #838389;
      text-align: center;
      max-width: 220px;
      line-height: 1.5;
    }

    /* ── Status messages ─────────────────────────────────────────────── */
    .cpk-td__status {
      padding: 16px;
      font-size: 12px;
      color: #838389;
      text-align: center;
    }

    .cpk-td__status--error {
      color: #c0333a;
    }

    /* ── Conversation bubbles ────────────────────────────────────────── */
    .cpk-td__bubble {
      display: flex;
      margin-bottom: 2px;
    }

    .cpk-td__bubble--user {
      justify-content: flex-end;
    }

    .cpk-td__bubble--assistant {
      justify-content: flex-start;
    }

    .cpk-td__bubble-inner {
      padding: 9px 14px;
      max-width: 75%;
      font-size: 13px;
      line-height: 1.55;
    }

    .cpk-td__bubble-inner--user {
      background: #eee6fe;
      color: #57575b;
      border-radius: 10px 10px 3px 10px;
    }

    .cpk-td__show-more {
      display: inline-block;
      margin-top: 4px;
      font-size: 11px;
      font-weight: 500;
      color: #57575b;
      cursor: pointer;
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    .cpk-td__bubble-inner--assistant {
      background: #f7f7f9;
      color: #010507;
      border-radius: 10px 10px 10px 3px;
      border: 1px solid #e9e9ef;
    }

    /* ── Tool call blocks ────────────────────────────────────────────── */
    .cpk-td__tool-block {
      border: 1px solid #e9e9ef;
      border-radius: 6px;
      overflow: hidden;
    }

    .cpk-td__tool-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      background: rgba(133, 236, 206, 0.15);
      cursor: pointer;
      font-size: 11px;
      user-select: none;
    }

    .cpk-td__tool-header:hover {
      background: rgba(133, 236, 206, 0.22);
    }

    .cpk-td__tool-name {
      font-family: "Spline Sans Mono", monospace;
      font-size: 10px;
      font-weight: 500;
      color: #189370;
      text-transform: uppercase;
      flex: 1;
    }

    .cpk-td__tool-status {
      font-family: "Spline Sans Mono", monospace;
      font-size: 9px;
      text-transform: uppercase;
      color: #189370;
    }

    .cpk-td__tool-status--pending {
      color: #996300;
    }

    .cpk-td__tool-chevron {
      color: #838389;
      font-size: 10px;
    }

    .cpk-td__tool-body {
      padding: 8px 10px;
      border-top: 1px solid #e9e9ef;
      background: #ffffff;
    }

    .cpk-td__tool-section-label {
      font-family: "Spline Sans Mono", monospace;
      font-size: 9px;
      font-weight: 500;
      color: #838389;
      text-transform: uppercase;
      margin-bottom: 4px;
      letter-spacing: 0.3px;
    }

    .cpk-td__tool-pre {
      margin: 0;
      font-family: "Spline Sans Mono", monospace;
      font-size: 10px;
      background: #f7f7f9;
      padding: 6px 8px;
      border-radius: 4px;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-all;
      color: #010507;
      line-height: 1.6;
    }

    /* ── Tool call group ─────────────────────────────────────────────── */
    .cpk-td__tool-group {
      border: 1px solid #e9e9ef;
      border-radius: 6px;
      overflow: hidden;
    }

    .cpk-td__tool-group-header {
      padding: 5px 10px;
      background: rgba(133, 236, 206, 0.15);
      font-family: "Spline Sans Mono", monospace;
      font-size: 10px;
      color: #189370;
      text-transform: uppercase;
      font-weight: 500;
      border-bottom: 1px solid #e9e9ef;
    }

    .cpk-td__tool-group .cpk-td__tool-block {
      border: none;
      border-bottom: 1px solid #e9e9ef;
      border-radius: 0;
    }

    .cpk-td__tool-group .cpk-td__tool-block:last-child {
      border-bottom: none;
    }

    /* ── Inline chips (reasoning / state update) ─────────────────────── */
    .cpk-td__inline-chip {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 0;
      color: #838389;
      font-family: "Spline Sans Mono", monospace;
      font-size: 9px;
      text-transform: uppercase;
    }

    .cpk-td__inline-chip::before,
    .cpk-td__inline-chip::after {
      content: "";
      flex: 1;
      height: 1px;
      background: #e9e9ef;
    }

    /* ── Generative UI ──────────────────────────────────────────────── */
    @keyframes cpk-genui-enter {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .cpk-td__genui {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 4px 16px 8px;
      animation: cpk-genui-enter 0.25s cubic-bezier(0.16, 1, 0.3, 1) both;
    }

    .cpk-td__genui-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 4px;
      background: #eee6fe;
      color: #57575b;
      font-size: 10px;
      font-weight: 600;
      align-self: flex-start;
    }

    .cpk-td__genui-card {
      overflow: hidden;
      border-radius: 12px;
      border: 1px solid #e2e8f0;
      background: #fff;
      box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.08);
    }

    .cpk-td__genui-placeholder {
      padding: 8px 12px;
      border-radius: 8px;
      border: 1px solid #ede9fe;
      background: #f5f3ff;
      color: #7c3aed;
      font-size: 11px;
    }

    /* ── AG-UI Events ────────────────────────────────────────────────── */
    .cpk-td__event {
      flex-shrink: 0;
      border: 1px solid #e9e9ef;
      border-radius: 6px;
      overflow: hidden;
    }

    .cpk-td__event-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 5px 10px;
    }

    .cpk-td__event-type {
      font-family: "Spline Sans Mono", monospace;
      font-size: 9px;
      font-weight: 500;
      text-transform: uppercase;
    }

    .cpk-td__event-time {
      font-family: "Spline Sans Mono", monospace;
      font-size: 9px;
      color: #838389;
    }

    .cpk-td__event-payload {
      margin: 0;
      font-family: "Spline Sans Mono", monospace;
      font-size: 10px;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-all;
      color: #57575b;
      padding: 8px 10px;
      border-top: 1px solid #e9e9ef;
    }

    /* ── JSON block (agent state) ────────────────────────────────────── */
    .cpk-td__json-block {
      margin: 0;
      font-family: "Spline Sans Mono", monospace;
      font-size: 11px;
      line-height: 1.8;
      white-space: pre-wrap;
      word-break: break-all;
      color: #57575b;
    }

    /* ── Resize divider ──────────────────────────────────────────────── */
    /* Floats over the drawer's left edge so the toggle and the drawer
       touch directly without a 4px flex-gap between them. The hit zone
       is wider than its visual hint to make it easy to grab. */
    .cpk-td__detail-divider {
      position: absolute;
      top: 0;
      bottom: 0;
      left: -3px;
      width: 7px;
      cursor: col-resize;
      background: transparent;
      z-index: 5;
    }

    .cpk-td__detail-divider:hover {
      background: rgba(190, 194, 255, 0.3);
    }

    /* ── Right detail panel ──────────────────────────────────────────── */
    .cpk-td__detail {
      flex-shrink: 0;
      overflow: hidden;
      background: #f7f7f9;
      display: flex;
      flex-direction: column;
      gap: 0;
      padding: 0;
      box-sizing: border-box;
      position: relative;
      /* Slide open/closed via width + padding transition. When closed,
         width and padding are 0 so the drawer fully collapses. */
      transition:
        width 220ms cubic-bezier(0.4, 0, 0.2, 1),
        padding 220ms cubic-bezier(0.4, 0, 0.2, 1);
    }

    .cpk-td__detail[data-open="true"] {
      overflow-y: auto;
      padding: 16px;
    }

    .cpk-tdp__section-title {
      font-family: "Spline Sans Mono", monospace;
      font-size: 10px;
      font-weight: 500;
      color: #838389;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      margin-bottom: 8px;
    }

    .cpk-tdp__divider {
      height: 1px;
      background: #dbdbe5;
      margin: 14px 0;
    }

    .cpk-tdp__row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 3px 0;
      gap: 8px;
    }

    .cpk-tdp__label {
      color: #838389;
      font-size: 11px;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .cpk-tdp__value {
      color: #010507;
      font-family: "Spline Sans Mono", monospace;
      font-size: 11px;
      text-align: right;
      min-width: 0;
    }

    .cpk-tdp__value--truncate {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 130px;
    }

    .cpk-tdp__value--wrap {
      white-space: normal;
      word-break: break-all;
      text-align: right;
    }
  `;

  updated(changed: Map<string, unknown>): void {
    if (this.threadId !== this._lastFetchedThreadId) {
      this._lastFetchedThreadId = this.threadId;
      this._tab = "conversation";
      this._expandedTools = new Set();
      this._expandedMessages = new Set();
      // Cancel any in-flight per-tab fetches for the previous thread. Each tab
      // has its own controller so an aborted /messages call doesn't also
      // cancel an unrelated /events or /state call.
      this._abortAllFetches();

      const override = this.conversationOverride;
      if (override !== null) {
        this._conversation = override;
      } else if (this.threadId) {
        void this.fetchMessages(this.threadId);
      } else {
        this._conversation = [];
      }

      if (this.threadId) {
        void this.fetchEvents(this.threadId);
        void this.fetchState(this.threadId);
      } else {
        this._fetchedEvents = null;
        this._fetchedState = null;
      }
    } else if (changed.has("conversationOverride")) {
      const override = this.conversationOverride;
      if (override !== null) {
        this._conversation = override;
      }
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._abortAllFetches();
  }

  private _abortAllFetches(): void {
    this._messagesAbort?.abort();
    this._messagesAbort = null;
    this._eventsAbort?.abort();
    this._eventsAbort = null;
    this._stateAbort?.abort();
    this._stateAbort = null;
  }

  /**
   * Shared per-tab fetch driver. Owns the AbortController lifecycle, loading
   * flag, error classification, and the 501 "not available" sentinel — so
   * each tab fetcher only needs to declare which URL to hit and how to parse
   * the response body. Caller supplies the tab descriptor; the helper writes
   * back to the matching reactive state slot.
   */
  private async _fetchTab<T>(
    tab: "messages" | "events" | "state",
    threadId: string,
    parser: (data: unknown) => T,
    fallback: T,
  ): Promise<void> {
    const path =
      tab === "messages" ? "messages" : tab === "events" ? "events" : "state";

    // Reset the 501 sentinel for tabs that have one; messages doesn't.
    if (tab === "events") this._eventsNotAvailable = false;
    if (tab === "state") this._stateNotAvailable = false;

    if (!this.runtimeUrl) {
      if (tab === "messages") this._conversation = [];
      else if (tab === "events") this._fetchedEvents = null;
      else this._fetchedState = null;
      return;
    }

    // Replace any in-flight controller for THIS tab. Other tabs are unaffected.
    const controller = new AbortController();
    if (tab === "messages") {
      this._messagesAbort?.abort();
      this._messagesAbort = controller;
      this._loadingMessages = true;
      this._messagesError = null;
    } else if (tab === "events") {
      this._eventsAbort?.abort();
      this._eventsAbort = controller;
      this._loadingEvents = true;
      this._eventsError = null;
    } else {
      this._stateAbort?.abort();
      this._stateAbort = controller;
      this._loadingState = true;
      this._stateError = null;
    }

    try {
      const res = await fetch(
        `${this.runtimeUrl}/threads/${encodeURIComponent(threadId)}/${path}`,
        { headers: { ...this.headers }, signal: controller.signal },
      );
      // 501 means "endpoint not supported on this runtime" (e.g. Intelligence
      // platform). Set the per-tab sentinel so the renderer doesn't fall back
      // to the parent's live agent-keyed data, which would render identically
      // across every thread on the same agent. Messages has no sentinel —
      // any non-200 there is a hard error.
      if (res.status === 501 && tab !== "messages") {
        if (tab === "events") {
          this._eventsNotAvailable = true;
          this._fetchedEvents = null;
        } else {
          this._stateNotAvailable = true;
          this._fetchedState = null;
        }
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as unknown;
      const parsed = parser(data);
      if (tab === "messages") {
        this._conversation = parsed as unknown as ConversationItem[];
      } else if (tab === "events") {
        this._fetchedEvents = parsed as unknown as ApiAgentEvent[];
      } else {
        this._fetchedState = parsed as unknown as Record<string, unknown> | null;
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      const message =
        err instanceof Error
          ? err.message
          : `Failed to load ${tab === "messages" ? "messages" : tab === "events" ? "events" : "state"}`;
      if (tab === "messages") {
        this._messagesError = message;
        this._conversation = fallback as unknown as ConversationItem[];
      } else if (tab === "events") {
        this._eventsError = message;
        this._fetchedEvents = fallback as unknown as ApiAgentEvent[];
      } else {
        this._stateError = message;
        this._fetchedState = fallback as unknown as Record<string, unknown> | null;
      }
    } finally {
      // Don't toggle the loading flag if we were aborted — a newer fetch is
      // already in flight and owns the flag now.
      if (!controller.signal.aborted) {
        if (tab === "messages") this._loadingMessages = false;
        else if (tab === "events") this._loadingEvents = false;
        else this._loadingState = false;
      }
    }
  }

  private fetchMessages(threadId: string): Promise<void> {
    return this._fetchTab<ConversationItem[]>(
      "messages",
      threadId,
      (data) => {
        const { messages } = data as { messages: ApiThreadMessage[] };
        return this.mapMessages(messages);
      },
      [],
    );
  }

  private fetchEvents(threadId: string): Promise<void> {
    return this._fetchTab<ApiAgentEvent[]>(
      "events",
      threadId,
      (data) => {
        const { events } = data as { events: Array<Record<string, unknown>> };
        return this.mapApiEvents(events);
      },
      [],
    );
  }

  private fetchState(threadId: string): Promise<void> {
    return this._fetchTab<Record<string, unknown> | null>(
      "state",
      threadId,
      (data) => {
        const { state } = data as { state: Record<string, unknown> | null };
        return state ?? null;
      },
      null,
    );
  }

  private mapMessages(messages: ApiThreadMessage[]): ConversationItem[] {
    const items: ConversationItem[] = [];
    const toolCallMap = new Map<string, ConversationToolCall>();
    for (const msg of messages) {
      if (msg.role === "user" && msg.content) {
        items.push({
          id: msg.id,
          type: "user",
          content: msg.content,
          createdAt: "",
        });
      } else if (msg.role === "assistant") {
        if (msg.toolCalls?.length) {
          for (const tc of msg.toolCalls) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(tc.args) as Record<string, unknown>;
            } catch {
              /* leave empty */
            }
            const item: ConversationToolCall = {
              id: tc.id,
              type: "tool_call",
              toolName: tc.name,
              toolCallId: tc.id,
              arguments: args,
              result: null,
              createdAt: "",
            };
            toolCallMap.set(tc.id, item);
            items.push(item);
          }
        }
        if (msg.content) {
          items.push({
            id: msg.id,
            type: "assistant",
            content: msg.content,
            createdAt: "",
          });
        }
      } else if (msg.role === "activity") {
        items.push({
          id: msg.id,
          type: "generative-ui",
          activityType: msg.activityType ?? "unknown",
          createdAt: "",
        });
      } else if (msg.role === "tool" && msg.toolCallId) {
        const tc = toolCallMap.get(msg.toolCallId);
        if (tc) {
          try {
            tc.result = JSON.parse(msg.content ?? "{}") as Record<
              string,
              unknown
            >;
          } catch {
            tc.result = {};
          }
        }
      }
    }
    return items;
  }

  private mapApiEvents(
    events: Array<Record<string, unknown>>,
  ): ApiAgentEvent[] {
    return events.map((event) => {
      const { type, timestamp, ...rest } = event;
      return {
        type: typeof type === "string" ? type : "UNKNOWN",
        timestamp:
          typeof timestamp === "string" || typeof timestamp === "number"
            ? timestamp
            : Date.now(),
        payload: rest,
      };
    });
  }

  private get renderItems(): RenderItem[] {
    const items = this._conversation;
    const result: RenderItem[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      if (item.type === "agent_responded") continue;
      if (item.type !== "tool_call" || !item.groupId) {
        result.push(item);
        continue;
      }
      if (seen.has(item.groupId)) continue;
      seen.add(item.groupId);
      const group: ToolCallGroup = {
        type: "tool_call_group",
        id: item.groupId,
        items: items.filter(
          (i): i is ConversationToolCall =>
            i.type === "tool_call" && i.groupId === item.groupId,
        ),
      };
      result.push(group);
    }
    return result;
  }

  private get activityCounts(): {
    messages: number;
    toolCalls: number;
    generativeUi: number;
  } {
    let messages = 0;
    let toolCalls = 0;
    let generativeUi = 0;
    for (const item of this._conversation) {
      if (item.type === "user" || item.type === "assistant") messages++;
      if (item.type === "tool_call") toolCalls++;
      if (item.type === "generative-ui") generativeUi++;
    }
    return { messages, toolCalls, generativeUi };
  }

  private get duration(): string {
    const t = this.thread;
    if (!t?.createdAt || !t?.updatedAt) return "—";
    const ms =
      new Date(t.updatedAt).getTime() - new Date(t.createdAt).getTime();
    if (ms < 0) return "—";
    if (ms < 1000) return `${ms}ms`;
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rs = s % 60;
    return `${m}m ${rs}s`;
  }

  private toggleToolExpand(id: string): void {
    const next = new Set(this._expandedTools);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this._expandedTools = next;
  }

  private toggleMessageExpand(id: string): void {
    const next = new Set(this._expandedMessages);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this._expandedMessages = next;
  }

  private get activeEvents(): ApiAgentEvent[] {
    // When the endpoint explicitly returned 501 we report no events rather
    // than leaking the parent's agent-keyed live events across historical
    // threads (those would render identically for every thread on the same
    // agent and mislead the reader).
    if (this._eventsNotAvailable) return [];
    return this._fetchedEvents ?? this.agentEventsInput ?? [];
  }

  private get activeState(): Record<string, unknown> | null {
    if (this._stateNotAvailable) return null;
    return this._fetchedState ?? this.agentStateInput ?? null;
  }

  private hasRenderableState(): boolean {
    const s = this.activeState;
    return !!s && typeof s === "object" && Object.keys(s).length > 0;
  }

  private shortId(id: string | null | undefined): string {
    if (!id) return "—";
    return id.length > 20 ? id.slice(0, 8) + "…" : id;
  }

  private fmtTime(dateStr: string | null | undefined): string {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }

  private onDetailDividerDown = (event: PointerEvent): void => {
    this._dividerResizing = true;
    this._dividerPointerId = event.pointerId;
    this._dividerStartX = event.clientX;
    this._dividerStartWidth = this._detailPanelWidth;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  private onDetailDividerMove = (event: PointerEvent): void => {
    if (!this._dividerResizing || this._dividerPointerId !== event.pointerId)
      return;
    const delta = this._dividerStartX - event.clientX;
    this._detailPanelWidth = Math.max(
      160,
      Math.min(400, this._dividerStartWidth + delta),
    );
  };

  private onDetailDividerUp = (event: PointerEvent): void => {
    if (this._dividerPointerId !== event.pointerId) return;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(this._dividerPointerId)) {
      target.releasePointerCapture(this._dividerPointerId);
    }
    this._dividerResizing = false;
  };

  render() {
    return html`
      <div class="cpk-td">
        <!-- ── Left area: tabs + content ─────────────────────────────────── -->
        <div class="cpk-td__left">
          <!-- Tab bar -->
          <div class="cpk-td__tabs-header">
            <div class="cpk-td__tab-group" role="tablist">
              ${CpkThreadDetails.TAB_LIST.map(
                (tab) => html`
                  <button
                    role="tab"
                    class="cpk-td__tab ${
                      this._tab === tab.id ? "cpk-td__tab--active" : ""
                    }"
                    @click=${() => {
                      this._tab = tab.id;
                    }}
                  >
                    ${tab.label}
                  </button>
                `,
              )}
            </div>
            ${this.renderPanelToggle()}
          </div>

          <!-- Scrollable content -->
          <div class="cpk-td__content">
            ${
              this._tab === "conversation"
                ? this.renderConversation()
                : this._tab === "agent-state"
                  ? this.renderState()
                  : this.renderEvents()
            }
          </div>
        </div>

        <!--
          Drawer always rendered so width animates between 0 and its
          target. Divider lives INSIDE the drawer and is absolutely
          positioned over its left edge so the toggle (rightmost of the
          tab row) and the drawer touch with no flex-gap between them.
        -->
        <div
          class="cpk-td__detail"
          data-open=${this._showDetailPanel ? "true" : "false"}
          style="width:${this._showDetailPanel ? this._detailPanelWidth : 0}px"
          aria-hidden=${this._showDetailPanel ? "false" : "true"}
        >
          ${
            this._showDetailPanel
              ? html`
                <div
                  class="cpk-td__detail-divider"
                  @pointerdown=${this.onDetailDividerDown}
                  @pointermove=${this.onDetailDividerMove}
                  @pointerup=${this.onDetailDividerUp}
                  @pointercancel=${this.onDetailDividerUp}
                ></div>
              `
              : nothing
          }
          ${this.renderDetailPanel()}
        </div>
      </div>
    `;
  }

  private renderConversation() {
    if (this._loadingMessages) {
      return html`
        <div class="cpk-td__status">Loading messages…</div>
      `;
    }
    if (this._messagesError) {
      return html`<div class="cpk-td__status cpk-td__status--error">
        ${this._messagesError}
      </div>`;
    }
    const items = this.renderItems;
    if (items.length === 0) {
      return html`
        <div class="cpk-td__empty-state">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span>No messages yet</span>
        </div>
      `;
    }
    return html`${items.map((item) => this.renderRenderItem(item))}`;
  }

  private renderRenderItem(item: RenderItem) {
    switch (item.type) {
      case "user":
      case "assistant":
        return this.renderBubble(item);
      case "tool_call":
        return this.renderToolBlock(item);
      case "tool_call_group":
        return this.renderToolGroup(item);
      case "reasoning":
        return html`<div class="cpk-td__inline-chip">
          <span>Reasoned for ${item.duration}</span>
        </div>`;
      case "state_update":
        return html`
          <div class="cpk-td__inline-chip">
            <span>Updated agent state</span>
          </div>
        `;
      case "generative-ui":
        return this.renderGenerativeUI(item);
      case "agent_responded":
        return nothing;
    }
  }

  private renderBubble(item: ConversationUser | ConversationAssistant) {
    const isUser = item.type === "user";
    const threshold = CpkThreadDetails.COLLAPSE_THRESHOLD;
    const expanded = this._expandedMessages.has(item.id);
    const tooLong = item.content.length > threshold;
    const shown =
      tooLong && !expanded
        ? item.content.slice(0, threshold) + "…"
        : item.content;
    return html`
      <div
        class="cpk-td__bubble ${
          isUser ? "cpk-td__bubble--user" : "cpk-td__bubble--assistant"
        }"
      >
        <div
          class="cpk-td__bubble-inner ${
            isUser
              ? "cpk-td__bubble-inner--user"
              : "cpk-td__bubble-inner--assistant"
          }"
        >
          ${shown}
          ${
            tooLong
              ? html`<span
                class="cpk-td__show-more"
                @click=${() => this.toggleMessageExpand(item.id)}
                >${expanded ? "Show less" : "Show more"}</span
              >`
              : nothing
          }
        </div>
      </div>
    `;
  }

  private renderToolBlock(item: ConversationToolCall) {
    const expanded = this._expandedTools.has(item.id);
    return html`
      <div class="cpk-td__tool-block">
        <div
          class="cpk-td__tool-header"
          @click=${() => this.toggleToolExpand(item.id)}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M1 9C1 9 2 7 5 7C8 7 9 9 9 9M5 1C5 1 7 2.5 7 4.5C7 6.5 5 7 5 7C5 7 3 6.5 3 4.5C3 2.5 5 1 5 1Z"
              stroke="#189370"
              stroke-width="1.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span class="cpk-td__tool-name">${item.toolName}</span>
          ${
            item.result
              ? html`
                  <span class="cpk-td__tool-status">DONE</span>
                `
              : html`
                  <span class="cpk-td__tool-status cpk-td__tool-status--pending">PENDING</span>
                `
          }
          <span class="cpk-td__tool-chevron">${expanded ? "▾" : "▸"}</span>
        </div>
        ${
          expanded
            ? html`
              <div class="cpk-td__tool-body">
                <div class="cpk-td__tool-section-label">Arguments</div>
                <pre class="cpk-td__tool-pre">
${unsafeHTML(highlightedJson(item.arguments))}</pre
                >
                ${
                  item.result
                    ? html`
                      <div
                        class="cpk-td__tool-section-label"
                        style="margin-top:8px"
                      >
                        Result
                      </div>
                      <pre class="cpk-td__tool-pre">
${unsafeHTML(highlightedJson(item.result))}</pre
                      >
                    `
                    : nothing
                }
              </div>
            `
            : nothing
        }
      </div>
    `;
  }

  private renderToolGroup(group: ToolCallGroup) {
    return html`
      <div class="cpk-td__tool-group">
        <div class="cpk-td__tool-group-header">
          ${group.items.length} tool call${group.items.length !== 1 ? "s" : ""}
        </div>
        ${group.items.map((tc: ConversationToolCall) => this.renderToolBlock(tc))}
      </div>
    `;
  }

  private renderGenerativeUI(item: ConversationGenerativeUIItem) {
    return html`
      <div class="cpk-td__genui">
        <div class="cpk-td__genui-badge">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
          Generative UI
        </div>
        ${
          item.html
            ? html`<div class="cpk-td__genui-card">
              ${unsafeHTML(item.html)}
            </div>`
            : html`<div class="cpk-td__genui-placeholder">
              ${item.activityType} — rendered in chat
            </div>`
        }
      </div>
    `;
  }

  private renderState() {
    if (this._loadingState) {
      return html`
        <div class="cpk-td__status">Loading state…</div>
      `;
    }
    if (this._stateError) {
      return html`<div class="cpk-td__status cpk-td__status--error">
        ${this._stateError}
      </div>`;
    }
    if (this._stateNotAvailable) {
      return html`
        <div class="cpk-td__empty-state">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          </svg>
          <span>State history not available</span>
          <span class="cpk-td__empty-hint"
            >This runtime doesn't yet expose per-thread agent state. Available when
            running against the in-memory runner.</span
          >
        </div>
      `;
    }
    if (!this.hasRenderableState()) {
      return html`
        <div class="cpk-td__empty-state">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          </svg>
          <span>No state captured</span>
          <span class="cpk-td__empty-hint"
            >Emitted live from STATE_SNAPSHOT events.</span
          >
        </div>
      `;
    }
    return html`<pre class="cpk-td__json-block">
${unsafeHTML(highlightedJson(this.activeState))}</pre
    >`;
  }

  private renderEvents() {
    if (this._loadingEvents) {
      return html`
        <div class="cpk-td__status">Loading events…</div>
      `;
    }
    if (this._eventsError) {
      return html`<div class="cpk-td__status cpk-td__status--error">
        ${this._eventsError}
      </div>`;
    }
    if (this._eventsNotAvailable) {
      return html`
        <div class="cpk-td__empty-state">
          <span>Event history not available</span>
          <span class="cpk-td__empty-hint"
            >This runtime doesn't yet expose per-thread AG-UI events. Available when
            running against the in-memory runner.</span
          >
        </div>
      `;
    }
    const events = this.activeEvents;
    if (events.length === 0) {
      return html`
        <div class="cpk-td__empty-state">
          <span>No events captured</span>
          <span class="cpk-td__empty-hint"
            >Events are recorded live. Run the agent to see them here.</span
          >
        </div>
      `;
    }
    return html`${events.map((event) => {
      const { bg, fg } = eventColors(event.type);
      return html`
        <div class="cpk-td__event">
          <div class="cpk-td__event-header" style="background:${bg}">
            <span class="cpk-td__event-type" style="color:${fg}"
              >${event.type}</span
            >
            <span class="cpk-td__event-time"
              >${formatTimestamp(event.timestamp)}</span
            >
          </div>
          <pre class="cpk-td__event-payload">
${unsafeHTML(highlightedJson(event.payload))}</pre
          >
        </div>
      `;
    })}`;
  }

  private renderPanelToggle() {
    return html`
      <button
        class="cpk-td__panel-toggle ${
          this._showDetailPanel ? "cpk-td__panel-toggle--active" : ""
        }"
        @click=${() => {
          this._showDetailPanel = !this._showDetailPanel;
        }}
        title="Toggle thread details"
        type="button"
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
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="15" y1="3" x2="15" y2="21" />
        </svg>
      </button>
    `;
  }

  private renderDetailPanel() {
    const counts = this.activityCounts;
    return html`
      <!-- Thread -->
      <div class="cpk-tdp__section-title">Thread</div>
      <div class="cpk-tdp__row">
        <span class="cpk-tdp__label">ID</span>
        <span class="cpk-tdp__value cpk-tdp__value--wrap"
          >${this.shortId(this.thread?.id)}</span
        >
      </div>
      <div class="cpk-tdp__row">
        <span class="cpk-tdp__label">Name</span>
        <span class="cpk-tdp__value">${this.thread?.name ?? "—"}</span>
      </div>
      <div class="cpk-tdp__row">
        <span class="cpk-tdp__label">Agent</span>
        <span class="cpk-tdp__value cpk-tdp__value--truncate"
          >${this.thread?.agentId ?? "—"}</span
        >
      </div>
      <div class="cpk-tdp__row">
        <span class="cpk-tdp__label">Created by</span>
        <span class="cpk-tdp__value cpk-tdp__value--truncate"
          >${this.thread?.createdById ?? "—"}</span
        >
      </div>

      <div class="cpk-tdp__divider"></div>

      <!-- Timestamps -->
      <div class="cpk-tdp__section-title">Timestamps</div>
      <div class="cpk-tdp__row">
        <span class="cpk-tdp__label">Created</span>
        <span class="cpk-tdp__value">${this.fmtTime(this.thread?.createdAt)}</span>
      </div>
      <div class="cpk-tdp__row">
        <span class="cpk-tdp__label">Updated</span>
        <span class="cpk-tdp__value">${this.fmtTime(this.thread?.updatedAt)}</span>
      </div>
      <div class="cpk-tdp__row">
        <span class="cpk-tdp__label">Duration</span>
        <span class="cpk-tdp__value">${this.duration}</span>
      </div>

      <div class="cpk-tdp__divider"></div>

      <!-- Activity -->
      <div class="cpk-tdp__section-title">Activity</div>
      <div class="cpk-tdp__row">
        <span class="cpk-tdp__label">Messages</span>
        <span class="cpk-tdp__value">${counts.messages}</span>
      </div>
      <div class="cpk-tdp__row">
        <span class="cpk-tdp__label">Tool calls</span>
        <span class="cpk-tdp__value">${counts.toolCalls}</span>
      </div>
      <div class="cpk-tdp__row">
        <span class="cpk-tdp__label">AG-UI events</span>
        <span class="cpk-tdp__value">${this.activeEvents.length}</span>
      </div>
    `;
  }
}

if (!customElements.get("cpk-thread-details")) {
  customElements.define("cpk-thread-details", CpkThreadDetails);
}
