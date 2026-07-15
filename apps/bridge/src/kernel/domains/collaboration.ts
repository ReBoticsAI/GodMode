import type { BuiltinSpec } from "./shared.js";
import { PLATFORM_ACTION_METADATA } from "../adapters/platform-actions.js";

export const COLLABORATION_SPECS: BuiltinSpec[] = [
  { name: "DirectConversation", label: "Direct Conversation", module: "messages", id: "dm_conversation_read", table: "dm_conversations", database: "core", defaultSort: "updated_at", accessPolicy: "relationship-scoped", writable: ["kind", "title", "member_user_ids"], operations: ["list", "get", "create"], actions: PLATFORM_ACTION_METADATA.DirectConversation, fields: ["id", "kind", "title", ["member_user_ids", "JSON"], "created_by_user_id", "created_at", "updated_at", "last_message_at", "last_message_preview"] },
  { name: "DirectMessage", label: "Direct Message", module: "messages", id: "dm_message_read", table: "dm_messages", database: "core", defaultSort: "created_at", accessPolicy: "relationship-scoped", writable: ["conversation_id", "body_text", "attachments"], required: ["conversation_id"], operations: ["list", "get", "create"], actions: PLATFORM_ACTION_METADATA.DirectMessage, fields: ["id", "conversation_id", "sender_user_id", "body_text", ["attachments", "JSON"], "created_at", "edited_at", "deleted_at"] },
];
