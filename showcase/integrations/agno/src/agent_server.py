"""
Agent Server for Agno

Uses AgentOS with the AG-UI interface to serve multiple Agno agents.
The Next.js CopilotKit runtime proxies requests to each interface via AG-UI.

Interfaces:
    /agui                       → main agent (sales assistant, most demos)
    /reasoning/agui             → reasoning-capable agent
    /shared-state-rw/agui       → bidirectional shared-state agent
                                  (custom router emits STATE_SNAPSHOT)
    /subagents/agui             → supervisor with research/writing/critique
                                  sub-agents (custom router emits STATE_SNAPSHOT)
"""

import asyncio
import os
import uuid
from typing import Any, AsyncIterator, Optional, Union

import dotenv
from ag_ui.core import (
    BaseEvent,
    EventType,
    RunAgentInput,
    RunErrorEvent,
    RunFinishedEvent,
    RunStartedEvent,
    StateSnapshotEvent,
)
from ag_ui.encoder import EventEncoder
from agno.agent import Agent, RemoteAgent
from agno.os import AgentOS
from agno.os.interfaces.agui import AGUI
from agno.os.interfaces.agui.utils import (
    async_stream_agno_response_as_agui_events,
    extract_agui_user_input,
    validate_agui_state,
)
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from agents.main import agent as main_agent
from agents.reasoning_agent import agent as reasoning_agent
from agents.shared_state_read_write import agent as shared_state_rw_agent
from agents.subagents import agent as subagents_supervisor

dotenv.load_dotenv()


# ---------------------------------------------------------------------------
# State-aware AGUI handler
# ---------------------------------------------------------------------------
#
# Agno's stock AGUI router (`agno.os.interfaces.agui`) does NOT emit
# `StateSnapshotEvent` events back to the client. This means tools that
# mutate `session_state` are invisible to a UI subscribed via
# `useAgent({ updates: [OnStateChanged] })` — the round-trip is broken.
#
# For the shared-state-read-write and subagents demos we replicate the
# stock router's behavior but emit a `StateSnapshotEvent` carrying the
# final `session_state` immediately before the closing `RunFinishedEvent`.
# That gives the UI the canonical bidirectional contract its langgraph-
# python and google-adk siblings already have.


async def _run_agent_with_state_snapshot(
    agent: Union[Agent, RemoteAgent], run_input: RunAgentInput
) -> AsyncIterator[BaseEvent]:
    """Stream one agent run, emitting STATE_SNAPSHOT before RUN_FINISHED.

    Mirrors `agno.os.interfaces.agui.router.run_agent` but inserts a
    `StateSnapshotEvent` after the inner Agno stream completes. We also
    suppress the inner stream's `RunFinishedEvent` and emit our own at
    the very end so the snapshot lands inside the run window.
    """
    run_id = run_input.run_id or str(uuid.uuid4())
    thread_id = run_input.thread_id

    try:
        user_input = extract_agui_user_input(run_input.messages or [])

        yield RunStartedEvent(
            type=EventType.RUN_STARTED, thread_id=thread_id, run_id=run_id
        )

        user_id: Optional[str] = None
        if run_input.forwarded_props and isinstance(run_input.forwarded_props, dict):
            user_id = run_input.forwarded_props.get("user_id")

        session_state = validate_agui_state(run_input.state, thread_id) or {}

        response_stream = agent.arun(  # type: ignore[attr-defined]
            input=user_input,
            session_id=thread_id,
            stream=True,
            stream_events=True,
            user_id=user_id,
            session_state=session_state,
            run_id=run_id,
        )

        async for event in async_stream_agno_response_as_agui_events(
            response_stream=response_stream,  # type: ignore[arg-type]
            thread_id=thread_id,
            run_id=run_id,
        ):
            # Suppress the inner RUN_STARTED / RUN_FINISHED — we already
            # emitted RUN_STARTED above and will emit RUN_FINISHED after
            # the snapshot. Yield everything else (text, tool calls,
            # reasoning, errors) verbatim.
            if event.type in (EventType.RUN_STARTED, EventType.RUN_FINISHED):
                continue
            yield event

        # Snapshot the final session_state from the agent's session DB.
        # `agent.arun` mutates `session_state` in-place when tools call
        # `run_context.session_state[...] = ...`, but we read back via
        # the agent's own getter so we pick up any merged DB state too.
        final_state: Any = session_state
        try:
            getter = getattr(agent, "aget_session_state", None)
            if getter is not None:
                final_state = await getter(session_id=thread_id)  # type: ignore[misc]
            else:
                sync_getter = getattr(agent, "get_session_state", None)
                if sync_getter is not None:
                    final_state = sync_getter(session_id=thread_id)
        except Exception:  # noqa: BLE001 — fall back to in-memory snapshot
            final_state = session_state

        if not isinstance(final_state, dict):
            final_state = session_state if isinstance(session_state, dict) else {}

        yield StateSnapshotEvent(
            type=EventType.STATE_SNAPSHOT, snapshot=final_state
        )
        yield RunFinishedEvent(
            type=EventType.RUN_FINISHED, thread_id=thread_id, run_id=run_id
        )

    except asyncio.CancelledError:  # noqa: TRY302 — propagate cancellation
        raise
    except Exception as exc:  # noqa: BLE001
        yield RunErrorEvent(type=EventType.RUN_ERROR, message=str(exc))


def _attach_state_aware_route(
    app: FastAPI, agent: Agent, prefix: str
) -> None:
    """Mount a single state-aware AGUI POST endpoint at `<prefix>/agui`."""
    encoder = EventEncoder()
    route = f"{prefix.rstrip('/')}/agui"

    async def _handler(run_input: RunAgentInput) -> StreamingResponse:
        async def _gen():
            async for event in _run_agent_with_state_snapshot(agent, run_input):
                yield encoder.encode(event)

        return StreamingResponse(
            _gen(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
                "Access-Control-Allow-Headers": "*",
            },
        )

    app.post(route, name=f"agui_state_aware_{prefix.strip('/')}")(_handler)


# ---------------------------------------------------------------------------
# AgentOS bootstrap
# ---------------------------------------------------------------------------

agent_os = AgentOS(
    agents=[
        main_agent,
        reasoning_agent,
        shared_state_rw_agent,
        subagents_supervisor,
    ],
    interfaces=[
        AGUI(agent=main_agent),  # default prefix "" -> /agui
        AGUI(agent=reasoning_agent, prefix="/reasoning"),  # -> /reasoning/agui
    ],
)
app = agent_os.get_app()

# State-aware routes (bidirectional shared state via StateSnapshotEvent).
# Mounted directly on the AgentOS FastAPI app so they share routing and
# CORS with the stock AGUI interfaces above.
_attach_state_aware_route(app, shared_state_rw_agent, "/shared-state-rw")
_attach_state_aware_route(app, subagents_supervisor, "/subagents")


# Serve /health via middleware so it short-circuits BEFORE route resolution.
class HealthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.url.path == "/health" and request.method == "GET":
            return JSONResponse({"status": "ok"})
        return await call_next(request)


app.add_middleware(HealthMiddleware)


def main():
    """Run the uvicorn server."""
    port = int(os.getenv("PORT", "8000"))
    agent_os.serve(app="agent_server:app", host="0.0.0.0", port=port, reload=True)


if __name__ == "__main__":
    main()
