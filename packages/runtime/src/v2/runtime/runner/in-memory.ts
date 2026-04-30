import type {
  AgentRunnerConnectRequest,
  AgentRunnerIsRunningRequest,
  AgentRunnerRunRequest,
} from "./agent-runner";
import { AgentRunner, type AgentRunnerStopRequest } from "./agent-runner";
import type { Observable } from "rxjs";
import { ReplaySubject } from "rxjs";
import type {
  AbstractAgent,
  BaseEvent,
  Message,
  RunStartedEvent,
} from "@ag-ui/client";
import { EventType, compactEvents } from "@ag-ui/client";
import { finalizeRunEvents, logger } from "@copilotkit/shared";

interface HistoricRun {
  threadId: string;
  runId: string;
  /** ID of the agent that executed this run. */
  agentId: string;
  parentRunId: string | null;
  events: BaseEvent[];
  /**
   * Snapshot of all messages (input + generated) at the end of this run.
   * Used by the local thread-messages fallback endpoint.
   */
  messages: Message[];
  createdAt: number;
}

/**
 * Lightweight thread summary returned by {@link InMemoryAgentRunner.listThreads}.
 * Shape matches the Intelligence platform's ThreadRecord so the same HTTP
 * response envelope can be used for both backends.
 */
export interface InMemoryThread {
  id: string;
  name: string | null;
  agentId: string;
  organizationId: ""; // always empty in in-memory mode
  createdById: ""; // always empty in in-memory mode
  archived: false; // always false in in-memory mode
  createdAt: string;
  updatedAt: string;
}

class InMemoryEventStore {
  constructor(public threadId: string) {}

  /** The subject that current consumers subscribe to. */
  subject: ReplaySubject<BaseEvent> | null = null;

  /** True while a run is actively producing events. */
  isRunning = false;

  /** Current run ID */
  currentRunId: string | null = null;

  /** Historic completed runs */
  historicRuns: HistoricRun[] = [];

  /** Currently running agent instance (if any). */
  agent: AbstractAgent | null = null;

  /** Subject returned from run() while the run is active. */
  runSubject: ReplaySubject<BaseEvent> | null = null;

  /** True once stop() has been requested but the run has not yet finalized. */
  stopRequested = false;

  /** Reference to the events emitted in the current run. */
  currentEvents: BaseEvent[] | null = null;
}

const GLOBAL_STORE = new Map<string, InMemoryEventStore>();

