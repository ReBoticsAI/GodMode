import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IconPicker } from "@/components/IconPicker";
import {
  createStructureNode,
  isValidStructureSlug,
  slugifyStructureId,
} from "@/api";

const ROOT_PARENT_VALUE = "__root__";

export interface StructureCreateOption {
  id: string;
  label: string;
  /** Indentation depth for nested display in the parent picker. */
  depth: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Flattened existing pages used to pick a parent. */
  parentOptions: StructureCreateOption[];
  /** Pre-selected parent (the currently selected page), or null for top-level. */
  initialParentId: string | null;
  onCreated: (nodeId: string) => void;
}

export function StructureCreateDialog({
  open,
  onOpenChange,
  parentOptions,
  initialParentId,
  onCreated,
}: Props) {
  const [parentId, setParentId] = useState<string | null>(initialParentId);
  const [label, setLabel] = useState("");
  const [id, setId] = useState("");
  const [segment, setSegment] = useState("");
  const [icon, setIcon] = useState("file");
  const [busy, setBusy] = useState(false);
  const [touchedId, setTouchedId] = useState(false);
  const [touchedSeg, setTouchedSeg] = useState(false);

  useEffect(() => {
    if (!open) return;
    setParentId(initialParentId);
    setLabel("");
    setId("");
    setSegment("");
    setIcon("file");
    setTouchedId(false);
    setTouchedSeg(false);
  }, [open, initialParentId]);

  const segValid = segment === "" || /^[a-z0-9-]+$/.test(segment);
  const canSubmit = Boolean(label.trim()) && isValidStructureSlug(id) && segValid;

  const submit = async () => {
    setBusy(true);
    try {
      const node = await createStructureNode({
        id,
        parentId,
        label,
        icon,
        segment: segment || undefined,
      });
      onCreated(node.id);
      toast.success("Page created");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add page</DialogTitle>
          <DialogDescription>
            Create a page, then connect nodes in the graph to build the hierarchy.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label>Parent</Label>
            <Select
              value={parentId ?? ROOT_PARENT_VALUE}
              onValueChange={(v) => setParentId(v === ROOT_PARENT_VALUE ? null : v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={ROOT_PARENT_VALUE}>None (top-level)</SelectItem>
                  {parentOptions.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {`${"\u00A0\u00A0".repeat(o.depth)}${o.label}`}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1">
            <Label htmlFor="struct-label">Label</Label>
            <Input
              id="struct-label"
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                if (!touchedId) setId(slugifyStructureId(e.target.value));
                if (!touchedSeg) setSegment(slugifyStructureId(e.target.value));
              }}
              placeholder="Analytics"
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="struct-id">ID</Label>
            <Input
              id="struct-id"
              value={id}
              onChange={(e) => {
                setTouchedId(true);
                setId(e.target.value);
              }}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="struct-segment">URL segment</Label>
            <Input
              id="struct-segment"
              value={segment}
              onChange={(e) => {
                setTouchedSeg(true);
                setSegment(e.target.value);
              }}
            />
          </div>
          <div className="grid gap-1">
            <Label>Icon</Label>
            <IconPicker value={icon} onChange={setIcon} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !canSubmit}>
            {busy ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
