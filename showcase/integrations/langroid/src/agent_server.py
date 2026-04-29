"""
Agent Server for Langroid

FastAPI server that hosts the Langroid agent backend.
The Next.js CopilotKit runtime proxies requests here via AG-UI protocol.

Langroid does not have a native AG-UI adapter, so we implement a custom
SSE endpoint that translates between Langroid's ChatAgent and the AG-UI
event stream.
"""

import os
import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from dotenv import load_dotenv

from agents.agui_adapter import handle_run
from agents.shared_state_read_write import (
    handle_run as handle_shared_state_read_write,
)
from agents.subagents import handle_run as handle_subagents

load_dotenv()

app = FastAPI(title="Langroid Agent Server")


# Serve /health via middleware so it short-circuits BEFORE route resolution.
# Applied uniformly across every showcase FastAPI agent server so /health
# remains reachable even if future changes introduce a catch-all mount at "/".
class HealthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.url.path == "/health" and request.method == "GET":
            return JSONResponse({"status": "ok"})
        return await call_next(request)


app.add_middleware(HealthMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/")
async def run_agent(request: Request):
    """AG-UI /run endpoint — streams SSE events."""
    return await handle_run(request)


# Per-demo endpoints for cells that need state-aware behavior the unified
# agent does not provide. Each handler implements its own AG-UI SSE
# pipeline (RUN_STARTED / STATE_SNAPSHOT / TEXT_* / TOOL_CALL_* / RUN_FINISHED)
# so it can read RunAgentInput.state and emit fresh snapshots when its
# tools mutate shared state. The Next.js runtime routes the demo's
# CopilotKit calls to /api/copilotkit-<slug>, which proxies to these
# endpoints via per-demo HttpAgent instances.


@app.post("/shared-state-read-write")
async def run_shared_state_read_write(request: Request):
    """Shared State (Read + Write) demo endpoint.

    The UI writes ``preferences`` into agent state via ``agent.setState``;
    the handler injects them into the system prompt every turn. The agent
    writes ``notes`` via the ``set_notes`` tool; the handler emits a
    STATE_SNAPSHOT so the UI re-renders.
    """
    return await handle_shared_state_read_write(request)


@app.post("/subagents")
async def run_subagents(request: Request):
    """Sub-Agents demo endpoint.

    A supervisor LLM delegates to research / writing / critique sub-agents
    via tool calls. Each delegation appends a Delegation entry to
    ``state["delegations"]`` (running -> completed/failed) and emits a
    STATE_SNAPSHOT so the UI's live delegation log updates.
    """
    return await handle_subagents(request)


def main():
    """Run the uvicorn server."""
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(
        "agent_server:app",
        host="0.0.0.0",
        port=port,
        reload=True,
    )


if __name__ == "__main__":
    main()
