export type Position = { x: number; y: number };

export type Anchor = {
  horizontal: "left" | "right";
  vertical: "top" | "bottom";
};

export type Size = { width: number; height: number };

export type ContextKey = "button" | "window";

export type DockMode = "floating" | "docked-left";

export type ContextState = {
  position: Position;
  size: Size;
  anchor: Anchor;
  anchorOffset: Position;
};

// ─── Thread details types ────────────────────────────────────────────────────

export interface ApiThreadMessage {
  id: string;
  role: string;
  content?: string;
  toolCalls?: Array<{ id: string; name: string; args: string }>;
  toolCallId?: string;
  /** Present when role === "activity" (Generative UI output). */
  activityType?: string;
}

export interface ConversationUser {
  id: string;
  type: "user";
  content: string;
  createdAt: string;
}

export interface ConversationAssistant {
  id: string;
  type: "assistant";
  content: string;
  createdAt: string;
}

export interface ConversationToolCall {
  id: string;
  type: "tool_call";
  toolName: string;
  toolCallId: string;
  arguments: Record<string, unknown>;
  result: Record<string, unknown> | null;
  createdAt: string;
  groupId?: string;
}

export interface ConversationReasoning {
  id: string;
  type: "reasoning";
  duration: string;
  createdAt: string;
}

export interface ConversationStateUpdate {
  id: string;
  type: "state_update";
  createdAt: string;
}

export interface ConversationAgentResponded {
  id: string;
  type: "agent_responded";
  createdAt: string;
}

export interface ConversationGenerativeUIItem {
  id: string;
  type: "generative-ui";
  activityType: string;
  /** Pre-rendered HTML for demo/scripted mode. Not present for live runtime data. */
  html?: string;
  createdAt: string;
}

export interface ToolCallGroup {
  type: "tool_call_group";
  id: string;
  items: ConversationToolCall[];
}

export type ConversationItem =
  | ConversationUser
  | ConversationAssistant
  | ConversationToolCall
  | ConversationReasoning
  | ConversationStateUpdate
  | ConversationAgentResponded
  | ConversationGenerativeUIItem;

export type RenderItem = ConversationItem | ToolCallGroup;

export interface ApiAgentEvent {
  type: string;
  timestamp: string | number;
  payload: Record<string, unknown>;
}

export type ThreadDetailsTab = "conversation" | "agent-state" | "ag-ui-events";
