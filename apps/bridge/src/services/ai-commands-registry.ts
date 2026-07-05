export interface AiChatCommand {
  name: string;
  usage: string;
  description: string;
  runsOn: "client" | "server";
}

export const AI_CHAT_COMMANDS: AiChatCommand[] = [
  {
    name: "clear",
    usage: "/clear",
    description: "Start a new chat (clear thread).",
    runsOn: "client",
  },
  {
    name: "model",
    usage: "/model <name>",
    description: "Switch or start a local GGUF model.",
    runsOn: "client",
  },
  {
    name: "screenshot",
    usage: "/screenshot",
    description: "Attach a screenshot of the current page.",
    runsOn: "client",
  },
  {
    name: "memory",
    usage: "/memory add <text>",
    description: "Add a global memory fact.",
    runsOn: "server",
  },
  {
    name: "skill",
    usage: "/skill <id>",
    description: "Load a skill instruction bundle into context.",
    runsOn: "server",
  },
  {
    name: "rules",
    usage: "/rules",
    description: "Open Intelligence Rules in settings.",
    runsOn: "client",
  },
];
