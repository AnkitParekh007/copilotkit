"""Shared State (Read + Write) demo — Langroid.

Mirrors langgraph-python/src/agents/shared_state_read_write.py: full
bidirectional shared-state pattern between UI and agent.

- **UI -> agent (write)**: the UI owns a ``preferences`` object (name,
  tone, language, interests) and writes it into agent state via
  ``agent.setState(...)`` from the React side. Every turn we read those
  preferences out of ``RunAgentInput.state`` and prepend a system message
  describing them, so the LLM adapts its response.
- **agent -> UI (read)**: the agent calls a ``set_notes`` tool to replace
  the ``notes`` slice of shared state. The UI subscribes via ``useAgent``
  and re-renders.

Langroid does not provide a native shared-state channel — we implement
it directly on top of AG-UI's ``STATE_SNAPSHOT`` event by emitting a
fresh snapshot whenever the agent mutates state.

The handler is wired up by ``agent_server.py`` at ``POST
/shared-state-read-write``.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from typing import Annotated, Any, AsyncGenerator

from ag_ui.core import (
    EventType,
    RunAgentInput,
    RunErrorEvent,
    RunFinishedEvent,
    RunStartedEvent,
    StateSnapshotEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallStartEvent,
)
from fastapi import Request
from fastapi.responses import JSONResponse, StreamingResponse

import langroid as lr
import langroid.language_models as lm
from langroid.agent.tool_message import ToolMessage

logger = logging.getLogger(__name__)


# =====================================================================
# State shape (mirrors the UI's RWAgentState)
# =====================================================================
#
# {
#   "preferences": { "name", "tone", "language", "interests": [...] },
#   "notes":       [str, ...]
# }
#
# `preferences` is owned by the UI. The agent only READS it.
# `notes` is owned by the agent. The agent calls `set_notes` to replace
# the array; the UI re-renders from shared state.


_VALID_TONES = frozenset({"formal", "casual", "playful"})


def _normalize_state(raw: Any) -> dict[str, Any]:
    """Coerce the inbound RunAgentInput.state into our canonical dict.

    AG-UI types ``state`` as ``Any``, so a malformed frontend (or a
    test fixture) could ship anything from ``None`` to a list. Anything
    that isn't a dict is treated as "no state" — we don't try to recover
    structure from it.
    """
    if not isinstance(raw, dict):
        return {"preferences": {}, "notes": []}

    prefs = raw.get("preferences") if isinstance(raw.get("preferences"), dict) else {}
    notes_raw = raw.get("notes")
    notes = [n for n in notes_raw if isinstance(n, str)] if isinstance(notes_raw, list) else []
    return {"preferences": prefs, "notes": notes}


def build_preferences_system_message(prefs: dict[str, Any]) -> str | None:
    """Render the UI-supplied preferences into a system-message string.

    Returns ``None`` when no preference is set so the caller can skip
    injection cleanly. Tone is sanitized against a closed set; unknown
    values are silently dropped (matches the agent-config demo's
    posture: a frontend bug should not 500 a turn).
    """
    if not prefs:
        return None
    lines: list[str] = ["The user has shared these preferences with you:"]
    name = prefs.get("name")
    if isinstance(name, str) and name:
        lines.append(f"- Name: {name}")
    tone = prefs.get("tone")
    if isinstance(tone, str) and tone in _VALID_TONES:
        lines.append(f"- Preferred tone: {tone}")
    language = prefs.get("language")
    if isinstance(language, str) and language:
        lines.append(f"- Preferred language: {language}")
    interests = prefs.get("interests")
    if isinstance(interests, list):
        items = [i for i in interests if isinstance(i, str) and i]
        if items:
            lines.append(f"- Interests: {', '.join(items)}")
    if len(lines) == 1:
        # No usable keys — caller can skip injection.
        return None
    lines.append(
        "Tailor every response to these preferences. Address the user "
        "by name when appropriate."
    )
    return "\n".join(lines)


# =====================================================================
# `set_notes` tool — agent writes the notes slice of shared state.
# =====================================================================


class SetNotesTool(ToolMessage):
    request: str = "set_notes"
    purpose: str = (
        "Replace the notes array in shared state with the FULL updated list "
        "of short note strings (existing notes + any new ones). Use whenever "
        "the user asks you to remember something, or when you observe "
        "something worth surfacing in the UI's notes panel. Keep each note "
        "short (< 120 chars)."
    )
    notes: Annotated[
        list[str],
        "The complete list of notes after the update. Always include every "
        "previously-recorded note you want to keep — this REPLACES the array.",
    ]

    def handle(self) -> str:
        # The handler is invoked synchronously by langroid when the agent
        # decides to call the tool; we return a confirmation string so the
        # agent has something to incorporate into its next message. The
        # actual state mutation happens in the SSE adapter below — it
        # intercepts the tool call and emits a STATE_SNAPSHOT.
        return json.dumps({"ok": True, "count": len(self.notes)})


_SYSTEM_PROMPT = (
    "You are a helpful, concise assistant. The user's preferences are "
    "supplied via shared state and will be added as a system message at "
    "the start of every turn — always respect them.\n\n"
    "When the user asks you to remember something, or when you observe "
    "something worth surfacing in the UI's notes panel, call the "
    "`set_notes` tool with the FULL updated list of short note strings "
    "(existing notes + any new ones). NEVER pass a partial diff — always "
    "the complete list.\n\n"
    "Keep your prose replies brief — 1-2 sentences."
)


def _create_agent(
    system_message: str, *, with_set_notes: bool = True
) -> lr.ChatAgent:
    """Construct the langroid ChatAgent backing the demo.

    Mirrors ``agents.agent.create_agent``: bare model name, streaming on,
    only the demo-specific tool registered (``set_notes``).

    ``with_set_notes`` lets the post-tool follow-up turn use an agent
    that does NOT have ``set_notes`` enabled. Without this, the
    follow-up call could re-trigger ``set_notes`` and loop indefinitely
    (the agent keeps "writing notes" instead of producing the
    confirmation prose we asked for).
    """
    model = os.getenv("LANGROID_MODEL", "gpt-4.1")
    llm_config = lm.OpenAIGPTConfig(chat_model=model, stream=True)
    agent_config = lr.ChatAgentConfig(
        llm=llm_config,
        system_message=system_message,
    )
    agent = lr.ChatAgent(agent_config)
    if with_set_notes:
        agent.enable_message([SetNotesTool])
    return agent


# =====================================================================
# AG-UI SSE handler
# =====================================================================


def _sse_line(event: Any) -> str:
    if hasattr(event, "model_dump"):
        data = event.model_dump(by_alias=True, exclude_none=True)
    else:
        data = dict(event)
    return f"data: {json.dumps(data)}\n\n"


def _build_conversation(messages: Any) -> str:
    """Flatten AG-UI messages into a single langroid prompt.

    Mirrors ``agui_adapter.handle_run`` — silently skip any message
    whose role/content isn't a string so a malformed frontend can't
    inject ``"None: {...}"`` lines into the LLM context.
    """
    parts: list[str] = []
    if not messages:
        return ""
    for msg in messages:
        role = getattr(msg, "role", None) if hasattr(msg, "role") else (
            msg.get("role") if isinstance(msg, dict) else None
        )
        content = getattr(msg, "content", None) if hasattr(msg, "content") else (
            msg.get("content") if isinstance(msg, dict) else None
        )
        if isinstance(role, str) and isinstance(content, str):
            parts.append(f"{role}: {content}")
    return "\n".join(parts)


def _extract_set_notes_args(response: Any) -> list[str] | None:
    """Pull a ``set_notes`` tool call out of a langroid LLMResponse.

    Returns the new notes list when the agent emitted a usable
    ``set_notes`` call; returns ``None`` otherwise so the caller can
    fall through to plain-text streaming.
    """
    tool_calls = getattr(response, "oai_tool_calls", None) or []
    for tc in tool_calls:
        fn = getattr(tc, "function", None)
        name = getattr(fn, "name", None) if fn is not None else None
        if name != "set_notes":
            continue
        raw_args = getattr(fn, "arguments", None) if fn is not None else None
        args: Any = raw_args
        if isinstance(raw_args, (str, bytes, bytearray)):
            try:
                args = json.loads(raw_args)
            except (ValueError, TypeError):
                return None
        if isinstance(args, dict):
            notes = args.get("notes")
            if isinstance(notes, list):
                return [n for n in notes if isinstance(n, str)]
    return None


async def handle_run(request: Request) -> StreamingResponse:
    """Handle one AG-UI ``/shared-state-read-write`` request."""
    error_id = str(uuid.uuid4())
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError) as exc:
        logger.exception(
            "shared-state-read-write: failed to parse body (error_id=%s)",
            error_id,
        )
        return JSONResponse(
            {
                "error": "Invalid JSON body",
                "errorId": error_id,
                "class": exc.__class__.__name__,
            },
            status_code=400,
        )
    try:
        run_input = RunAgentInput(**body)
    except Exception as exc:  # noqa: BLE001 — pydantic.ValidationError is fine here
        logger.exception(
            "shared-state-read-write: invalid RunAgentInput (error_id=%s)",
            error_id,
        )
        return JSONResponse(
            {
                "error": "Invalid RunAgentInput payload",
                "errorId": error_id,
                "class": exc.__class__.__name__,
            },
            status_code=422,
        )

    state = _normalize_state(run_input.state)
    prefs_msg = build_preferences_system_message(state.get("preferences") or {})
    system_message = _SYSTEM_PROMPT
    if prefs_msg is not None:
        system_message = f"{_SYSTEM_PROMPT}\n\n{prefs_msg}"

    agent = _create_agent(system_message)
    user_message = _build_conversation(run_input.messages)
    thread_id = run_input.thread_id or str(uuid.uuid4())

    async def event_stream() -> AsyncGenerator[str, None]:
        run_id = str(uuid.uuid4())

        yield _sse_line(
            RunStartedEvent(
                type=EventType.RUN_STARTED,
                thread_id=thread_id,
                run_id=run_id,
            )
        )

        # Echo the inbound state back as the initial snapshot so the UI's
        # subscription always has a known-good baseline (and so a fresh
        # session sees the empty `notes` array even before the agent
        # writes one).
        yield _sse_line(
            StateSnapshotEvent(
                type=EventType.STATE_SNAPSHOT,
                snapshot=state,
            )
        )

        try:
            response = await agent.llm_response_async(user_message)
        except Exception as exc:  # noqa: BLE001 — surface as RunError + finish
            logger.exception(
                "shared-state-read-write: agent.llm_response_async failed"
            )
            # Emit a RunErrorEvent (the proper AG-UI error primitive) so
            # the UI can surface a real error state. Streaming the failure
            # as a TEXT_MESSAGE_CONTENT delta would render the raw JSON
            # inside a chat bubble, which is the wrong UX.
            yield _sse_line(
                RunErrorEvent(
                    type=EventType.RUN_ERROR,
                    message=f"Agent run failed: {exc.__class__.__name__}",
                )
            )
            yield _sse_line(
                RunFinishedEvent(
                    type=EventType.RUN_FINISHED,
                    thread_id=thread_id,
                    run_id=run_id,
                )
            )
            return

        if response is None:
            yield _sse_line(
                RunFinishedEvent(
                    type=EventType.RUN_FINISHED,
                    thread_id=thread_id,
                    run_id=run_id,
                )
            )
            return

        new_notes = _extract_set_notes_args(response)

        if new_notes is not None:
            # The agent decided to update the notes array. Apply, then
            # ack via tool-call events + a fresh STATE_SNAPSHOT so the
            # UI re-renders.
            state["notes"] = new_notes
            tool_call_id = str(uuid.uuid4())
            yield _sse_line(
                ToolCallStartEvent(
                    type=EventType.TOOL_CALL_START,
                    tool_call_id=tool_call_id,
                    tool_call_name="set_notes",
                )
            )
            yield _sse_line(
                ToolCallArgsEvent(
                    type=EventType.TOOL_CALL_ARGS,
                    tool_call_id=tool_call_id,
                    delta=json.dumps({"notes": new_notes}),
                )
            )
            yield _sse_line(
                ToolCallEndEvent(
                    type=EventType.TOOL_CALL_END,
                    tool_call_id=tool_call_id,
                )
            )
            yield _sse_line(
                StateSnapshotEvent(
                    type=EventType.STATE_SNAPSHOT,
                    snapshot=state,
                )
            )

            # Re-prompt the agent with the tool result so it produces a
            # short natural-language acknowledgement to the user. We use
            # a SEPARATE agent that does NOT have `set_notes` enabled —
            # otherwise the follow-up turn could call `set_notes` again,
            # infinite-loop on tool dispatch, or stack tool snapshots.
            follow_up_agent = _create_agent(
                system_message, with_set_notes=False
            )
            try:
                follow_up = await follow_up_agent.llm_response_async(
                    "The set_notes tool succeeded. Briefly confirm to the "
                    "user what you remembered, in 1 sentence."
                )
            except Exception:  # noqa: BLE001
                logger.exception(
                    "shared-state-read-write: follow-up llm_response_async failed"
                )
                follow_up = None
            if follow_up is not None:
                content = getattr(follow_up, "content", None) or ""
                if content:
                    msg_id = str(uuid.uuid4())
                    yield _sse_line(
                        TextMessageStartEvent(
                            type=EventType.TEXT_MESSAGE_START,
                            message_id=msg_id,
                        )
                    )
                    yield _sse_line(
                        TextMessageContentEvent(
                            type=EventType.TEXT_MESSAGE_CONTENT,
                            message_id=msg_id,
                            delta=content,
                        )
                    )
                    yield _sse_line(
                        TextMessageEndEvent(
                            type=EventType.TEXT_MESSAGE_END,
                            message_id=msg_id,
                        )
                    )
        else:
            content = getattr(response, "content", None) or ""
            if content:
                msg_id = str(uuid.uuid4())
                yield _sse_line(
                    TextMessageStartEvent(
                        type=EventType.TEXT_MESSAGE_START, message_id=msg_id
                    )
                )
                yield _sse_line(
                    TextMessageContentEvent(
                        type=EventType.TEXT_MESSAGE_CONTENT,
                        message_id=msg_id,
                        delta=content,
                    )
                )
                yield _sse_line(
                    TextMessageEndEvent(
                        type=EventType.TEXT_MESSAGE_END, message_id=msg_id
                    )
                )

        yield _sse_line(
            RunFinishedEvent(
                type=EventType.RUN_FINISHED,
                thread_id=thread_id,
                run_id=run_id,
            )
        )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
