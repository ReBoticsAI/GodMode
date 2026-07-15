import type { ObjectTypeDef } from "@godmode/kernel";
import { registerRecordAdapter } from "./adapter-registry.js";
import { createSqlReadAdapter } from "./adapters/sql-read.js";
import {
  agentServiceAdapter,
  assignmentServiceAdapter,
  hookServiceAdapter,
  hookRunServiceAdapter,
  scheduleServiceAdapter,
  wikiPageServiceAdapter,
  wikiRevisionServiceAdapter,
  workflowServiceAdapter,
  workflowRunServiceAdapter,
} from "./adapters/core-services.js";
import {
  calendarEventServiceAdapter,
  cardCommentServiceAdapter,
  taskCardServiceAdapter,
} from "./adapters/productivity.js";
import { operationRunAdapter } from "./adapters/operation-runs.js";
import {
  artifactServiceAdapter,
  memoryServiceAdapter,
  notificationServiceAdapter,
  reflectionProposalServiceAdapter,
  ruleServiceAdapter,
  skillServiceAdapter,
  wikiProposalServiceAdapter,
} from "./adapters/content.js";
import { platformActionAdapters } from "./adapters/platform-actions.js";
import { AUTOMATION_SPECS } from "./domains/automation.js";
import { COLLABORATION_SPECS } from "./domains/collaboration.js";
import { CONNECTIVITY_SUPPORT_SPECS } from "./domains/connectivity-support.js";
import { FINANCE_SPECS } from "./domains/finance.js";
import { INTELLIGENCE_SPECS } from "./domains/intelligence.js";
import { KNOWLEDGE_SPECS } from "./domains/knowledge.js";
import { MARKETPLACE_SPECS } from "./domains/marketplace.js";
import { PLATFORM_SPECS } from "./domains/platform.js";
import { PRODUCTIVITY_SPECS } from "./domains/productivity.js";
import { RUNTIME_SPECS } from "./domains/runtime.js";
import {
  buildFields,
  READ_PERMISSIONS,
  WRITE_PERMISSIONS,
  type BuiltinSpec,
} from "./domains/shared.js";
import { runtimeAdapters } from "./adapters/runtime.js";
import { registerObjectType } from "./registry.js";

const DOMAIN_SPECS: BuiltinSpec[] = [
  ...PLATFORM_SPECS,
  ...INTELLIGENCE_SPECS,
  ...PRODUCTIVITY_SPECS,
  ...KNOWLEDGE_SPECS,
  ...AUTOMATION_SPECS,
  ...COLLABORATION_SPECS,
  ...MARKETPLACE_SPECS,
  ...FINANCE_SPECS,
  ...CONNECTIVITY_SUPPORT_SPECS,
  ...RUNTIME_SPECS,
];

const SPEC_REGISTRATION_ORDER = [
  "Notification",
  "Artifact",
  "WorkflowRun",
  "HookRun",
  "PlatformEvent",
  "ActionLog",
  "OperationRun",
  "FinanceConnection",
  "BalanceSnapshot",
  "BankLedgerEntry",
  "Project",
  "ProjectColumn",
  "TaskCard",
  "CardComment",
  "CalendarEvent",
  "WikiPage",
  "WikiRevision",
  "WikiProposal",
  "Rule",
  "Skill",
  "PromptTemplate",
  "Memory",
  "KnowledgePack",
  "ReflectionProposal",
  "Agent",
  "AgentAssignment",
  "Workflow",
  "Schedule",
  "Hook",
  "User",
  "UserProfile",
  "Tenant",
  "TenantMembership",
  "ShareGrant",
  "MarketplaceListing",
  "MarketplaceEntitlement",
  "CatalogSource",
  "CatalogInstall",
  "BridgeConnection",
  "PeerConnection",
  "InferenceEndpoint",
  "SupportTicket",
  "SupportMessage",
  "DirectConversation",
  "DirectMessage",
  "ChatSession",
  "ChatMessage",
  "ModelRuntime",
  "PromptQueueJob",
  "Dataset",
  "TrainingJob",
  "InferenceRuntime",
  "IntegrationRuntime",
] as const;

