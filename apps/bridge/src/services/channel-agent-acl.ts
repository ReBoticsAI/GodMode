/**
 * Gate writes to channel-* agent surfaces (vault, profile, automations, …).
 */
import { getHostUsersDb } from "../host-users-db.js";
import {
  assertCanEditChannelAgentContent,
  DmError,
} from "./dm-service.js";
import { isChannelAgentId } from "./public-channels.js";

export function assertChannelAgentWriteAllowed(
  userId: string | undefined,
  agentId: string | null | undefined
): void {
  if (!agentId || !isChannelAgentId(agentId)) return;
  if (!userId) {
    throw new DmError("Authentication required to edit channel agent content", 401);
  }
  assertCanEditChannelAgentContent(getHostUsersDb(), userId, agentId);
}

export function channelAgentWriteForbiddenMessage(err: unknown): string | null {
  if (err instanceof DmError) return err.message;
  return null;
}
