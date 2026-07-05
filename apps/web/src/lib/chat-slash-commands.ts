import type { AiChatCommand } from "@/api";

export type SlashClientAction =
  | "clear"
  | "screenshot"
  | "open-rules"
  | "start-model";

export type SlashProcessResult =
  | { kind: "client"; action: SlashClientAction; modelName?: string }
  | { kind: "expand"; mentionIds: string[]; message: string }
  | { kind: "memory-add"; text: string }
  | { kind: "not-found"; command: string };

/** Parse and interpret a slash command typed in the composer. */
export function processSlashCommand(
  raw: string,
  commands: AiChatCommand[],
  mentionIndex: { skills: Map<string, string>; agents: Map<string, string> }
): SlashProcessResult | null {
  const text = raw.trim();
  if (!text.startsWith("/")) return null;

  const parts = text.split(/\s+/);
  const head = parts[0]?.toLowerCase() ?? "";
  const rest = parts.slice(1).join(" ").trim();

  if (head === "/clear") return { kind: "client", action: "clear" };
  if (head === "/screenshot") return { kind: "client", action: "screenshot" };
  if (head === "/rules") return { kind: "client", action: "open-rules" };
  if (head === "/skill") {
    if (!rest) return { kind: "not-found", command: "/skill <id>" };
    const skillId =
      mentionIndex.skills.get(rest) ??
      [...mentionIndex.skills.entries()].find(([k]) => k.includes(rest))?.[1];
    if (!skillId) return { kind: "not-found", command: `/skill ${rest}` };
    return {
      kind: "expand",
      mentionIds: [`skill:${skillId}`],
      message: `Load skill ${rest} and follow its instructions.`,
    };
  }
  if (head === "/memory" && parts[1]?.toLowerCase() === "add") {
    const memText = parts.slice(2).join(" ").trim();
    if (!memText) return { kind: "not-found", command: "/memory add <text>" };
    return { kind: "memory-add", text: memText };
  }
  if (head === "/model") {
    if (!rest) return { kind: "not-found", command: "/model <name>" };
    return { kind: "client", action: "start-model", modelName: rest };
  }

  const known = commands.some((c) => c.usage.split(/\s/)[0]?.toLowerCase() === head);
  if (known) return { kind: "not-found", command: text };
  return null;
}

export function filterSlashCommands(commands: AiChatCommand[], query: string): AiChatCommand[] {
  const q = query.toLowerCase();
  if (!q) return commands;
  return commands.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.usage.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q)
  );
}
