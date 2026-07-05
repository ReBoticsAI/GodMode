import type { AgentMessage } from "./ai-agent.js";

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
    return [{ role: turn.role as AgentMessage["role"], content: turn.content ?? "" }];
  }

  const out: AgentMessage[] = [];
  let textBuf = "";

  const flushText = () => {
    if (textBuf.trim()) {
      out.push({ role: "assistant", content: textBuf.trim() });
      textBuf = "";
    }
  };

  for (const p of turn.parts) {
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
    return [{ role: "assistant", content: turn.content ?? "" }];
  }
  return out;
}

export function historyToAgentMessages(history: HistoryTurn[]): AgentMessage[] {
  const out: AgentMessage[] = [];
  for (const h of history) {
    if (h.role === "assistant" && h.parts?.length) {
      out.push(...partsToAgentMessages(h));
    } else {
      out.push({
        role: h.role as AgentMessage["role"],
        content: h.content ?? "",
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
): AgentMessage[] {
  let total = messages.reduce((a, m) => a + messageChars(m), 0);
  if (total <= maxChars) return messages;

  const kept = [...messages];
  while (kept.length > 2 && total > maxChars) {
    const drop = kept.findIndex(
      (m, i) => i > 0 && m.role === "user"
    );
    if (drop < 0) break;
    let end = drop + 1;
    while (end < kept.length && kept[end].role !== "user") end++;
    const removed = kept.splice(drop, end - drop);
    total -= removed.reduce((a, m) => a + messageChars(m), 0);
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
  return kept;
}
