import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Shared className merge utility for plugin web bundles. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export { StructureTabGroupPage } from "../../../apps/web/src/components/StructureTabGroupPage.js";

/** Curated host shadcn presentational UI (same components as apps/web). */
export { Button, buttonVariants } from "../../../apps/web/src/components/ui/button.js";
export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
} from "../../../apps/web/src/components/ui/card.js";
export {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
} from "../../../apps/web/src/components/ui/empty.js";
export { Badge, badgeVariants } from "../../../apps/web/src/components/ui/badge.js";
export {
  Alert,
  AlertTitle,
  AlertDescription,
  AlertAction,
} from "../../../apps/web/src/components/ui/alert.js";
export { Separator } from "../../../apps/web/src/components/ui/separator.js";
export { Skeleton } from "../../../apps/web/src/components/ui/skeleton.js";
export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "../../../apps/web/src/components/ui/tabs.js";
