"""LlamaIndex agent backing the In-Chat HITL (useHumanInTheLoop) demo.

The `book_call` tool is defined on the frontend via `useHumanInTheLoop`,
so there is no backend tool here. The AG-UI workflow router picks up
frontend-provided tools from the CopilotKit request.

Mirrors `langgraph-python/src/agents/hitl_in_chat_agent.py`.
"""

from __future__ import annotations

import os

from llama_index.llms.openai import OpenAI
from llama_index.protocols.ag_ui.router import get_ag_ui_workflow_router

_openai_kwargs = {}
if os.environ.get("OPENAI_BASE_URL"):
    _openai_kwargs["api_base"] = os.environ["OPENAI_BASE_URL"]


hitl_in_chat_router = get_ag_ui_workflow_router(
    llm=OpenAI(model="gpt-4o-mini", **_openai_kwargs),
    frontend_tools=[],
    backend_tools=[],
    system_prompt=(
        "You help users book an onboarding call with the sales team. "
        "When they ask to book a call, call the frontend-provided "
        "`book_call` tool with a short topic and the user's name. "
        "Keep any chat reply to one short sentence."
    ),
    initial_state={},
)