export class InMemoryAgentRunner extends AgentRunner {
  run(request: AgentRunnerRunRequest): Observable<BaseEvent> {
    let existingStore = GLOBAL_STORE.get(request.threadId);
    if (!existingStore) {
      existingStore = new InMemoryEventStore(request.threadId);
      GLOBAL_STORE.set(request.threadId, existingStore);
    }
    const store = existingStore; // Now store is const and non-null

    // Guard against starting a new run before the previous one has fully
    // drained. `isRunning` alone is not enough: `stop()` does not mutate
    // store flags synchronously (it can't, without racing the in-flight
    // runAgent's async cleanup), so a `stop()` followed immediately by a
    // `run()` would otherwise pass an `isRunning === false` check while
    // the previous runAgent is still finalizing — and its post-await
    // cleanup would then null out the new run's subject/agent fields.
    // `runSubject === null` is the post-cleanup signal: the previous
    // runAgent has fully run its finally-equivalent block.
    if (store.isRunning || store.runSubject !== null) {
      throw new Error("Thread already running");
    }
    store.isRunning = true;
    store.currentRunId = request.input.runId;
    store.agent = request.agent;
    store.stopRequested = false;

    // Track seen message IDs and current run events for this run
    const seenMessageIds = new Set<string>();
    const currentRunEvents: BaseEvent[] = [];
    store.currentEvents = currentRunEvents;

    // Get all previously seen message IDs from historic runs
    const historicMessageIds = new Set<string>();
    for (const run of store.historicRuns) {
      for (const event of run.events) {
        if ("messageId" in event && typeof event.messageId === "string") {
          historicMessageIds.add(event.messageId);
        }
        if (event.type === EventType.RUN_STARTED) {
          const runStarted = event as RunStartedEvent;
          const messages = runStarted.input?.messages ?? [];
          for (const message of messages) {
            historicMessageIds.add(message.id);
          }
        }
      }
    }

    const nextSubject = new ReplaySubject<BaseEvent>(Infinity);
    const prevSubject = store.subject;

    // Update the store's subject immediately
    store.subject = nextSubject;

    // Create a subject for run() return value
    const runSubject = new ReplaySubject<BaseEvent>(Infinity);
    store.runSubject = runSubject;

    // Identity-checked cleanup. Only clears store fields that still point
    // at THIS run's owned objects, so a `stop()` + `run()` race that swaps
    // in a fresh run mid-await cannot have its fields wiped by the
    // previous run's finalization.
    const cleanupOwnedFields = () => {
      if (store.runSubject === runSubject) store.runSubject = null;
      if (store.subject === nextSubject) store.subject = null;
      if (store.currentEvents === currentRunEvents) store.currentEvents = null;
      if (store.agent === request.agent) store.agent = null;
      if (store.currentRunId === request.input.runId) {
        store.currentRunId = null;
      }
      // Only flip the run-state booleans if no replacement run has taken
      // over (signalled by the runSubject pointer being equal to ours).
      // We detect that here by checking the same field — if it was equal,
      // it was just nulled above, so the previous-line `=== runSubject`
      // already implies this run still owned the slot.
      if (store.runSubject === null && store.subject === null) {
        store.isRunning = false;
        store.stopRequested = false;
      }
    };

    // Helper function to run the agent and handle errors
    const runAgent = async () => {
      // Get parent run ID for chaining
      const lastRun = store.historicRuns[store.historicRuns.length - 1];
      const parentRunId = lastRun?.runId ?? null;

      try {
        await request.agent.runAgent(request.input, {
          onEvent: ({ event }) => {
            let processedEvent: BaseEvent = event;
            if (event.type === EventType.RUN_STARTED) {
              const runStartedEvent = event as RunStartedEvent;
              if (!runStartedEvent.input) {
                const sanitizedMessages = request.input.messages
                  ? request.input.messages.filter(
                      (message) => !historicMessageIds.has(message.id),
                    )
                  : undefined;
                const updatedInput = {
                  ...request.input,
                  ...(sanitizedMessages !== undefined
                    ? { messages: sanitizedMessages }
                    : {}),
                };
                processedEvent = {
                  ...runStartedEvent,
                  input: updatedInput,
                } as RunStartedEvent;
              }
            }

            runSubject.next(processedEvent); // For run() return - only agent events
            nextSubject.next(processedEvent); // For connect() / store - all events
            currentRunEvents.push(processedEvent); // Accumulate for storage
          },
          onNewMessage: ({ message }) => {
            // Called for each new message
            if (!seenMessageIds.has(message.id)) {
              seenMessageIds.add(message.id);
            }
          },
          onRunStartedEvent: () => {
            // Mark any messages from the input as seen so they aren't emitted twice
            if (request.input.messages) {
              for (const message of request.input.messages) {
                if (!seenMessageIds.has(message.id)) {
                  seenMessageIds.add(message.id);
                }
              }
            }
          },
        });

        const appendedEvents = finalizeRunEvents(currentRunEvents, {
          stopRequested: store.stopRequested,
        });
        for (const event of appendedEvents) {
          runSubject.next(event);
          nextSubject.next(event);
        }

        // Store the completed run in memory with ONLY its events. We use
        // `request.input.runId` rather than `store.currentRunId` so that
        // any future race (a new run swapping in mid-await despite the
        // guard) cannot cause us to attribute this run's events to the
        // new run's id.
        if (request.input.runId) {
          // Compact the events before storing (like SQLite does)
          const compactedEvents = compactEvents(currentRunEvents);

          store.historicRuns.push({
            threadId: request.threadId,
            runId: request.input.runId,
            agentId: request.agent.agentId ?? "default",
            parentRunId,
            events: compactedEvents,
            // Snapshot all messages (input + generated) for the thread-messages endpoint
            messages: Array.isArray(request.agent.messages)
              ? [...request.agent.messages]
              : [],
            createdAt: Date.now(),
          });
        }

        // Complete the run (identity-checked so a concurrent `stop()` +
        // `run()` swap can't cause us to wipe the new run's fields).
        cleanupOwnedFields();
        runSubject.complete();
        nextSubject.complete();
      } catch (error) {
        const interruptionMessage =
          error instanceof Error ? error.message : String(error);
        const appendedEvents = finalizeRunEvents(currentRunEvents, {
          stopRequested: store.stopRequested,
          interruptionMessage,
        });
        for (const event of appendedEvents) {
          runSubject.next(event);
          nextSubject.next(event);
        }

        // Store the run even if it failed (partial events). Use
        // `request.input.runId` so a swapped-in concurrent run cannot
        // alter the runId we attribute these events to.
        if (request.input.runId && currentRunEvents.length > 0) {
          // Compact the events before storing (like SQLite does)
          const compactedEvents = compactEvents(currentRunEvents);
          store.historicRuns.push({
            threadId: request.threadId,
            runId: request.input.runId,
            agentId: request.agent.agentId ?? "default",
            parentRunId,
            events: compactedEvents,
            messages: Array.isArray(request.agent.messages)
              ? [...request.agent.messages]
              : [],
            createdAt: Date.now(),
          });
        }

        // Complete the run (identity-checked, see success path).
        cleanupOwnedFields();
        runSubject.complete();
        nextSubject.complete();
      }
    };

    // Bridge previous events if they exist
    if (prevSubject) {
      prevSubject.subscribe({
        next: (e) => nextSubject.next(e),
        error: (err) => nextSubject.error(err),
        complete: () => {
          // Don't complete nextSubject here - it needs to stay open for new events
        },
      });
    }

    // Start the agent execution immediately (not lazily). `runAgent` is an
    // async function whose synchronous setup/teardown lives outside the
    // inner try/catch, so a throw from those branches would otherwise
    // become an unhandled promise rejection. The `.catch` here is the
    // last-resort backstop — the inner try/catch already handles all
    // expected error paths.
    runAgent().catch((err) => {
      logger.error(
        "[InMemoryAgentRunner] runAgent failed",
        { threadId: request.threadId },
        err,
      );
    });

    // Return the run subject (only agent events, no injected messages)
    return runSubject.asObservable();
  }

