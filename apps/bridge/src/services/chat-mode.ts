import type { AiToolDef } from "./ai-tools-registry.js";

export type IntelligenceChatMode = "agent" | "plan" | "ask";

const PLAN_BLOCKED = new Set([
  "run_terminal",
  "edit_file",
  "write_file",
  "delete_file",
  "apply_patch",
  "revert_file",
  "ask_cursor_agent",
  "deploy_playbook",
  "flatten_all",
  "flatten_playbook",
  "install_plugin",
  "build_plugin",
  "scaffold_plugin",
  "create_hook",
  "create_schedule",
  "run_workflow",
  "create_workflow",
]);

/** Tools allowed in Plan mode (read-only + planning). */
export function isPlanModeTool(def: AiToolDef): boolean {
  if (PLAN_BLOCKED.has(def.name)) return false;
  if (def.write) return false;
  if (def.name.startsWith("create_") && def.name !== "create_project_card") return false;
  return true;
}

export function filterToolsForChatMode<T extends { function: { name: string } }>(
  schemas: T[],
  mode: IntelligenceChatMode,
  defsByName: Map<string, AiToolDef>
): T[] {
  if (mode === "ask") return [];
  if (mode === "agent") return schemas;
  return schemas.filter((s) => {
    const def = defsByName.get(s.function.name);
    if (!def) return false;
    return isPlanModeTool(def);
  });
}

export function getChatModeHarnessBlock(mode: IntelligenceChatMode): string {
  if (mode === "ask") {
    return [
      "<chat_mode_ask>",
      "You are in **Ask** mode: answer from context and knowledge only.",
      "Do NOT call tools. If the user needs actions, suggest switching to Agent mode.",
      "</chat_mode_ask>",
    ].join("\n");
  }
  if (mode === "plan") {
    return [
      "<chat_mode_plan>",
      "You are in **Plan** mode: explore and propose only.",
      "Use read-only tools (grep, read_file, list_*, wiki read). Do NOT edit files, run terminal, deploy, or install.",
      "Use todo_write to structure the plan. End with a clear numbered implementation plan for Agent mode.",
      "</chat_mode_plan>",
    ].join("\n");
  }
  return [
    "<chat_mode_agent>",
    "You are in **Agent** mode: execute the full explore → plan → edit → verify loop until done.",
    "</chat_mode_agent>",
  ].join("\n");
}
