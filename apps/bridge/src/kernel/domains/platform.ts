import type { BuiltinSpec } from "./shared.js";
import { NOTIFICATION_ACTIONS } from "../adapters/content.js";
import { PLATFORM_ACTION_METADATA } from "../adapters/platform-actions.js";

export const PLATFORM_SPECS: BuiltinSpec[] = [
  { name: "Notification", label: "Notification", module: "platform", id: "notification_service", table: "notifications", database: "core", scope: "tenant", scopeColumn: "recipient_tenant_id", defaultSort: "created_at", writable: ["recipient_kind", "recipient_id", "recipient_tenant_id", "category", "title", "body", "link", "resource_kind", "resource_id"], required: ["recipient_kind", "recipient_id", "title"], operations: ["list", "get", "create", "delete"], actions: NOTIFICATION_ACTIONS, fields: ["id", "recipient_kind", "recipient_id", "recipient_tenant_id", "category", "title", "body", "link", "resource_kind", "resource_id", "read_at", "created_at"] },
  { name: "ActionLog", label: "Action Log", module: "platform", id: "action_log_read", table: "platform_action_log", idColumn: "id", defaultSort: "created_at", fields: ["id", "agent_id", "action", "scope", "payload_hash", "result", "created_at"] },
  {
    name: "OperationRun",
    label: "Operation Run",
    module: "platform",
    id: "operation_run_service",
    table: "kernel_operation_runs",
    defaultSort: "updated_at",
    accessPolicy: "tenant-member",
    fields: ["id", "tenant_id", "actor_id", "object_type", "record_id", "action_name", "status", ["progress", "Float"], ["result_json", "JSON"], "error_code", "error_message", "created_at", "updated_at", "finished_at"],
    actions: [
      {
        name: "cancel",
        label: "Cancel",
        target: "record",
        effect: "write",
        execution: "sync",
        roles: ["owner", "intelligence"],
        confirmation: { required: true, ttlSeconds: 120 },
        inputSchema: { type: "object", additionalProperties: false },
      },
    ],
  },
  { name: "User", label: "User", module: "platform", id: "user_read", table: "users", database: "core", scope: "admin", fields: ["id", "email", "display_name", "avatar_url", ["is_admin", "Check"], "created_at", "updated_at"] },
  { name: "UserProfile", label: "User Profile", module: "platform", id: "user_profile_read", table: "user_profiles", database: "core", idColumn: "user_id", scope: "user", scopeColumn: "user_id", fields: ["id", "user_id", "headline", "bio", "pronouns", "location", "timezone", "company", "job_title", "website", "github", "linkedin", "created_at", "updated_at"] },
  { name: "Tenant", label: "Tenant", module: "platform", id: "tenant_read", table: "tenants", database: "core", scope: "tenant", scopeColumn: "id", fields: ["id", "name", "slug", ["is_operator", "Check"], "owner_user_id", "created_at", "updated_at"] },
  { name: "TenantMembership", label: "Tenant Membership", module: "platform", id: "tenant_membership_read", table: "tenant_memberships", database: "core", idColumn: "user_id", scope: "tenant", fields: ["id", "user_id", "tenant_id", "role", "created_at"] },
  { name: "ShareGrant", label: "Share Grant", module: "platform", id: "share_grant_read", table: "share_grants", database: "core", scope: "tenant", scopeColumn: "owner_tenant_id", defaultSort: "updated_at", writable: ["resource_kind", "resource_id", "grantee_user_id", "grantee_tenant_id", "role"], required: ["resource_kind", "resource_id"], operations: ["list", "get", "create", "delete"], actions: PLATFORM_ACTION_METADATA.ShareGrant, fields: ["id", "owner_tenant_id", "owner_user_id", "resource_kind", "resource_id", "grantee_user_id", "grantee_tenant_id", "role", "created_at", "updated_at"] },
];
