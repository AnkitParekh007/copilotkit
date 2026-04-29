"""MS Agent Framework agent backing the Tool-Based Generative UI demo.

The frontend registers `generate_haiku` as a frontend tool via
`useFrontendTool`. CopilotKit's runtime forwards that frontend tool
definition to the agent at request time, so the agent can call it by name.

There are no backend tools here -- the agent's job is to recognize haiku
intent in the user's message and emit a tool call with structured haiku
data. The frontend then renders the result inline as a HaikuCard.
"""

from __future__ import annotations

from textwrap import dedent

from agent_framework import Agent, BaseChatClient
from agent_framework_ag_ui import AgentFrameworkAgent


SYSTEM_PROMPT = dedent(
    """
    You are a haiku poet assistant.

    When the user asks for a haiku, call `generate_haiku` with:
      - `japanese`: an array of 3 lines of haiku in Japanese
      - `english`: an array of 3 lines translated to English
      - `image_name`: one relevant image filename from the list
        provided in the tool definition
      - `gradient`: a CSS gradient string for the background

    Keep chat responses brief -- let the haiku do the talking.
    """
).strip()


def create_gen_ui_tool_based_agent(chat_client: BaseChatClient) -> AgentFrameworkAgent:
    """Instantiate the Tool-Based Generative UI demo agent."""
    base_agent = Agent(
        client=chat_client,
        name="gen_ui_tool_based_agent",
        instructions=SYSTEM_PROMPT,
        # The rendering tool (`generate_haiku`) is registered on the
        # frontend via `useFrontendTool`. The runtime forwards it as a
        # tool definition at request time.
        tools=[],
    )

    return AgentFrameworkAgent(
        agent=base_agent,
        name="CopilotKitMSAgentGenUiToolBasedAgent",
        description=(
            "Haiku poet assistant that turns haiku requests into "
            "frontend-rendered HaikuCards via tool calls."
        ),
        require_confirmation=False,
    )
