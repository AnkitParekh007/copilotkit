"""
Agent Server for AG2

FastAPI server that hosts the AG2 agent backends.
The Next.js CopilotKit runtime proxies requests here via AG-UI protocol.

Most demos share a single ConversableAgent at the root path. Demos that
require dedicated state mechanics or multi-agent topologies are mounted
as their own sub-apps at distinct paths so each demo gets its own
ContextVariables-backed state slot.
"""

import os
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from dotenv import load_dotenv

from agents.agent import stream as default_stream
from agents.shared_state_read_write import (
    shared_state_read_write_app,
)
from agents.subagents import subagents_app

load_dotenv()

app = FastAPI(title="AG2 Agent Server")


# Serve /health via middleware so it short-circuits BEFORE route resolution.
# A plain `@app.get("/health")` decorator is shadowed by the subsequent
# `app.mount("/", ...)` call: Starlette's Mount at "/" matches every path
# (including /health) and the decorated route never fires. Middleware runs
# above the routing layer, so the health endpoint stays reachable regardless
# of what the framework-specific AG-UI adapter mounts at root.
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


# Mount per-demo sub-apps FIRST. Starlette's router resolves mounts in
# registration order; the catch-all `/` mount below shadows everything
# under it, so the named mounts must come first.
app.mount("/shared-state-read-write", shared_state_read_write_app)
app.mount("/subagents", subagents_app)


# Mount the default AG2 AG-UI endpoint at the root.
# `app.mount("/", ...)` is a catch-all Mount that shadows any later route
# decorators, which is why /health is served by HealthMiddleware above
# rather than a `@app.get("/health")` handler registered here.
app.mount("/", default_stream.build_asgi())


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
