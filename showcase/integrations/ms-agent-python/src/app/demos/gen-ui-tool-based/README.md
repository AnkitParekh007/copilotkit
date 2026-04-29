# Tool-Based Generative UI

## What This Demo Shows

Agent uses tools to trigger UI generation — a frontend-defined haiku tool
is exposed via `useFrontendTool` and the backend agent calls it by name.

## How to Interact

Try asking your Copilot to:

- "Write me a haiku about nature."
- "Create a haiku about the ocean."
- "Generate a haiku about spring."

The agent calls `generate_haiku` with structured haiku data (Japanese text,
English translation, image, gradient); the frontend renders a HaikuCard inline.

## Technical Details

- The `generate_haiku` tool is registered on the frontend via `useFrontendTool`
  from `@copilotkit/react-core/v2`. It ships a Zod parameter schema, a handler,
  and a render function.
- CopilotKit's runtime forwards the tool definition to the MS Agent Framework
  agent at request time, so the agent never sees it as a backend tool — it just
  calls `generate_haiku` by name.
- The MS Agent Framework agent (`gen_ui_tool_based_agent.py`) has `tools=[]`
  and a system prompt that nudges it to compose haiku and pass structured
  `{japanese, english, image_name, gradient}` arguments.
