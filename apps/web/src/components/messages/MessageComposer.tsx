import { useRef, useState } from "react";
import { ImageIcon, LinkIcon, PaperclipIcon, SendIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  uploadDmFile,
  type DmAttachmentInput,
  type DmBlobUpload,
} from "@/api";
import { useStructure } from "@/lib/structure-context";
import type { StructureNode } from "@/lib/navigation";

export interface PendingResourceRef {
  resourceKind: string;
  resourceId: string;
  label: string;
  href: string;
}

export interface ComposerPayload {
  bodyText: string;
  attachments: DmAttachmentInput[];
}

interface MessageComposerProps {
  onSend: (payload: ComposerPayload) => Promise<void>;
  disabled?: boolean;
}

function flattenNodes(nodes: StructureNode[]): StructureNode[] {
  const out: StructureNode[] = [];
  const walk = (list: StructureNode[]) => {
    for (const n of list) {
      if (n.path && n.kind !== "department") out.push(n);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

export function MessageComposer({ onSend, disabled }: MessageComposerProps) {
  const { nodes } = useStructure();
  const [text, setText] = useState("");
  const [blobs, setBlobs] = useState<DmBlobUpload[]>([]);
  const [refs, setRefs] = useState<PendingResourceRef[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const structureRefs = flattenNodes(nodes).slice(0, 40);

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      try {
        const blob = await uploadDmFile(file);
        setBlobs((prev) => [...prev, blob]);
      } catch {
        /* toast handled by caller if needed */
      }
    }
  };

  const handleSend = async () => {
    const bodyText = text.trim();
    if (!bodyText && blobs.length === 0 && refs.length === 0) return;
    setBusy(true);
    try {
      const attachments: DmAttachmentInput[] = [
        ...blobs.map((b) => ({
          kind: b.mime.startsWith("image/") ? ("image" as const) : ("file" as const),
          blobId: b.id,
          mime: b.mime,
          size: b.size,
        })),
        ...refs.map((r) => ({
          kind: "resource_ref" as const,
          resourceKind: r.resourceKind,
          resourceId: r.resourceId,
          label: r.label,
          href: r.href,
        })),
      ];
      await onSend({ bodyText, attachments });
      setText("");
      setBlobs([]);
      setRefs([]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t p-3 space-y-2">
      {(blobs.length > 0 || refs.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {blobs.map((b) => (
            <span
              key={b.id}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs"
            >
              {b.filename}
              <button
                type="button"
                onClick={() => setBlobs((prev) => prev.filter((x) => x.id !== b.id))}
              >
                <XIcon className="size-3" />
              </button>
            </span>
          ))}
          {refs.map((r) => (
            <span
              key={`${r.resourceKind}:${r.resourceId}`}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs"
            >
              {r.label}
              <button
                type="button"
                onClick={() =>
                  setRefs((prev) =>
                    prev.filter(
                      (x) =>
                        !(x.resourceId === r.resourceId && x.resourceKind === r.resourceKind)
                    )
                  )
                }
              >
                <XIcon className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2 items-end">
        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => fileRef.current?.click()}
            disabled={disabled || busy}
          >
            <PaperclipIcon className="size-4" />
          </Button>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            multiple
            accept="image/*,.pdf,.txt,.csv,.json"
            onChange={(e) => void addFiles(e.target.files)}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => fileRef.current?.click()}
            disabled={disabled || busy}
            title="Upload image"
          >
            <ImageIcon className="size-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex size-8 items-center justify-center rounded-md hover:bg-muted disabled:opacity-50"
              disabled={disabled || busy}
              title="Link platform resource"
            >
              <LinkIcon className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
              {structureRefs.map((n) => (
                <DropdownMenuItem
                  key={n.id}
                  onClick={() =>
                    setRefs((prev) => {
                      if (prev.some((r) => r.resourceId === n.id)) return prev;
                      return [
                        ...prev,
                        {
                          resourceKind: n.kind === "division" ? "division" : "page",
                          resourceId: n.id,
                          label: n.label,
                          href: n.path,
                        },
                      ];
                    })
                  }
                >
                  {n.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message…"
          className="min-h-[40px] max-h-32 resize-none"
          rows={1}
          disabled={disabled || busy}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
        />
        <Button
          type="button"
          size="icon"
          className="size-9 shrink-0"
          disabled={disabled || busy}
          onClick={() => void handleSend()}
        >
          <SendIcon className="size-4" />
        </Button>
      </div>
    </div>
  );
}
