/**
 * Host singletons for plugin web bundles — must resolve to the same module
 * instances as the main app (import map → this file in dev).
 */
export { cn } from "@godmode/web-host";
export { StructureTabGroupPage } from "@/components/StructureTabGroupPage";
export { pageElementFor } from "@/lib/page-registry";
export { webPluginRuntime } from "@/plugins/runtime";
