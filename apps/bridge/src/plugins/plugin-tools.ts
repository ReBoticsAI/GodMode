import type { AiToolDef, ToolMode } from "../services/ai-tools-registry.js";
import { pluginRuntime } from "./runtime.js";

export interface PluginToolExecContext {
  tenantId?: string;
  userId?: string;
  activeAgentId?: string;
  activeSubtaskCardId?: string;
  activeTaskCardId?: string;
}

export function pluginToolsAsAiDefs(): AiToolDef[] {
  return pluginRuntime.allTools().map((t) => ({
    name: t.name,
    description: t.description,
    mode: (t.mode ?? "auto") as ToolMode,
    parameters: t.parameters,
    departments: t.departments,
  }));
}

export function isPluginToolName(name: string): boolean {
  return pluginRuntime.getToolHandler(name) !== undefined;
}

export function isTradingDepartmentPluginTool(name: string): boolean {
  const t = pluginRuntime.getToolHandler(name);
  return Boolean(t?.departments?.includes("trading"));
}

export async function executePluginTool(
  name: string,
  args: Record<string, unknown>,
  execCtx?: PluginToolExecContext
): Promise<unknown | undefined> {
  const def = pluginRuntime.getToolHandler(name);
  if (!def?.handler) return undefined;
  const ctx = pluginRuntime.buildToolContext({
    tenantId: execCtx?.tenantId,
    userId: execCtx?.userId,
    activeAgentId: execCtx?.activeAgentId,
    activeSubtaskCardId: execCtx?.activeSubtaskCardId,
    activeTaskCardId: execCtx?.activeTaskCardId,
  });
  return def.handler(args, ctx);
}
