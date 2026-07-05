import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { createAuthTenant } from "@/api";
import { useTenant } from "@/lib/tenant-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CreateWorkspaceDialog({ trigger }: { trigger?: React.ReactNode }) {
  const { refresh, setTenant } = useTenant();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Project name required");
      return;
    }
    setBusy(true);
    try {
      const res = await createAuthTenant(trimmed);
      await refresh();
      setTenant(res.id);
      toast.success("Project created");
      setName("");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setBusy(false);
    }
  };

  const triggerButton =
    trigger ?? (
      <Button variant="outline" size="sm">
        <PlusIcon data-icon="inline-start" />
        New project
      </Button>
    );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <span
        role="presentation"
        onClick={() => setOpen(true)}
        onKeyDown={(e) => e.key === "Enter" && setOpen(true)}
      >
        {triggerButton}
      </span>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create project</DialogTitle>
          <DialogDescription>
            Spin up a fresh isolated project with its own agents and structure.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="workspace-name">Name</Label>
          <Input
            id="workspace-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My project"
          />
        </div>
        <DialogFooter>
          <Button onClick={() => void submit()} disabled={busy}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
