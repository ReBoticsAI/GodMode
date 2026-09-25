import { BotIcon, BrainIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Digital You: the person on the left, the agent on the right. */
export function DigitalYouIcon({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative inline-grid size-8 shrink-0 grid-cols-2 overflow-hidden text-foreground/70",
        className
      )}
      aria-hidden
    >
      <span className="relative overflow-hidden">
        <BrainIcon className="absolute top-0 left-0 size-[200%] max-w-none" />
      </span>
      <span className="relative overflow-hidden">
        <BotIcon className="absolute top-0 right-0 size-[200%] max-w-none" />
      </span>
      <span className="pointer-events-none absolute inset-y-0.5 left-1/2 w-px -translate-x-1/2 bg-current opacity-50" />
    </span>
  );
}
