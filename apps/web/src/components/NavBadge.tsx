import { cn } from "@/lib/utils";

export function NavBadge({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "ml-auto shrink-0 rounded-full bg-primary px-1.5 text-[10px] font-medium text-primary-foreground",
        className
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
