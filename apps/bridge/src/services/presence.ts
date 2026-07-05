import type { WsClientMeta } from "../ws-broker.js";

const onlineUsers = new Set<string>();

export function markUserOnline(userId: string | undefined): void {
  if (userId) onlineUsers.add(userId);
}

export function markUserOffline(userId: string | undefined): void {
  if (userId) onlineUsers.delete(userId);
}

export function isUserOnline(userId: string): boolean {
  return onlineUsers.has(userId);
}

/** Reconcile presence from active websocket clients (e.g. after reconnect). */
export function syncPresenceFromClients(clients: Iterable<WsClientMeta>): void {
  onlineUsers.clear();
  for (const client of clients) {
    if (client.userId && client.ws.readyState === 1) {
      onlineUsers.add(client.userId);
    }
  }
}
