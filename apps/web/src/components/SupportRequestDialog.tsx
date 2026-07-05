import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createSupportTicket } from "@/api";

const GITHUB_ISSUES =
  "https://github.com/ReBoticsAI/GodMode/issues/new?template=bug_report.md";

export function SupportRequestDialog({
  trigger,
  onCreated,
}: {
  trigger: ReactNode;
  onCreated?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [targetKind, setTargetKind] = useState<"platform_github" | "resource_owner">(
    "platform_github"
  );
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!subject.trim()) {
      toast.error("Subject is required");
      return;
    }
    if (targetKind === "platform_github") {
      const params = new URLSearchParams();
      params.set("title", subject.trim());
      if (body.trim()) params.set("body", body.trim());
      window.open(`${GITHUB_ISSUES}&${params.toString()}`, "_blank", "noopener,noreferrer");
      setOpen(false);
      return;
    }
    setSubmitting(true);
    try {
      const res = await createSupportTicket({
        subject: subject.trim(),
        body: body.trim(),
        targetKind: "resource_owner",
        category: "shared_resource",
      });
      if (res.redirectUrl) {
        window.open(res.redirectUrl, "_blank", "noopener,noreferrer");
      } else {
        toast.success("Support request submitted to resource owner");
      }
      setOpen(false);
      setSubject("");
      setBody("");
      onCreated?.();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <span onClick={() => setOpen(true)} className="contents">
        {trigger}
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Submit a support request</DialogTitle>
            <DialogDescription>
              Platform bugs go to GitHub. Shared resource issues route to the resource owner.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select
                value={targetKind}
                onValueChange={(v) =>
                  setTargetKind(v as "platform_github" | "resource_owner")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="platform_github">GodMode platform (GitHub)</SelectItem>
                  <SelectItem value="resource_owner">Shared resource owner</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Subject</Label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Briefly describe the issue"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Details</Label>
              <Textarea
                rows={5}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="What happened? What did you expect?"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={submitting}>
              {targetKind === "platform_github" ? "Open GitHub issue" : "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