  connect(request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    const store = GLOBAL_STORE.get(request.threadId);
    const connectionSubject = new ReplaySubject<BaseEvent>(Infinity);

    if (!store) {
      // No store means no events
      connectionSubject.complete();
      return connectionSubject.asObservable();
    }

    // Collect all historic events from memory
    const allHistoricEvents: BaseEvent[] = [];
    for (const run of store.historicRuns) {
      allHistoricEvents.push(...run.events);
    }

    // Apply compaction to all historic events together (like SQLite)
    const compactedEvents = compactEvents(allHistoricEvents);

    // Emit compacted events and track message IDs
    const emittedMessageIds = new Set<string>();
    for (const event of compactedEvents) {
      connectionSubject.next(event);
      if ("messageId" in event && typeof event.messageId === "string") {
        emittedMessageIds.add(event.messageId);
      }
    }

    // Bridge active run to connection if exists
    if (store.subject && (store.isRunning || store.stopRequested)) {
      store.subject.subscribe({
        next: (event) => {
          // Skip message events that we've already emitted from historic
          if (
            "messageId" in event &&
            typeof event.messageId === "string" &&
            emittedMessageIds.has(event.messageId)
          ) {
            return;
          }
          connectionSubject.next(event);
        },
        complete: () => connectionSubject.complete(),
        error: (err) => connectionSubject.error(err),
      });
    } else {
      // No active run, complete after historic events
      connectionSubject.complete();
    }

    return connectionSubject.asObservable();
  }

  isRunning(request: AgentRunnerIsRunningRequest): Promise<boolean> {
    const store = GLOBAL_STORE.get(request.threadId);
    return Promise.resolve(store?.isRunning ?? false);
  }

  async stop(
    request: AgentRunnerStopRequest,
  ): Promise<boolean | undefined> {
    const store = GLOBAL_STORE.get(request.threadId);
    if (!store) return false;

    // Idempotent on repeat calls. Check `stopRequested` BEFORE any other
    // gate so a second `stop()` for the same in-flight run is a clean
    // no-op (returns false) rather than re-entering the abort path.
    if (store.stopRequested) return false;
    if (!store.isRunning) return false;

    const agent = store.agent;
    if (!agent) return false;

    // Mark stop as requested but do NOT mutate `isRunning` synchronously.
    // Doing so would let a follow-up `run()` for the same threadId pass
    // its `!isRunning` guard while the previous runAgent is still
    // finalizing — and the previous runAgent's post-await cleanup would
    // then null out the fresh run's subject/agent fields. The run-state
    // booleans are owned by `runAgent`'s identity-checked cleanup; this
    // function only signals intent.
    store.stopRequested = true;

    try {
      await agent.abortRun();
      return true;
    } catch (error) {
      // Async rejection from `abortRun` would otherwise be lost. Surface
      // it as an error log scoped to this thread, then unwind the
      // stop-request flag so a subsequent `stop()` can retry.
      logger.error(
        "[InMemoryAgentRunner] Failed to abort agent run",
        { threadId: request.threadId },
        error,
      );
      store.stopRequested = false;
      return false;
    }
  }

