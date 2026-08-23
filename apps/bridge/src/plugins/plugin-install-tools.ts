import { perObjectTypeToolNames } from "@godmode/kernel";
import { listObjectTypes } from "../kernel/registry.js";

/**
 * Merge plugin runtime tool names with kernel-generated create/list tools for
 * ObjectTypes owned by the plugin (#670). Prove agents otherwise only see
 * runtime names and fall back to generic create_record / list_records.
 */
export function mergeInstallPluginTools(
  pluginId: string,
  runtimeTools: string[]
): { tools: string[]; preferToolsHint?: string } {
  const id = pluginId.trim();
  const generated: string[] = [];
  if (id) {
    for (const def of listObjectTypes()) {
      if (def.pluginId !== id) continue;
      const names = perObjectTypeToolNames(def.name);
      generated.push(names.create, names.list);
    }
  }
  const tools = [...new Set([...runtimeTools, ...generated])].sort();
  const preferred = [...new Set(generated)].sort();
  const preferToolsHint =
    preferred.length > 0
      ? `Prefer these generated ObjectType tools on first prove: ${preferred.join(", ")}. Do not use bare create_record/list_records for plugin business rows.`
      : undefined;
  return { tools, preferToolsHint };
}
