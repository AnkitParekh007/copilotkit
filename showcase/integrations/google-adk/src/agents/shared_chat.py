"""Shared LlmAgent factories used across multiple demos.

`build_simple_chat_agent` produces a plain Gemini chat agent with no backend
tools — appropriate for any demo whose only customisation is on the frontend
(prebuilt-sidebar, prebuilt-popup, chat-slots, chat-customization-css,
headless-simple, headless-complete, voice, frontend-tools, agentic-chat).

`build_thinking_chat_agent` uses Gemini 2.5 Flash with the thinking_config
exposed so reasoning is streamed back as `thought` parts; the v2 React core
renders these via CopilotChatReasoningMessage.

`get_model` returns a `Gemini` instance configured with the aimock proxy
endpoint when `GOOGLE_GEMINI_BASE_URL` is set, or the default model string
otherwise. All agent modules should call `get_model()` instead of
hard-coding `"gemini-2.5-flash"` so Railway deployments route through
aimock.
"""

from __future__ import annotations

import os
from typing import Union

from google.adk.agents import LlmAgent
from google.adk.models.google_llm import Gemini
from google.genai import types

DEFAULT_MODEL = "gemini-2.5-flash"


def get_model(model: str = DEFAULT_MODEL) -> Union[str, Gemini]:
    """Return a model suitable for LlmAgent's `model=` parameter.

    When `GOOGLE_GEMINI_BASE_URL` is set (Railway aimock proxy), returns a
    `Gemini` instance with its `base_url` pointed at the proxy. Otherwise
    returns the plain model string so the ADK resolves the default endpoint.
    """
    base_url = os.environ.get("GOOGLE_GEMINI_BASE_URL")
    if base_url:
        return Gemini(model=model, base_url=base_url)
    return model


def build_simple_chat_agent(
    *,
    name: str,
    instruction: str,
    model: str = DEFAULT_MODEL,
) -> LlmAgent:
    return LlmAgent(name=name, model=get_model(model), instruction=instruction, tools=[])


def build_thinking_chat_agent(
    *,
    name: str,
    instruction: str,
    model: str = DEFAULT_MODEL,
) -> LlmAgent:
    """LlmAgent with Gemini thinking enabled.

    `include_thoughts=True` makes Gemini emit `thought=True` parts alongside
    final answer parts; ADK forwards these through ag-ui as reasoning chunks
    so v2's CopilotChatReasoningMessage / useRenderReasoning can show them.
    `thinking_budget=-1` lets the model decide how much to think.
    """
    return LlmAgent(
        name=name,
        model=get_model(model),
        instruction=instruction,
        tools=[],
        generate_content_config=types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(
                include_thoughts=True,
                thinking_budget=-1,
            ),
        ),
    )
