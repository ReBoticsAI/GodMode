import type { AgentMessage } from "./ai-agent.js";
import { stripThinkingChannels } from "./model-profiles/index.js";

export interface StoredMsgPart {
  kind: string;
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
  status?: string;
  result?: unknown;
  text?: string;
}

export interface HistoryTurn {
  role: string;
  content?: string;
  parts?: StoredMsgPart[];
}

export const HISTORY_CHAR_BUDGET_RATIO = 0.55;

export function partsToAgentMessages(turn: HistoryTurn): AgentMessage[] {
  if (turn.role !== "assistant" || !turn.parts?.length) {
    const raw = turn.content ?? "";
    return [
      {
        role: turn.role as AgentMessage["role"],
        content: turn.role === "assistant" ? stripThinkingChannels(raw) : raw,
      },
    ];
  }

  const out: AgentMessage[] = [];
  let textBuf = "";

  const flushText = () => {
    if (textBuf.trim()) {
      out.push({ role: "assistant", content: stripThinkingChannels(textBuf.trim()) });
      textBuf = "";
    }
  };

  for (const p of turn.parts) {
    if (p.kind === "thinking") {
      // Gemma / OpenAI thought channels must not re-enter multi-turn history.
      continue;
    }
    if (p.kind === "text" && p.text) {
      textBuf += (textBuf ? "\n\n" : "") + p.text;
      continue;
    }
    if (p.kind === "tool" && p.name) {
      flushText();
      const toolCallId = p.id ?? `hist-${p.name}-${out.length}`;
      out.push({
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: toolCallId,
            type: "function",
            function: {
              name: p.name,
              arguments: JSON.stringify(p.args ?? {}),
            },
          },
        ],
      });
      const resultContent =
        p.result == null
          ? "(no result recorded)"
          : typeof p.result === "string"
            ? p.result
            : JSON.stringify(p.result);
      out.push({
        role: "tool",
        tool_call_id: toolCallId,
        name: p.name,
        content: resultContent,
      });
      continue;
    }
  }
  flushText();
  if (!out.length) {
    return [
      {
        role: "assistant",
        content: stripThinkingChannels(turn.content ?? ""),
      },
    ];
  }
  return out;
}

export function historyToAgentMessages(
  history: HistoryTurn[],
  opts?: { stripThinking?: boolean }
): AgentMessage[] {
  const strip = opts?.stripThinking !== false;
  const out: AgentMessage[] = [];
  for (const h of history) {
    if (h.role === "assistant" && h.parts?.length) {
      out.push(...partsToAgentMessages(h));
    } else {
      const raw = h.content ?? "";
      out.push({
        role: h.role as AgentMessage["role"],
        content:
          strip && h.role === "assistant" ? stripThinkingChannels(raw) : raw,
      });
    }
  }
  return out;
}

function messageChars(m: AgentMessage): number {
  let n = m.content?.length ?? 0;
  if (m.tool_calls?.length) {
    for (const tc of m.tool_calls) {
      n += tc.function.name.length + (tc.function.arguments?.length ?? 0);
    }
  }
  return n;
}

export function compactAgentMessages(
  messages: AgentMessage[],
  maxChars: number
): { messages: AgentMessage[]; droppedTurns: number; scratchpad: string } {
  let total = messages.reduce((a, m) => a + messageChars(m), 0);
  if (total <= maxChars) {
    return { messages, droppedTurns: 0, scratchpad: "" };
  }

  const kept = [...messages];
  let droppedTurns = 0;
  const droppedUserPreviews: string[] = [];
  while (kept.length > 2 && total > maxChars) {
    const drop = kept.findIndex((m, i) => i > 0 && m.role === "user");
    if (drop < 0) break;
    let end = drop + 1;
    while (end < kept.length && kept[end].role !== "user") end++;
    const removed = kept.splice(drop, end - drop);
    total -= removed.reduce((a, m) => a + messageChars(m), 0);
    droppedTurns += 1;
    const userMsg = removed.find((m) => m.role === "user");
    if (userMsg?.content?.trim()) {
      const flat = userMsg.content.replace(/\s+/g, " ").trim();
      droppedUserPreviews.push(
        flat.length > 120 ? `${flat.slice(0, 119)}…` : flat
      );
    }
  }

  if (total > maxChars) {
    for (let i = 0; i < kept.length; i++) {
      const m = kept[i];
      if (m.role === "tool" && m.content.length > 2000) {
        const omitted = m.content.length - 2000;
        kept[i] = {
          ...m,
          content: `${m.content.slice(0, 1500)}\n[... ${omitted} chars omitted from earlier tool result ...]`,
        };
      }
    }
  }

  const scratchpad = buildCompactionScratchpad(
    droppedTurns,
    droppedUserPreviews
  );
  return { messages: kept, droppedTurns, scratchpad };
}

function buildCompactionScratchpad(
  droppedTurns: number,
  userPreviews: string[]
): string {
  if (droppedTurns <= 0) return "";
  const lines = [
    `<godmode_compaction>`,
    `Earlier conversation was compacted (${droppedTurns} turn${droppedTurns === 1 ? "" : "s"} dropped from the live window). Episodic distill may retain details in memory.`,
  ];
  if (userPreviews.length) {
    lines.push("Dropped user turns (brief):");
    for (const p of userPreviews.slice(0, 6)) {
      lines.push(`- ${p}`);
    }
    if (userPreviews.length > 6) {
      lines.push(`- … +${userPreviews.length - 6} more`);
    }
  }
  lines.push(`</godmode_compaction>`);
  return lines.join("\n");
}
