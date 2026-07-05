import { ExternalLinkIcon, Share2Icon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { shareDmResource, type DmAttachment, type DmMessage } from "@/api";

interface MessageBubbleProps {
  message: DmMessage;
  isOwn: boolean;
  conversationId: string;
  showShareAccess?: boolean;
}

function AttachmentChip({
  att,
  conversationId,
  showShareAccess,
}: {
  att: DmAttachment;
  conversationId: string;
  showShareAccess?: boolean;
}) {
  const navigate = useNavigate();

  if (att.kind === "image" && att.href) {
    return (
      <a href={att.href} target="_blank" rel="noreferrer" className="block max-w-xs">
        <img
          src={att.href}
          alt={att.label ?? "image"}
          className="rounded-md border max-h-48 object-cover"
        />
      </a>
    );
  }

  if (att.kind === "file" && att.href) {
    return (
      <a
        href={att.href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
      >
        <ExternalLinkIcon className="size-3" />
        {att.label ?? "Download file"}
      </a>
    );
  }

  if (att.kind === "resource_ref") {
    const share = async () => {
      if (!att.resourceKind || !att.resourceId) return;
      try {
        await shareDmResource(conversationId, {
          resourceKind: att.resourceKind,
          resourceId: att.resourceId,
          role: "viewer",
        });
        toast.success(`Shared access to ${att.label ?? "resource"}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Share failed");
      }
    };

    return (
      <div className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-xs">
        <button
          type="button"
          className="inline-flex items-center gap-1 hover:underline"
          onClick={() => att.href && navigate(att.href)}
        >
          <ExternalLinkIcon className="size-3" />
          {att.label ?? att.resourceKind ?? "Link"}
        </button>
        {showShareAccess && att.resourceKind && att.resourceId ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            title="Share access with conversation members"
            onClick={() => void share()}
          >
            <Share2Icon className="size-3" />
          </Button>
        ) : null}
      </div>
    );
  }

  return null;
}

export function MessageBubble({
  message,
  isOwn,
  conversationId,
  showShareAccess,
}: MessageBubbleProps) {
  return (
    <div className={cn("flex flex-col gap-1", isOwn ? "items-end" : "items-start")}>
      {!isOwn ? (
        <span className="text-[10px] text-muted-foreground px-1">
          {message.senderKind === "agent"
            ? message.senderAgent?.name ?? "Agent"
            : message.sender?.displayName ?? "User"}
        </span>
      ) : null}
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
          isOwn ? "bg-primary text-primary-foreground" : "bg-muted"
        )}
      >
        {message.bodyText ? (
          <p className="whitespace-pre-wrap break-words">{message.bodyText}</p>
        ) : null}
        {message.attachments.length > 0 ? (
          <div className="mt-2 flex flex-col gap-2">
            {message.attachments.map((att) => (
              <AttachmentChip
                key={att.id}
                att={att}
                conversationId={conversationId}
                showShareAccess={showShareAccess && isOwn}
              />
            ))}
          </div>
        ) : null}
      </div>
      <span className="text-[10px] text-muted-foreground px-1">
        {new Date(message.createdAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>
    </div>
  );
}
