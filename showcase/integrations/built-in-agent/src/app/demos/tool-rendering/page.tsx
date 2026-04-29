"use client";

import {
  CopilotKitProvider,
  CopilotChat,
  useComponent,
  useDefaultRenderTool,
} from "@copilotkit/react-core/v2";

export default function ToolRendering() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" useSingleEndpoint>
      <Demo />
    </CopilotKitProvider>
  );
}

function Demo() {
  useComponent({
    name: "weather",
    render: WeatherCard,
  });

  useDefaultRenderTool({
    render: GenericToolCard,
  });

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold mb-4">Tool Rendering</h1>
      <p className="text-sm opacity-70 mb-6">
        Try: &ldquo;What&apos;s the weather in Tokyo?&rdquo; The
        <code className="mx-1 px-1 bg-gray-100 rounded">weather</code>tool
        renders with a custom card; everything else falls back to a generic
        renderer.
      </p>
      <CopilotChat />
    </main>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function WeatherCard(props: any) {
  const { status, result } = props;
  if (status !== "complete" || !result) {
    return (
      <div className="border rounded p-3 my-2 opacity-70 text-sm">
        Fetching weather…
      </div>
    );
  }
  let data: {
    city?: string;
    tempF?: number;
    condition?: string;
    humidity?: number;
  } = {};
  try {
    data = JSON.parse(result);
  } catch {
    // Leave data empty on parse failure
  }
  const humidityPct =
    data.humidity != null ? `${Math.round(data.humidity * 100)}%` : "—";
  return (
    <div className="border rounded p-3 my-2">
      <div className="font-medium">Weather in {data.city ?? "—"}</div>
      <div className="grid grid-cols-3 gap-2 text-sm mt-2">
        <div>
          <div className="opacity-60">Temp</div>
          <div>{data.tempF != null ? `${data.tempF}°F` : "—"}</div>
        </div>
        <div>
          <div className="opacity-60">Condition</div>
          <div>{data.condition ?? "—"}</div>
        </div>
        <div>
          <div className="opacity-60">Humidity</div>
          <div>{humidityPct}</div>
        </div>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function GenericToolCard(props: any) {
  const { name, status, parameters, result } = props;
  return (
    <div className="border rounded p-2 my-2 text-xs">
      <div className="font-mono opacity-60">
        {name} <span className="opacity-50">[{status}]</span>
      </div>
      <pre className="overflow-auto text-[10px] mt-1">
        {JSON.stringify(
          status === "complete" ? safeParse(result) : parameters,
          null,
          2,
        )}
      </pre>
    </div>
  );
}

function safeParse(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
