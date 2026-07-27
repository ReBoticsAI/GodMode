import { useEffect, useRef, useState } from "react";
import { PlayIcon, SquareIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  streamCodingTerminal,
  type CodingTerminalDone,
} from "@/api";
import { toast } from "sonner";

/**
 * Human coding command runner (#148 slice 1).
 * One-shot sandboxed shell (same boundary as agent run_terminal). Not a PTY.
 */
export function CodingTerminalPanel() {
  const [command, setCommand] = useState("");
  const [cwd, setCwd] = useState(".");
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<CodingTerminalDone | null>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.();
    };
  }, []);

  useEffect(() => {
    const el = preRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [output]);

  const stop = () => {
    abortRef.current?.();
    abortRef.current = null;
    setRunning(false);
  };

  const run = () => {
    const cmd = command.trim();
    if (!cmd || running) return;
    setOutput("");
    setDone(null);
    setRunning(true);
    abortRef.current = streamCodingTerminal(
      { command: cmd, cwd: cwd.trim() || "." },
      {
        onOutput: ({ text }) => {
          setOutput((prev) => prev + text);
        },
        onDone: (result) => {
          setDone(result);
          setRunning(false);
          abortRef.current = null;
        },
        onError: (error) => {
          setOutput((prev) => prev + (prev ? "\n" : "") + error);
          toast.error(error);
          setRunning(false);
          abortRef.current = null;
        },
      }
    );
  };

  return (
    <div className="flex min-h-[28rem] flex-col gap-3 rounded-xl border bg-card p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[8rem] flex-1 flex-col gap-1">
          <span className="text-xs text-muted-foreground">cwd (relative)</span>
          <Input
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            disabled={running}
            spellCheck={false}
            className="font-mono text-xs"
          />
        </label>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            onClick={run}
            disabled={running || !command.trim()}
          >
            <PlayIcon data-icon="inline-start" />
            Run
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={stop}
            disabled={!running}
          >
            <SquareIcon data-icon="inline-start" />
            Stop
          </Button>
        </div>
      </div>

      <Textarea
        className="min-h-[6rem] font-mono text-xs"
        value={command}
        onChange={(e) => setCommand(e.target.value)}
        disabled={running}
        spellCheck={false}
        placeholder="Shell command (one-shot; same sandbox as agent run_terminal)"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            run();
          }
        }}
      />

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Command runner (not a full interactive PTY)</span>
        {done ? (
          <>
            <Badge variant={done.exitCode === 0 ? "secondary" : "destructive"}>
              exit {done.exitCode ?? "null"}
            </Badge>
            {done.timedOut ? <Badge variant="destructive">timed out</Badge> : null}
            {done.sandboxed ? (
              <Badge variant="outline">sandboxed{done.netMode ? ` · ${done.netMode}` : ""}</Badge>
            ) : (
              <Badge variant="outline">host shell</Badge>
            )}
            <span className="font-mono">cwd {done.cwd}</span>
          </>
        ) : null}
        {running ? <Badge variant="secondary">running…</Badge> : null}
      </div>

      <pre
        ref={preRef}
        className="min-h-[16rem] flex-1 overflow-auto rounded-md bg-zinc-950 p-3 font-mono text-xs text-zinc-100"
      >
        {output || (running ? "" : "Output appears here.")}
      </pre>
    </div>
  );
}
