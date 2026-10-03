/**
 * Public-channel agents: one ai_agents row per channel slug (channel-local, …).
 * Seeded on the operator tenant; bound into Users hub public conversations.
 */
import type { AppDatabase } from "../../db.js";
import {
  channelAgentIdForSlug,
  channelAgentSlugsForInstall,
} from "../public-channels.js";
import { createAgent, getAgent } from "./agents-db.js";

export {
  channelAgentIdForSlug,
  isChannelAgentId,
  slugFromChannelAgentId,
} from "../public-channels.js";

export function seedChannelAgents(db: AppDatabase): void {
  // Intelligence is the clone base for tooling defaults.
  if (!getAgent(db, "intelligence")) return;

  for (const slug of channelAgentSlugsForInstall()) {
    const id = channelAgentIdForSlug(slug);
    if (getAgent(db, id)) continue;
    const title = `#${slug}`;
    createAgent(db, {
      id,
      name: title,
      description:
        `${title} is the channel agent for this public lobby. ` +
        "Its Automations, Calendar, Knowledge, Bank, and Vault are shared " +
        "channel surfaces. Only channel Admins can edit them; everyone can look.",
      icon: "hash",
      team: "channel",
      parentId: "intelligence",
      config: {
        knowsUser: false,
        codeAccess: false,
        channelSlug: slug,
      },
    });
  }
}
