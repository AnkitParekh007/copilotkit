/* baseline-types.ts — Types, constants, and validation for the Baseline tab */

/* ------------------------------------------------------------------ */
/*  Core types                                                         */
/* ------------------------------------------------------------------ */

export type BaselineStatus = "works" | "possible" | "impossible" | "unknown";

export type BaselineTag =
  | "all"
  | "cpk"
  | "agui"
  | "int"
  | "demo"
  | "docs"
  | "tests";

export interface BaselineCell {
  id: string;
  key: string;
  partner: string;
  feature: string;
  status: BaselineStatus;
  tags: BaselineTag[];
  updated_at: string;
  updated_by: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

export const STATUSES: readonly BaselineStatus[] = [
  "works",
  "possible",
  "impossible",
  "unknown",
] as const;

export const TAGS: readonly BaselineTag[] = [
  "all",
  "cpk",
  "agui",
  "int",
  "demo",
  "docs",
  "tests",
] as const;

export const INDIVIDUAL_TAGS: readonly BaselineTag[] = TAGS.filter(
  (t) => t !== "all",
);

/* ------------------------------------------------------------------ */
/*  Tag badge visual config                                            */
/* ------------------------------------------------------------------ */

export const TAG_BADGE_CONFIG: Record<
  BaselineTag,
  { label: string; color: string; bgColor: string }
> = {
  cpk: { label: "C", color: "#c084fc", bgColor: "rgba(168,85,247,0.2)" },
  agui: { label: "A", color: "#93c5fd", bgColor: "rgba(96,165,250,0.2)" },
  int: { label: "I", color: "#fca5a5", bgColor: "rgba(248,113,113,0.2)" },
  demo: { label: "▶", color: "#6ee7b7", bgColor: "rgba(52,211,153,0.2)" },
  docs: { label: "D", color: "#fcd34d", bgColor: "rgba(251,191,36,0.2)" },
  tests: { label: "T", color: "#d4a76a", bgColor: "rgba(180,140,100,0.2)" },
  all: { label: "✱", color: "#9ca3af", bgColor: "rgba(107,112,128,0.25)" },
};

/* ------------------------------------------------------------------ */
/*  Status visual config                                               */
/* ------------------------------------------------------------------ */

export const STATUS_CONFIG: Record<
  BaselineStatus,
  { emoji: string; color: string; bgColor: string }
> = {
  works: {
    emoji: "✅",
    color: "var(--ok)",
    bgColor: "rgba(52,211,153,0.15)",
  },
  possible: {
    emoji: "🛠️",
    color: "var(--amber)",
    bgColor: "rgba(251,191,36,0.12)",
  },
  impossible: {
    emoji: "❌",
    color: "var(--danger)",
    bgColor: "rgba(248,113,113,0.12)",
  },
  unknown: {
    emoji: "❓",
    color: "var(--unknown,#a78bfa)",
    bgColor: "rgba(167,139,250,0.12)",
  },
};

/* ------------------------------------------------------------------ */
/*  Validation                                                         */
/* ------------------------------------------------------------------ */

/**
 * Validates a BaselineCell's invariants:
 * - "possible" requires at least 1 tag
 * - "works", "impossible", and "unknown" require 0 tags
 */
export function validateCell(cell: BaselineCell): boolean {
  if (cell.status === "possible") {
    return cell.tags.length >= 1;
  }
  // works, impossible, unknown: must have no tags
  return cell.tags.length === 0;
}

/* ------------------------------------------------------------------ */
/*  Feature categories                                                 */
/* ------------------------------------------------------------------ */

export const FEATURE_CATEGORIES: Record<string, string[]> = {
  "Chat & UI": [
    "beautiful-chat",
    "pre-built-copilotchat",
    "pre-built-sidebar",
    "pre-built-popup",
    "chat-customization-slots",
    "chat-customization-css",
    "headless-chat-simple",
    "headless-chat-complete",
  ],
  "Generative UI": [
    "controlled-gen-ui-display",
    "declarative-generative-ui-a2ui-dynamic-schema",
    "declarative-generative-ui-a2ui-fixed-schema",
    "mcp-apps",
    "fully-open-ended-generative-ui",
    "open-ended-gen-ui-advanced-with-frontend-function-calling",
    "tool-rendering-default-catch-all",
    "tool-rendering-custom-catch-all",
    "tool-rendering",
  ],
  "Human in the Loop": [
    "in-chat-hitl-usehumanintheloop-ergonomic-api",
    "in-chat-hitl-booking",
    "in-chat-human-in-the-loop-original",
    "in-app-human-in-the-loop-frontend-tools-async-hitl",
    "in-chat-hitl-useinterrupt-low-level-primitive",
  ],
  "Agent Capabilities": [
    "reasoning",
    "file-attachments",
    "shared-state-read-write",
    "agentic-generative-ui-in-chat-state-rendering",
    "state-streaming",
    "frontend-tools-in-app-actions",
    "frontend-tools-async",
    "readonly-state-agent-context",
    "sub-agents",
  ],
  Advanced: [
    "byoc-hashbrown",
    "byoc-json-render",
  ],
};

/* ------------------------------------------------------------------ */
/*  Partners                                                           */
/* ------------------------------------------------------------------ */

export const BASELINE_PARTNERS: readonly { name: string; slug: string }[] = [
  { name: "LangChain - Python", slug: "langchain-python" },
  { name: "Google ADK", slug: "google-adk" },
  { name: "MAF - Python", slug: "maf-python" },
  { name: "MAF - .Net", slug: "maf-dotnet" },
  { name: "Strands", slug: "strands" },
  { name: "Mastra", slug: "mastra" },
  { name: "CrewAI", slug: "crewai" },
  { name: "PydanticAI", slug: "pydantic-ai" },
  { name: "Claude Agents SDK - Python", slug: "claude-sdk-python" },
  { name: "Claude Agents SDK - TS", slug: "claude-sdk-typescript" },
  { name: "Agno", slug: "agno" },
  { name: "AG2", slug: "ag2" },
  { name: "LlamaIndex", slug: "llamaindex" },
  { name: "Spring AI", slug: "spring-ai" },
  { name: "Langroid", slug: "langroid" },
  { name: "Built-in Agent", slug: "built-in-agent" },
  { name: "AWS FAST - LangGraph", slug: "aws-fast-langgraph" },
  { name: "AWS FAST - Strands", slug: "aws-fast-strands" },
  { name: "Deep Agents", slug: "deep-agents" },
  { name: "Oracle Open Agent Spec", slug: "oracle-open-agent-spec" },
  { name: "OpenAI Agents SDK", slug: "openai-agents-sdk" },
  { name: "n8n", slug: "n8n" },
  { name: "Cloudflare", slug: "cloudflare" },
  { name: "LangChain - TypeScript", slug: "langchain-typescript" },
  { name: "LangChain - FastAPI", slug: "langchain-fastapi" },
];