const SPECS_BY_NAME = new Map(DOMAIN_SPECS.map((spec) => [spec.name, spec]));
const SPECS = SPEC_REGISTRATION_ORDER.map((name) => {
  const spec = SPECS_BY_NAME.get(name);
  if (!spec) throw new Error(`Missing core object type spec: ${name}`);
  return spec;
});

let registered = false;

const SERVICE_ADAPTERS = new Map(
  [
    agentServiceAdapter,
    assignmentServiceAdapter,
    workflowServiceAdapter,
    workflowRunServiceAdapter,
    scheduleServiceAdapter,
    hookServiceAdapter,
    hookRunServiceAdapter,
    wikiPageServiceAdapter,
    wikiRevisionServiceAdapter,
    taskCardServiceAdapter,
    cardCommentServiceAdapter,
    calendarEventServiceAdapter,
    operationRunAdapter,
    artifactServiceAdapter,
    memoryServiceAdapter,
    notificationServiceAdapter,
    reflectionProposalServiceAdapter,
    ruleServiceAdapter,
    skillServiceAdapter,
    wikiProposalServiceAdapter,
    ...platformActionAdapters,
    ...runtimeAdapters,
  ].map((adapter) => [adapter.id, adapter])
);

export function registerCoreObjectTypes(): void {
  if (registered) return;
  for (const spec of SPECS) {
    let objectFields = buildFields(
      spec.fields,
      new Set(spec.writable ?? []),
      new Set(spec.required ?? [])
    );
    if (spec.name === "CalendarEvent") {
      objectFields = objectFields.map((field) =>
        field.name === "kind"
          ? {
              ...field,
              fieldType: "Select",
              options: ["event", "task", "appointment"],
            }
          : field
      );
    }
    if (spec.name === "Agent") {
      objectFields = objectFields.map((field) =>
        field.name === "backend"
          ? {
              ...field,
              fieldType: "Select",
              options: [
                "local",
                "provider",
                "cli",
                "acp",
                "remote",
                "cursor",
                "cursor_cloud",
              ],
            }
          : field
      );
    }
    const def: ObjectTypeDef = {
      name: spec.name,
      label: spec.label,
      labelPlural: `${spec.label}s`,
      module: spec.module,
      accessPolicy:
        spec.accessPolicy ??
        (spec.scope === "admin"
          ? "platform-admin"
          : spec.scope === "user"
            ? "user-private"
            : spec.scope === "tenant"
              ? "tenant-member"
              : spec.database === "core"
                ? "relationship-scoped"
                : "tenant-local"),
      database: spec.database ?? "tenant",
      storage: { kind: "adapter", adapterId: spec.id },
      fields: objectFields,
      contractVersion: 1,
      permissions:
        spec.permissions ??
        (spec.writable ? WRITE_PERMISSIONS : READ_PERMISSIONS),
      operations:
        spec.operations ??
        (spec.writable
          ? ["list", "get", "create", "update", "delete"]
          : ["list", "get"]),
      schemaVersion: 1,
      actions: spec.actions,
    };
    const adapter =
      SERVICE_ADAPTERS.get(spec.id) ?? createSqlReadAdapter(spec);
    for (const operation of def.operations ?? []) {
      if (typeof adapter[operation] !== "function") {
        throw new Error(
          `ObjectType ${def.name} declares ${operation} but adapter ${adapter.id} does not implement it`
        );
      }
    }
    for (const action of def.actions ?? []) {
      if (typeof adapter.actions?.[action.name] !== "function") {
        throw new Error(
          `ObjectType ${def.name} declares action ${action.name} but adapter ${adapter.id} does not implement it`
        );
      }
    }
    registerRecordAdapter(adapter);
    registerObjectType(def);
  }
  registered = true;
}
