import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Optional classes for the description line (e.g. marketing uses text-base max-w-5xl). */
  descriptionClassName?: string;
}

export function PageHeader({
  title,
  description,
  actions,
  descriptionClassName,
}: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold">{title}</h1>
        {description && (
          <p
            className={cn(
              "text-sm text-muted-foreground",
              descriptionClassName
            )}
          >
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Page({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-7xl flex-col gap-6 p-6",
        className
      )}
    >
      {children}
    </div>
  );
}
