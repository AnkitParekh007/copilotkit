"use client";

import {
  CopilotKitProvider,
  CopilotChat,
  useComponent,
} from "@copilotkit/react-core/v2";

export default function GenUiToolBased() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" useSingleEndpoint>
      <Demo />
    </CopilotKitProvider>
  );
}

function Demo() {
  useComponent({
    name: "haiku",
    render: HaikuCard,
  });

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold mb-4">Tool-Based Generative UI</h1>
      <p className="text-sm opacity-70 mb-6">
        Try: &ldquo;Write me a haiku about morning dew.&rdquo; The agent calls
        the
        <code className="mx-1 px-1 bg-gray-100 rounded">haiku</code>
        tool and the result renders inline as a typed card.
      </p>
      <CopilotChat />
    </main>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function HaikuCard(props: any) {
  const { status, result, parameters } = props;

  if (status !== "complete" || !result) {
    return (
      <div className="border rounded p-3 my-2 opacity-70 text-sm">
        Composing haiku
        {parameters?.topic ? ` about ${parameters.topic}…` : "…"}
      </div>
    );
  }

  let data: { topic?: string; lines?: string[] } = {};
  try {
    data = JSON.parse(result);
  } catch {
    // leave empty on parse failure
  }
  const lines = data.lines ?? [];

  return (
    <div className="border rounded p-4 my-2 bg-amber-50">
      <div className="font-medium mb-2">Haiku — {data.topic ?? ""}</div>
      <div className="font-serif italic whitespace-pre-line text-lg leading-relaxed">
        {lines.join("\n")}
      </div>
    </div>
  );
}
