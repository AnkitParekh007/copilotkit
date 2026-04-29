"use client";

import {
  CopilotKitProvider,
  CopilotChat,
  useComponent,
} from "@copilotkit/react-core/v2";

export default function Subagents() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" useSingleEndpoint>
      <Demo />
    </CopilotKitProvider>
  );
}

function Demo() {
  useComponent({
    name: "delegate_to_planner",
    render: DelegationCard,
  });
  useComponent({
    name: "delegate_to_researcher",
    render: DelegationCard,
  });

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold mb-4">Sub-Agents</h1>
      <p className="text-sm opacity-70 mb-6">
        The main agent delegates tasks to subagents via{" "}
        <code className="px-1 bg-gray-100 rounded">delegate_to_planner</code>
        {" / "}
        <code className="px-1 bg-gray-100 rounded">delegate_to_researcher</code>
        . Each delegation runs a nested <code>chat()</code> with its own system
        prompt. Try: &ldquo;Plan a 2-day trip to Tokyo with key sights.&rdquo;
      </p>
      <CopilotChat />
    </main>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DelegationCard(props: any) {
  const { name, status, parameters, result } = props;
  const role =
    typeof name === "string" ? name.replace(/^delegate_to_/, "") : "subagent";

  let parsed: { role?: string; text?: string } = {};
  if (status === "complete" && typeof result === "string") {
    try {
      parsed = JSON.parse(result);
    } catch {
      // leave parsed empty
    }
  }

  const task = parameters?.task ?? "";

  return (
    <div className="border rounded p-3 my-2 bg-blue-50">
      <div className="font-medium">
        Delegating to {role}
        {status === "complete" ? (
          <span className="opacity-60"> · done</span>
        ) : (
          <span className="opacity-60"> · running…</span>
        )}
      </div>
      {task ? (
        <div className="text-sm mt-1 opacity-80">Task: {task}</div>
      ) : null}
      {status === "complete" && parsed.text ? (
        <div className="mt-2 text-sm whitespace-pre-wrap">{parsed.text}</div>
      ) : null}
    </div>
  );
}
