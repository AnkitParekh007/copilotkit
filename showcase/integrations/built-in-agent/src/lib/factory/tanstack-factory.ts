import { BuiltInAgent, convertInputToTanStackAI } from "@copilotkit/runtime/v2";
import { chat } from "@tanstack/ai";
import { openaiText } from "@tanstack/ai-openai";
import { stateTools } from "./state-tools";
import { baseServerTools } from "./server-tools";
import { buildSubagentTools } from "./subagent-tools";

export function createBuiltInAgent() {
  return new BuiltInAgent({
    type: "tanstack",
    factory: ({ input, abortController }) => {
      const { messages, systemPrompts } = convertInputToTanStackAI(input);
      // Subagent tools are built per-run so their nested chat() calls abort
      // with the parent. Module-level tool construction leaks: a user cancel
      // never reaches the in-flight nested call.
      const subagentTools = buildSubagentTools(abortController);
      return chat({
        adapter: openaiText("gpt-4o"),
        messages,
        systemPrompts,
        tools: [...stateTools, ...baseServerTools, ...subagentTools],
        abortController,
      });
    },
  });
}
