import type { BuiltinSpec } from "./shared.js";
import type { ActionDef } from "@godmode/kernel";

const ownerRoles = ["owner", "intelligence"] as const;
const emptyInput = { type: "object", additionalProperties: false };

const WORKFLOW_ACTIONS: ActionDef[] = [
  { name: "run", label: "Run", target: "record", effect: "external", execution: "sync", roles: [...ownerRoles], confirmation: { required: true }, idempotency: { required: true }, inputSchema: { type: "object", properties: { trigger_input: { type: "string" }, card_id: { type: "string" } }, additionalProperties: false } },
];
const WORKFLOW_RUN_ACTIONS: ActionDef[] = [
  { name: "resume", label: "Resume", target: "record", effect: "external", execution: "sync", roles: [...ownerRoles], confirmation: { required: true }, idempotency: { required: true }, inputSchema: { type: "object", properties: { decision: { enum: ["approve", "request_changes"] }, comments: { type: "string" } }, additionalProperties: false } },
  { name: "cancel", label: "Cancel", target: "record", effect: "destructive", execution: "sync", roles: [...ownerRoles], confirmation: { required: true }, inputSchema: emptyInput },
];
const TOGGLE_ACTIONS: ActionDef[] = [
  { name: "enable", label: "Enable", target: "record", effect: "external", execution: "sync", roles: [...ownerRoles], confirmation: { required: true }, inputSchema: emptyInput },
  { name: "disable", label: "Disable", target: "record", effect: "write", execution: "sync", roles: [...ownerRoles], inputSchema: emptyInput },
];
const HOOK_RUN_ACTIONS: ActionDef[] = [
  { name: "approve", label: "Approve", target: "record", effect: "external", execution: "async", cancellable: false, roles: [...ownerRoles], confirmation: { required: true }, idempotency: { required: true }, inputSchema: emptyInput },
  { name: "reject", label: "Reject", target: "record", effect: "destructive", execution: "sync", roles: [...ownerRoles], confirmation: { required: true }, idempotency: { required: true }, inputSchema: emptyInput },
];

export const AUTOMATION_SPECS: BuiltinSpec[] = [
  { name: "WorkflowRun", label: "Workflow Run", module: "automation", id: "workflow_run_read", table: "ai_workflow_runs", defaultSort: "updated_at", actions: WORKFLOW_RUN_ACTIONS, fields: ["id", "workflow_id", "status", "trigger_input", ["state_json", "JSON"], "awaiting_node_id", "card_id", ["result_json", "JSON"], "error", "created_at", "updated_at"] },
  { name: "WorkflowComment", label: "Workflow Comment", module: "automation", id: "workflow_comment_service", table: "ai_workflow_comments", defaultSort: "created_at", writable: ["workflow_id", "author", "body"], required: ["workflow_id", "body"], operations: ["list", "get", "create", "delete"], fields: ["id", "workflow_id", "author", "body", "created_at"] },
  { name: "HookRun", label: "Hook Run", module: "automation", id: "hook_run_read", table: "hook_runs", database: "core", defaultSort: "created_at", actions: HOOK_RUN_ACTIONS, fields: ["id", "hook_id", "event_id", "status", "detail", ["result_json", "JSON"], "created_at"] },
  { name: "PlatformEvent", label: "Platform Event", module: "automation", id: "platform_event_read", table: "events", database: "core", scope: "tenant", defaultSort: "created_at", fields: ["id", "type", "actor_kind", "actor_id", "tenant_id", ["payload_json", "JSON"], "created_at"] },
  { name: "Workflow", label: "Workflow", module: "automation", id: "workflow_service", table: "ai_workflows", defaultSort: "updated_at", writable: ["agent_id", "name", "config_json", "enabled"], required: ["name"], operations: ["list", "get", "create", "update", "delete"], actions: WORKFLOW_ACTIONS, fields: ["id", "agent_id", "name", ["config_json", "JSON"], ["enabled", "Check"], "created_at", "updated_at"] },
  { name: "Schedule", label: "Schedule", module: "automation", id: "schedule_service", table: "ai_schedules", defaultSort: "updated_at", writable: ["workflow_id", "cron_expr", "timezone", "enabled"], required: ["workflow_id", "cron_expr"], actions: TOGGLE_ACTIONS, fields: ["id", "workflow_id", "cron_expr", "timezone", ["enabled", "Check"], "last_run_at", "created_at", "updated_at"] },
  { name: "Hook", label: "Hook", module: "automation", id: "hook_service", table: "hooks", database: "core", scope: "tenant", scopeColumn: "owner_tenant_id", defaultSort: "updated_at", writable: ["owner_kind", "owner_id", "owner_tenant_id", "name", "enabled", "trigger_kind", "event_type", "schedule_cron", "condition_json", "action_kind", "action_config_json", "require_approval"], required: ["owner_kind", "owner_id", "name", "trigger_kind", "action_kind"], operations: ["list", "get", "create", "update", "delete"], actions: TOGGLE_ACTIONS, fields: ["id", "owner_kind", "owner_id", "owner_tenant_id", "name", ["enabled", "Check"], "trigger_kind", "event_type", "schedule_cron", ["condition_json", "JSON"], "action_kind", ["action_config_json", "JSON"], ["require_approval", "Check"], "created_at", "updated_at", "last_fired_at"] },
];
