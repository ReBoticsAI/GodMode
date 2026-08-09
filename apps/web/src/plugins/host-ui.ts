/**
 * Curated shadcn/ui presentational surface for plugin web bundles.
 * Runtime is installed on __godmodePluginHost["@godmode/web-host"] and
 * re-exported via /plugin-shims/web-host.js so plugins share host instances.
 */
export { Button, buttonVariants } from "@/components/ui/button";
export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
export {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
} from "@/components/ui/empty";
export { Badge, badgeVariants } from "@/components/ui/badge";
export {
  Alert,
  AlertTitle,
  AlertDescription,
  AlertAction,
} from "@/components/ui/alert";
export { Separator } from "@/components/ui/separator";
export { Skeleton } from "@/components/ui/skeleton";
export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
