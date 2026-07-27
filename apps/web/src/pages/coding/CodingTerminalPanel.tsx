import { useCallback, useEffect, useRef, useState } from "react";
import { PlusIcon, SquareIcon, Trash2Icon } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  closeCodingTerminalSession,
  connectCodingTerminalWs,
  createCodingTerminalSession,
  listCodingTerminalSessions,
  type CodingTerminalSession,
} from "@/api";
import { toast } from "sonner";

/**
 * Shared PTY Coding Terminal (#162): session list + xterm attach over /ws/terminal.
 */
export function CodingTerminalPanel() {
  const [sessions, setSessions] = useState<CodingTerminalSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [cwd, setCwd] = useState(".");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<{
    sandboxed?: boolean;
    netMode?: string;
  }>({});

  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sendRef = useRef<((msg: object) => void) | null>(null);
  const detachWsRef = useRef<(() => void) | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await listCodingTerminalSessions();
      setSessions(res.sessions);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      theme: {
        background: "#0c0c0c",
        foreground: "#e8e8e8",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const onResize = () => {
      fit.fit();
      const dims = { cols: term.cols, rows: term.rows };
      sendRef.current?.({ type: "resize", ...dims });
    };
    window.addEventListener("resize", onResize);

    const dataDisp = term.onData((data) => {
      sendRef.current?.({ type: "stdin", data });
    });

    return () => {
      window.removeEventListener("resize", onResize);
      dataDisp.dispose();
      detachWsRef.current?.();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      sendRef.current = null;
    };
  }, []);

  const attach = useCallback(
    (sessionId: string) => {
      detachWsRef.current?.();
      termRef.current?.reset();
      setActiveId(sessionId);
      const session = sessions.find((s) => s.sessionId === sessionId);
      if (session) {
        setMeta({ sandboxed: session.sandboxed, netMode: session.netMode });
      }

      const { send, close } = connectCodingTerminalWs({
        onMessage: (msg) => {
          const type = String((msg as { type?: string }).type ?? "");
          if (type === "stdout") {
            const data = String((msg as { data?: string }).data ?? "");
            termRef.current?.write(data);
          } else if (type === "exit") {
            const code = (msg as { exitCode?: number }).exitCode;
            termRef.current?.writeln(`\r\n[session exited: ${code ?? "?"}]`);
            void refresh();
          } else if (type === "error") {
            toast.error(String((msg as { error?: string }).error ?? "terminal error"));
          } else if (type === "attached") {
            fitRef.current?.fit();
            send({
              type: "resize",
              cols: termRef.current?.cols ?? 80,
              rows: termRef.current?.rows ?? 24,
            });
          }
        },
        onClose: () => {
          sendRef.current = null;
        },
      });
      sendRef.current = send;
      detachWsRef.current = close;
      send({ type: "attach", sessionId });
    },
    [refresh, sessions]
  );

  const create = async () => {
    setBusy(true);
    try {
      const session = await createCodingTerminalSession({
        cwd: cwd.trim() || ".",
        name: name.trim() || undefined,
      });
      setMeta({ sandboxed: session.sandboxed, netMode: session.netMode });
      await refresh();
      attach(session.sessionId);
      setName("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const closeActive = async () => {
    if (!activeId) return;
    setBusy(true);
    try {
      detachWsRef.current?.();
      detachWsRef.current = null;
      sendRef.current = null;
      await closeCodingTerminalSession(activeId);
      setActiveId(null);
      termRef.current?.reset();
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const active = sessions.find((s) => s.sessionId === activeId);

  return (
    <div className="flex min-h-[28rem] flex-col gap-3 rounded-xl border bg-card p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[8rem] flex-1 flex-col gap-1">
          <span className="text-xs text-muted-foreground">cwd (relative)</span>
          <Input
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            disabled={busy}
            spellCheck={false}
            className="font-mono text-xs"
          />
        </label>
        <label className="flex min-w-[8rem] flex-1 flex-col gap-1">
          <span className="text-xs text-muted-foreground">name (optional)</span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            spellCheck={false}
            className="text-xs"
          />
        </label>
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={() => void create()} disabled={busy}>
            <PlusIcon data-icon="inline-start" />
            New session
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void closeActive()}
            disabled={busy || !activeId}
          >
            <Trash2Icon data-icon="inline-start" />
            Close
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {activeId ? (
          <>
            <Badge variant="secondary" className="font-mono text-[10px]">
              {activeId.slice(0, 8)}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {(meta.sandboxed ?? active?.sandboxed)
                ? `sandboxed / ${meta.netMode ?? active?.netMode ?? "?"}`
                : "host shell"}
            </Badge>
            {active?.running === false ? (
              <Badge variant="destructive" className="text-[10px]">
                exited
              </Badge>
            ) : (
              <Badge className="text-[10px]">attached</Badge>
            )}
          </>
        ) : (
          <span className="text-xs text-muted-foreground">
            Create or select a session to attach
          </span>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={() => {
            detachWsRef.current?.();
            detachWsRef.current = null;
            sendRef.current = null;
            setActiveId(null);
            termRef.current?.reset();
          }}
          disabled={!activeId}
        >
          <SquareIcon data-icon="inline-start" />
          Detach
        </Button>
      </div>

      {sessions.length > 0 ? (
        <div className="flex max-h-24 flex-wrap gap-1 overflow-auto">
          {sessions.map((s) => (
            <Button
              key={s.sessionId}
              type="button"
              size="sm"
              variant={s.sessionId === activeId ? "default" : "outline"}
              className="h-7 font-mono text-[10px]"
              onClick={() => attach(s.sessionId)}
            >
              {s.name}
              {!s.running ? " (dead)" : ""}
            </Button>
          ))}
        </div>
      ) : null}

      <div
        ref={hostRef}
        className="min-h-[20rem] flex-1 overflow-hidden rounded-md border bg-black p-1"
      />
    </div>
  );
}
