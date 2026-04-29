"""MS Agent Framework agent backing the Shared State (Read + Write) demo.

Mirrors langgraph-python/src/agents/shared_state_read_write.py and
google-adk/src/agents/shared_state_read_write_agent.py:

- UI -> agent (write): The UI owns a `preferences` object and writes it
  into agent state via `agent.setState({preferences: ...})`. The
  AG-UI runtime injects the current shared state (including
  `preferences`) as a system context message before each turn, so the
  LLM adapts.

- agent -> UI (read): The agent calls `set_notes` to update a `notes`
  list in shared state. The tool returns `state_update(...)` so the
  AG-UI emitter pushes a deterministic StateSnapshotEvent after the
  tool call. The UI reflects every update in real time via `useAgent`.
"""

from __future__ import annotations

from textwrap import dedent
from typing import Annotated

from agent_framework import Agent, BaseChatClient, Content, tool
from agent_framework_ag_ui import AgentFrameworkAgent, state_update
from pydantic import Field


# ---------------------------------------------------------------------------
# State schema
#
# Declared so the AG-UI runtime auto-injects `current_state` as a system
# context message every turn. That is how UI-written `preferences`
# become visible to the LLM without us writing any custom middleware.
# ---------------------------------------------------------------------------

STATE_SCHEMA: dict[str, object] = {
    "preferences": {
        "type": "object",
        "description": (
            "User-supplied preferences. Adapt every response to match. "
            "Address the user by name when appropriate."
        ),
        "properties": {
            "name": {"type": "string"},
            "tone": {"type": "string"},
            "language": {"type": "string"},
            "interests": {"type": "array", "items": {"type": "string"}},
        },
    },
    "notes": {
        "type": "array",
        "items": {"type": "string"},
        "description": (
            "Short notes the agent has chosen to remember about the "
            "user. Updated by calling `set_notes` with the FULL list."
        ),
    },
}


# ---------------------------------------------------------------------------
# Tool: set_notes — agent -> UI write path
#
# Returns a `state_update(...)` so the AG-UI emitter merges the new
# `notes` into shared state and emits a deterministic StateSnapshotEvent
# right after the tool result. This is the canonical MS Agent Framework
# tool-driven shared-state pattern (see agent_framework_ag_ui._state).
# ---------------------------------------------------------------------------


@tool(
    name="set_notes",
    description=(
        "Replace the notes array in shared state with the full updated "
        "list. Always pass the FULL list of short note strings "
        "(existing notes + any new ones), not a diff. Keep each note "
        "short (< 120 chars)."
    ),
)
def set_notes(
    notes: Annotated[
        list[str],
        Field(
            description=(
                "The complete updated list of short note strings. "
                "Must include every existing note you want to keep "
                "plus any new ones."
            )
        ),
    ],
) -> Content:
    """Push the agent-authored notes into AG-UI shared state."""
    return state_update(
        text=f"Notes updated. Tracking {len(notes)} note(s).",
        state={"notes": list(notes)},
    )


# ---------------------------------------------------------------------------
# Agent factory
# ---------------------------------------------------------------------------


SYSTEM_PROMPT = dedent(
    """
    You are a helpful, concise assistant.

    The user's preferences are supplied via shared state and will be
    added as a system context message at the start of every turn.
    Always respect them:
      - address the user by their `name` when present,
      - match the requested `tone` (formal / casual / playful),
      - reply in the user's preferred `language`,
      - take their `interests` into account when making suggestions.

    Notes — agent-authored memory surfaced to the UI:
      - When the user asks you to remember something, OR you observe
        something worth surfacing in the UI's notes panel, call
        `set_notes` with the FULL updated list of short note strings
        (existing notes from shared state + any new ones).
      - Never send partial updates -- the call replaces the entire
        list. Read the current `notes` value out of the injected
        shared-state context and re-send it plus your additions.
      - Keep each note short (under 120 characters).

    After executing tools, reply with one short conversational
    sentence so the message persists in the chat surface.
    """
).strip()


def create_shared_state_read_write_agent(
    chat_client: BaseChatClient,
) -> AgentFrameworkAgent:
    """Instantiate the Shared State (Read + Write) demo agent."""
    base_agent = Agent(
        client=chat_client,
        name="shared_state_read_write_agent",
        instructions=SYSTEM_PROMPT,
        tools=[set_notes],
    )

    return AgentFrameworkAgent(
        agent=base_agent,
        name="CopilotKitMSAgentSharedStateReadWriteAgent",
        description=(
            "Bidirectional shared-state demo. Reads UI-written "
            "`preferences` from shared state every turn and writes "
            "agent-authored `notes` back via the `set_notes` tool."
        ),
        state_schema=STATE_SCHEMA,
        require_confirmation=False,
    )
