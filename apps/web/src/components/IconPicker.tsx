import { useMemo, useState } from "react";
import { CheckIcon, SearchIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ICON_NAMES, iconByName } from "@/lib/icon-lookup";
import { cn } from "@/lib/utils";

interface IconPickerProps {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  triggerLabel?: string;
}

export function IconPicker({
  value,
  onChange,
  className,
  triggerLabel,
}: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const Active = iconByName(value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ICON_NAMES;
    return ICON_NAMES.filter((n) => n.includes(q));
  }, [query]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className={cn("justify-start gap-2", className)}
          />
        }
      >
        <Active className="size-4 shrink-0" />
        <span className="truncate">{triggerLabel ?? value ?? "Choose icon"}</span>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Choose an icon</DialogTitle>
          <DialogDescription>
            Pick an icon for this department, division, or page.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 opacity-50" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search icons"
            className="pl-8"
          />
        </div>
        <ScrollArea className="max-h-72">
          <div className="grid grid-cols-6 gap-1 pr-2">
            {filtered.map((name) => {
              const Icon = iconByName(name);
              const active = name === value;
              return (
                <button
                  key={name}
                  type="button"
                  title={name}
                  onClick={() => {
                    onChange(name);
                    setOpen(false);
                  }}
                  className={cn(
                    "relative flex aspect-square items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                    active && "border-primary bg-accent text-foreground"
                  )}
                >
                  <Icon className="size-4" />
                  {active && (
                    <CheckIcon className="absolute right-0.5 top-0.5 size-3 text-primary" />
                  )}
                </button>
              );
            })}
            {filtered.length === 0 && (
              <p className="col-span-6 py-4 text-center text-xs text-muted-foreground">
                No icons match.
              </p>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
