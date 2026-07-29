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

type AttachState = "idle" | "connecting" | "attached" | "error";

/**
 * Shared PTY Coding Terminal (#162): session list + xterm attach over /ws/terminal.
 */
export function CodingTerminalPanel() {
  const [sessions, setSessions] = useState<CodingTerminalSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [attachState, setAttachState] = useState<AttachState>("idle");
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

  const fitTerminal = useCallback(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    const host = hostRef.current;
    if (!term || !fit || !host) return;
    if (host.clientWidth < 8 || host.clientHeight < 8) return;
    fit.fit();
    sendRef.current?.({
      type: "resize",
      cols: term.cols,
      rows: term.rows,
    });
  }, []);

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
    termRef.current = term;
    fitRef.current = fit;
    requestAnimationFrame(() => fitTerminal());

    const onResize = () => fitTerminal();
    window.addEventListener("resize", onResize);
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => fitTerminal())
        : null;
    ro?.observe(host);

    const dataDisp = term.onData((data) => {
      sendRef.current?.({ type: "stdin", data });
    });

    return () => {
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
      dataDisp.dispose();
      detachWsRef.current?.();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      sendRef.current = null;
    };
  }, [fitTerminal]);

  const attach = useCallback(
    (sessionId: string) => {
      detachWsRef.current?.();
      termRef.current?.reset();
      setActiveId(sessionId);
      setAttachState("connecting");
      const session = sessions.find((s) => s.sessionId === sessionId);
      if (session) {
        setMeta({ sandboxed: session.sandboxed, netMode: session.netMode });
      }

      const { send, close } = connectCodingTerminalWs({
        onOpen: () => {
          fitTerminal();
        },
        onMessage: (msg) => {
          const type = String((msg as { type?: string }).type ?? "");
          if (type === "stdout") {
            const data = String((msg as { data?: string }).data ?? "");
            termRef.current?.write(data);
          } else if (type === "exit") {
            const code = (msg as { exitCode?: number }).exitCode;
            termRef.current?.writeln(`\r\n[session exited: ${code ?? "?"}]`);
            setAttachState("idle");
            void refresh();
          } else if (type === "error") {
            setAttachState("error");
            toast.error(
              String((msg as { error?: string }).error ?? "terminal error")
            );
          } else if (type === "attached") {
            setAttachState("attached");
            fitTerminal();
            send({
              type: "resize",
              cols: termRef.current?.cols ?? 80,
              rows: termRef.current?.rows ?? 24,
            });
          } else if (type === "connected") {
            fitTerminal();
          }
        },
        onError: () => {
          setAttachState("error");
        },
        onClose: (ev, meta) => {
          sendRef.current = null;
          if (meta.closedByClient) {
            setAttachState("idle");
            return;
          }
          if (ev.code === 4401 || ev.code === 4403) {
            setAttachState("error");
            toast.error(
              ev.reason ||
                (ev.code === 4401
                  ? "Terminal WebSocket auth failed"
                  : "Terminal WebSocket refused")
            );
            return;
          }
          setAttachState((s) =>
            s === "attached" || s === "connecting" ? "error" : s
          );
        },
      });
      sendRef.current = send;
      detachWsRef.current = close;
      send({ type: "attach", sessionId });
    },
    [fitTerminal, refresh, sessions]
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
      setAttachState("idle");
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
            ) : attachState === "attached" ? (
              <Badge className="text-[10px]">attached</Badge>
            ) : attachState === "connecting" ? (
              <Badge variant="secondary" className="text-[10px]">
                connecting
              </Badge>
            ) : attachState === "error" ? (
              <Badge variant="destructive" className="text-[10px]">
                ws error
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">
                selected
              </Badge>
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
            setAttachState("idle");
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
