import {
  CopilotRuntime,
  InMemoryAgentRunner,
  createCopilotEndpoint,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";
import { handle } from "hono/vercel";

// 1. Create the CopilotRuntime instance and utilize the Strands AG-UI
//    integration to setup the connection.
const runtime = new CopilotRuntime({
  agents: {
    // Our FastAPI endpoint URL
    strands_agent: new HttpAgent({
      url:
        process.env.AGENT_URL ||
        process.env.STRANDS_AGENT_URL ||
        "http://localhost:8000",
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
