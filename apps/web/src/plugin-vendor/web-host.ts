/**
 * Host singletons for plugin web bundles in Vite DEV
 * (import map → this file). Production uses `/plugin-shims/web-host.js`.
 */
export { cn } from "../../../../packages/web-host/src/index";
export { StructureTabGroupPage } from "@/components/StructureTabGroupPage";
export { pageElementFor } from "@/lib/page-registry";
export { webPluginRuntime } from "@/plugins/runtime";
