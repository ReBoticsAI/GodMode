import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Clickable chat/composer image thumbnail with a full-size lightbox. */
export function ChatAttachmentImage({
  src,
  alt = "attachment",
  className,
  thumbClassName,
}: {
  src: string;
  alt?: string;
  className?: string;
  /** Classes for the thumbnail img (defaults to size-16 chat bubble). */
  thumbClassName?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={cn(
          "block overflow-hidden rounded-md border border-border/60 text-left transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className
        )}
        aria-label={`View ${alt}`}
        title="View full size"
        onClick={() => setOpen(true)}
      >
        <img
          src={src}
          alt={alt}
          className={cn("size-16 object-cover", thumbClassName)}
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="flex h-[min(96vh,100%)] w-[min(96vw,100%)] max-w-none flex-col gap-0 overflow-hidden p-2 sm:max-w-none"
          aria-describedby={undefined}
        >
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          <img
            src={src}
            alt={alt}
            className="mx-auto my-auto max-h-full max-w-full object-contain"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
