import fs from "node:fs";
import path from "node:path";
import type { AppDatabase } from "../db.js";
import { config } from "../config.js";
import { getActiveRulesText } from "./ai-rules.js";
import { loadSkillBody } from "./ai-skills.js";
import { getHarnessPromptForTenant } from "./harness-prompt.js";
import { isOperatorTenantDb } from "./tenant-kind.js";

/** Skills forwarded to contractor CLI agents (same bootstrap set as Intelligence). */
export const CONTRACTOR_SKILL_IDS = [
  "platform-workspace",
  "platform-extension",
  "plugin-authoring",
  "platform-self-loop",
  "shadcn-ui",
] as const;

const PLUGIN_DOC_MAX = 12_000;
const CODING_HARNESS_MAX = 8_000;

/**
 * Rules, skills, harness, and docs bundle shared with Cursor/CLI contractor agents
 * so they build under the same plugin architecture as Intelligence.
 */
export function buildContractorContextBundle(
  db: AppDatabase,
  userTask: string
): string {
  const parts: string[] = [
    "# GodMode contractor context",
    "You are a contractor coding agent working on GodMode. Follow the same rules, skills, and plugin architecture as Intelligence.",
    "",
    "## Harness",
    getHarnessPromptForTenant("GodMode", isOperatorTenantDb(db), true),
    "",
    "## Active rules",
    getActiveRulesText(db, "intelligence") || "(none)",
  ];

  parts.push("", "## Skills");
  for (const skillId of CONTRACTOR_SKILL_IDS) {
    try {
      const body = loadSkillBody(db, skillId, "intelligence");
      if (body?.trim()) {
        parts.push(`### ${skillId}`, body.trim(), "");
      }
    } catch {
      /* skill not installed yet */
    }
  }

  const pluginDoc = path.join(config.repoRoot, "docs", "PLUGIN_AUTHORING.md");
  if (fs.existsSync(pluginDoc)) {
    const raw = fs.readFileSync(pluginDoc, "utf8");
    parts.push(
      "## PLUGIN_AUTHORING.md (excerpt)",
      raw.length > PLUGIN_DOC_MAX ? `${raw.slice(0, PLUGIN_DOC_MAX)}\n…` : raw,
      ""
    );
  }

  const codingHarnessDoc = path.join(config.repoRoot, "docs", "CODING_HARNESS.md");
  if (fs.existsSync(codingHarnessDoc)) {
    const raw = fs.readFileSync(codingHarnessDoc, "utf8");
    parts.push(
      "## CODING_HARNESS.md (excerpt)",
      raw.length > CODING_HARNESS_MAX ? `${raw.slice(0, CODING_HARNESS_MAX)}\n…` : raw,
      ""
    );
  }

  parts.push("## Task handoff", userTask.trim());
  return parts.join("\n");
}
