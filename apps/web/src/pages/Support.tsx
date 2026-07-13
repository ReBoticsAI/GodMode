import { useCallback, useEffect, useState } from "react";
import { Page, PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SupportRequestDialog } from "@/components/SupportRequestDialog";
import { toast } from "sonner";
import {
  fetchMySupportTickets,
  fetchSupportTicket,
  postSupportMessage,
  type SupportMessage,
  type SupportTicket,
  type SupportTicketStatus,
} from "@/api";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<SupportTicketStatus, string> = {
  open: "bg-blue-500/15 text-blue-400",
  in_progress: "bg-amber-500/15 text-amber-400",
  resolved: "bg-emerald-500/15 text-emerald-400",
  closed: "bg-muted text-muted-foreground",
};

export default function Support() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [active, setActive] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchMySupportTickets();
      setTickets(res.tickets);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openTicket = useCallback(async (t: SupportTicket) => {
    setActive(t);
    try {
      const res = await fetchSupportTicket(t.id);
      setMessages(res.messages);
      setActive(res.ticket);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, []);

  const sendReply = useCallback(async () => {
    if (!active || !reply.trim()) return;
    try {
      await postSupportMessage(active.id, reply.trim());
      setReply("");
      const res = await fetchSupportTicket(active.id);
      setMessages(res.messages);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, [active, reply]);

  return (
    <Page>
      <PageHeader
        title="Support"
        description="Hub issues go to administrators in-app; open-source bugs go to GitHub."
        actions={
          <SupportRequestDialog
            trigger={<Button>New request</Button>}
            onCreated={load}
          />
        }
      />

      <div className="grid gap-4 md:grid-cols-[320px_1fr]">
        <div className="flex flex-col gap-2">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : tickets.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">No requests yet</CardTitle>
                <CardDescription>
                  Submit a request and it will show up here.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <ul className="flex flex-col gap-1">
              {tickets.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => void openTicket(t)}
                    className={cn(
                      "flex w-full flex-col gap-1 rounded-md border px-3 py-2 text-left transition-colors hover:bg-accent/50",
                      active?.id === t.id ? "border-primary/40 bg-primary/5" : ""
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{t.subject}</span>
                      <Badge
                        variant="secondary"
                        className={cn("ml-auto text-[10px]", STATUS_TONE[t.status])}
                      >
                        {t.status}
                      </Badge>
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {t.updated_at}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          {active ? (
            <Card className="flex h-full flex-col">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">{active.subject}</CardTitle>
                  <Badge
                    variant="secondary"
                    className={cn("text-[10px]", STATUS_TONE[active.status])}
                  >
                    {active.status}
                  </Badge>
                </div>
                {active.category && (
                  <CardDescription>Category: {active.category}</CardDescription>
                )}
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-3">
                <div className="flex flex-col gap-2">
                  {messages.map((m) => (
                    <div
                      key={m.id}
                      className={cn(
                        "rounded-md border px-3 py-2 text-sm",
                        m.author_kind === "admin"
                          ? "bg-violet-500/5 border-violet-500/20"
                          : "bg-muted/40"
                      )}
                    >
                      <div className="mb-1 flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">
                          {m.author_kind}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {m.created_at}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap">{m.body}</p>
                    </div>
                  ))}
                </div>
                {active.status !== "closed" && (
                  <div className="mt-auto flex flex-col gap-2">
                    <Textarea
                      rows={3}
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      placeholder="Add a reply…"
                    />
                    <Button
                      className="self-end"
                      onClick={() => void sendReply()}
                      disabled={!reply.trim()}
                    >
                      Send
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Select a request</CardTitle>
                <CardDescription>
                  Choose a ticket on the left to view the conversation.
                </CardDescription>
              </CardHeader>
            </Card>
          )}
        </div>
      </div>
    </Page>
  );
}
