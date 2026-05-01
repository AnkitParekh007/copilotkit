import {
  CopilotRuntime,
  InMemoryAgentRunner,
  createCopilotEndpoint,
} from "@copilotkit/runtime/v2";
import { LangGraphHttpAgent } from "@copilotkit/runtime/langgraph";
import { handle } from "hono/vercel";

// 1. Create the CopilotRuntime instance and utilize the LangGraph AG-UI
//    integration to setup the connection.
const runtime = new CopilotRuntime({
  agents: {
    sample_agent: new LangGraphHttpAgent({
      url: process.env.AGENT_URL || "http://localhost:8123",
    }),
  },
  runner: new InMemoryAgentRunner(),
});

// 2. Build a Next.js API route that handles the CopilotKit runtime requests.
const app = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handle(app);
export const POST = handle(app);
