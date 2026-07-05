import type { ReactNode } from "react";
import { WikiNav } from "@/components/wiki/WikiNav";

export function WikiLayout({
  currentSlug,
  onNewPage,
  children,
}: {
  currentSlug?: string;
  onNewPage?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-start">
      <WikiNav currentSlug={currentSlug} onNewPage={onNewPage} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
