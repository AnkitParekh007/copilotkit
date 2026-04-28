/**
 * V1 compatibility wrapper for useCopilotAction.
 *
 * Accepts the legacy Parameter[] action format and routes to the appropriate
 * v2 composable (useFrontendTool, useHumanInTheLoop, or useRenderTool).
 */
import type { WatchSource } from "vue";
import type { Parameter, MappedParameterTypes } from "@copilotkit/shared";
import { getZodParameters } from "@copilotkit/shared";
import { useFrontendTool as useFrontendToolV2 } from "../v2/hooks/use-frontend-tool";
import { useHumanInTheLoop as useHumanInTheLoopV2 } from "../v2/hooks/use-human-in-the-loop";
import { useRenderTool as useRenderToolV2 } from "../v2/hooks/use-render-tool";
import type { VueFrontendTool, VueHumanInTheLoop } from "../v2/types";

export interface FrontendAction<T extends Parameter[] | [] = []> {
  name: string;
  description?: string;
  parameters?: T;
  handler?: (args: MappedParameterTypes<T>) => unknown | Promise<unknown>;
  followUp?: boolean | string;
  available?: "disabled" | "enabled" | "remote" | "frontend";
  render?: VueFrontendTool<MappedParameterTypes<T>>["render"];
  renderAndWaitForResponse?: VueFrontendTool<MappedParameterTypes<T>>["render"];
  renderAndWait?: VueFrontendTool<MappedParameterTypes<T>>["render"];
  agentId?: string;
}

export interface CatchAllFrontendAction {
  name: "*";
  render: (props: unknown) => unknown;
}

export function useCopilotAction<const T extends Parameter[] | [] = []>(
  action: FrontendAction<T> | CatchAllFrontendAction,
  deps?: WatchSource<unknown>[],
): void {
  const zodParameters = "parameters" in action ? getZodParameters(action.parameters as T) : undefined;

  // Catch-all render action
  if (action.name === "*") {
    useRenderToolV2(
      {
        name: "*",
        render: (action as CatchAllFrontendAction).render,
        ...("agentId" in action ? { agentId: (action as FrontendAction<T>).agentId } : {}),
      },
      deps,
    );
    return;
  }

  const typedAction = action as FrontendAction<T>;

  // Human-in-the-loop: has renderAndWaitForResponse or renderAndWait
  if ("renderAndWaitForResponse" in typedAction || "renderAndWait" in typedAction) {
    const render =
      typedAction.render ??
      typedAction.renderAndWaitForResponse ??
      typedAction.renderAndWait;

    useHumanInTheLoopV2<MappedParameterTypes<T>>(
      {
        name: typedAction.name,
        description: typedAction.description,
        parameters: zodParameters,
        render: render as VueHumanInTheLoop<MappedParameterTypes<T>>["render"],
        agentId: typedAction.agentId,
      },
      deps,
    );
    return;
  }

  // Render-only: available is "frontend" or "disabled" (no handler invoked remotely)
  if (typedAction.available === "frontend" || typedAction.available === "disabled") {
    if (typedAction.render && zodParameters) {
      useRenderToolV2(
        {
          name: typedAction.name,
          parameters: zodParameters,
          render: typedAction.render as (props: unknown) => unknown,
          agentId: typedAction.agentId,
        },
        deps,
      );
    }
    return;
  }

  // Default: frontend tool with handler
  useFrontendToolV2<MappedParameterTypes<T>>({
    name: typedAction.name,
    description: typedAction.description,
    parameters: zodParameters,
    handler: typedAction.handler as ((args: MappedParameterTypes<T>) => unknown | Promise<unknown>) | undefined,
    followUp: typedAction.followUp,
    render: typedAction.render,
    available:
      typedAction.available === undefined
        ? undefined
        : typedAction.available !== "disabled",
    agentId: typedAction.agentId,
  });
}
