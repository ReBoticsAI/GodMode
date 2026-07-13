import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SupportRequestDialog } from "@/components/SupportRequestDialog";
import { toast } from "sonner";
import {
  fetchMySupportTickets,
  fetchStaffSupportTickets,
  fetchSupportGroup,
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
  const [searchParams, setSearchParams] = useSearchParams();
  const inboxParam = searchParams.get("inbox") === "staff" ? "staff" : "mine";
  const [inbox, setInbox] = useState<"mine" | "staff">(inboxParam);
  const [isStaff, setIsStaff] = useState(false);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [active, setActive] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchSupportGroup()
      .then((r) => setIsStaff(Boolean(r.isMember)))
      .catch(() => setIsStaff(false));
  }, []);

  useEffect(() => {
    setInbox(inboxParam);
  }, [inboxParam]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res =
        inbox === "staff"
          ? await fetchStaffSupportTickets()
          : await fetchMySupportTickets();
      setTickets(res.tickets);
    } catch (err) {
      if (inbox === "staff") {
        setIsStaff(false);
        setInbox("mine");
        toast.error("Staff inbox requires Support group membership");
      } else {
        toast.error((err as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }, [inbox]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const ticketId = searchParams.get("ticket");
    if (!ticketId) return;
    void fetchSupportTicket(ticketId)
      .then((res) => {
        setActive(res.ticket);
        setMessages(res.messages);
      })
      .catch((err) => toast.error((err as Error).message));
  }, [searchParams]);

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
        description="Hub issues go to administrators and the Support group; open-source bugs go to GitHub."
        actions={
          <SupportRequestDialog
            trigger={<Button>New request</Button>}
            onCreated={load}
          />
        }
      />

      <Tabs
        value={inbox}
        onValueChange={(v) => {
          const next = v === "staff" ? "staff" : "mine";
          setInbox(next);
          setActive(null);
          setMessages([]);
          setSearchParams(next === "staff" ? { inbox: "staff" } : {}, { replace: true });
        }}
        className="mb-4"
      >
        <TabsList variant="line">
          <TabsTrigger value="mine">My requests</TabsTrigger>
          {isStaff ? <TabsTrigger value="staff">Staff inbox</TabsTrigger> : null}
        </TabsList>
        <TabsContent value={inbox} className="mt-4">
          <div className="grid gap-4 md:grid-cols-[320px_1fr]">
            <div className="flex flex-col gap-2">
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : tickets.length === 0 ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      {inbox === "staff" ? "No staff tickets" : "No requests yet"}
                    </CardTitle>
                    <CardDescription>
                      {inbox === "staff"
                        ? "Hub and shared-resource tickets appear here for Support group members."
                        : "Submit a request and it will show up here."}
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
                    <div className="flex max-h-80 flex-col gap-2 overflow-y-auto rounded-md border p-3">
                      {messages.map((m) => (
                        <div key={m.id} className="text-sm">
                          <div className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                            {m.author_kind} · {m.created_at}
                          </div>
                          <p className="whitespace-pre-wrap">{m.body}</p>
                        </div>
                      ))}
                    </div>
                    <Textarea
                      rows={3}
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      placeholder="Write a reply…"
                    />
                    <Button onClick={() => void sendReply()} disabled={!reply.trim()}>
                      Send reply
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Select a ticket</CardTitle>
                    <CardDescription>
                      Choose a request on the left to view the thread.
                    </CardDescription>
                  </CardHeader>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </Page>
  );
}
