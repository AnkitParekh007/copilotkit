import { h } from "vue";
import type { Component, VNodeChild } from "vue";
import type { VueToolCallRendererRenderProps } from "../types";

function isVueComponent(value: unknown): boolean {
  if (typeof value === "object" && value !== null) return true;
  if (typeof value === "function") {
    return (
      "__name" in value ||
      "setup" in value ||
      "render" in value ||
      "__vccOpts" in value ||
      "props" in value
    );
  }
  return false;
}

/**
 * Normalize a Vue component or render function to a render function.
 * If Component is provided, returns (props) => h(Component, props).
 */
export function normalizeVueRenderer<T>(
  render:
    | ((props: VueToolCallRendererRenderProps<T>) => VNodeChild)
    | Component<VueToolCallRendererRenderProps<T>>,
): (props: VueToolCallRendererRenderProps<T>) => VNodeChild {
  if (typeof render === "function" && !isVueComponent(render)) {
    return render as (props: VueToolCallRendererRenderProps<T>) => VNodeChild;
  }
  return (props: VueToolCallRendererRenderProps<T>) =>
    h(render as Component, props);
}
