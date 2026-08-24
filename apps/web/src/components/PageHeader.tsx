import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: ReactNode;
  description?: string;
  actions?: ReactNode;
  /** Optional classes for the description line (e.g. marketing uses text-base max-w-5xl). */
  descriptionClassName?: string;
  /** Center the title block (logo + description) in the header row. */
  align?: "start" | "center";
}

export function PageHeader({
  title,
  description,
  actions,
  descriptionClassName,
  align = "start",
}: PageHeaderProps) {
  const centered = align === "center";
  return (
    <div
      className={cn(
        "flex flex-wrap gap-3 border-b pb-4",
        centered
          ? "items-center justify-center"
          : "items-end justify-between"
      )}
    >
      <div
        className={cn(
          "flex min-w-0 flex-col gap-1",
          centered && "w-full items-center text-center"
        )}
      >
        {typeof title === "string" ? (
          <h1 className="text-3xl font-bold">{title}</h1>
        ) : (
          <h1 className="flex justify-center">{title}</h1>
        )}
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
      {actions && (
        <div
          className={cn(
            "flex items-center gap-2",
            centered && "w-full justify-center"
          )}
        >
          {actions}
        </div>
      )}
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