  /**
   * Returns a summary of every thread that has been run through this runner.
   *
   * This powers the local-dev fallback for `GET /threads` when the Intelligence
   * platform is not configured. Each entry mirrors the shape of a platform
   * `ThreadRecord` so the HTTP handler can use the same response envelope.
   */
  listThreads(): InMemoryThread[] {
    const threads: InMemoryThread[] = [];
    for (const [threadId, store] of GLOBAL_STORE) {
      if (store.historicRuns.length === 0) continue;
      const firstRun = store.historicRuns[0]!;
      const lastRun = store.historicRuns[store.historicRuns.length - 1]!;
      threads.push({
        id: threadId,
        name: null,
        agentId: lastRun.agentId,
        organizationId: "",
        createdById: "",
        archived: false,
        createdAt: new Date(firstRun.createdAt).toISOString(),
        updatedAt: new Date(lastRun.createdAt).toISOString(),
      });
    }
    // Most recently updated first
    return threads.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }

  /**
   * Returns all messages for a thread, using the snapshot captured at the end
   * of the most recent run.
   *
   * This powers the local-dev fallback for `GET /threads/:threadId/messages`
   * when the Intelligence platform is not configured. The returned `Message[]`
   * objects come directly from the ag-ui agent, so their shape is compatible
   * with the Intelligence platform's `ThreadMessage` type.
   */
  getThreadMessages(threadId: string): Message[] {
    const store = GLOBAL_STORE.get(threadId);
    if (!store || store.historicRuns.length === 0) return [];
    // The last run's snapshot has the complete conversation history.
    // Return a shallow copy so callers cannot mutate internal state.
    return [...store.historicRuns[store.historicRuns.length - 1]!.messages];
  }

  /**
   * Returns all AG-UI events for a thread, compacted across historic runs.
   *
   * Powers the local-dev fallback for `GET /threads/:threadId/events` when the
   * Intelligence platform is not configured. The compaction logic matches the
   * SQLite runner and the connection-replay path in {@link connect}, so the
   * stream a late-joining inspector sees matches what this method returns.
   *
   * Each `HistoricRun.events` array is already individually compacted at run
   * end (see the `runAgent` success/error paths). The second pass here is
   * deliberate: per-run compaction cannot consolidate across run boundaries
   * (e.g. multiple STATE_SNAPSHOT events from different runs), and this is
   * what the connection-replay path in {@link connect} also does — keeping
   * the read shape identical for live and post-hoc consumers. `compactEvents`
   * is idempotent for already-compacted single-run inputs, so this does not
   * lose information. `compactEvents` returns a fresh array, so callers
   * cannot mutate internal state via this method.
   */
  getThreadEvents(threadId: string): BaseEvent[] {
    const store = GLOBAL_STORE.get(threadId);
    if (!store || store.historicRuns.length === 0) return [];
    const all: BaseEvent[] = [];
    for (const run of store.historicRuns) all.push(...run.events);
    return [...compactEvents(all)];
  }

  /**
   * Returns the agent state snapshot for a thread.
   *
   * Derived from the last `STATE_SNAPSHOT` in the compacted event stream.
   * Note: AG-UI's `compactEvents` helper consolidates streaming text/tool
   * deltas but does NOT fold STATE_DELTA events into a synthetic
   * STATE_SNAPSHOT. So this method returns state only for runs that
   * actually emit STATE_SNAPSHOT. Threads whose only state-change vehicle
   * is STATE_DELTA will return `null` here.
   *
   * Returns `null` when the thread has never emitted a STATE_SNAPSHOT.
   */
  getThreadState(threadId: string): Record<string, unknown> | null {
    const events = this.getThreadEvents(threadId);
    // Walk backwards — the last snapshot wins.
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]!;
      if (event.type === EventType.STATE_SNAPSHOT) {
        const snapshot = (event as { snapshot?: unknown }).snapshot;
        // Reject anything that is not a plain object: null, primitives, and
        // arrays all collapse to null. The HTTP contract expects a state
        // map keyed by string, so a runtime that emitted a malformed
        // STATE_SNAPSHOT must not poison the response.
        if (
          snapshot !== null &&
          typeof snapshot === "object" &&
          !Array.isArray(snapshot)
        ) {
          return snapshot as Record<string, unknown>;
        }
        return null;
      }
    }
    return null;
  }

  /**
   * Clears all in-memory thread history.
   *
   * Called by the inspector when a new browser session starts (i.e. on page
   * load). This gives local development a "fresh slate" on every page refresh
   * without requiring a server restart. It is intentionally not exposed for
   * the Intelligence platform path — there, thread history is stored in a
   * real database and should never be wiped this way.
   */
  clearThreads(): void {
    GLOBAL_STORE.clear();
  }
}
