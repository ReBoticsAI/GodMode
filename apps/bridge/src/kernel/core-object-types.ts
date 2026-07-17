import type { ObjectTypeDef } from "@godmode/kernel";
import {
  getRecordAdapter,
  hasRecordAdapter,
  registerRecordAdapter,
  type RecordAdapter,
} from "./adapter-registry.js";
import { createSqlReadAdapter } from "./adapters/sql-read.js";
import {
  agentServiceAdapter,
  assignmentServiceAdapter,
  hookServiceAdapter,
  hookRunServiceAdapter,
  scheduleServiceAdapter,
  wikiPageServiceAdapter,
  wikiRevisionServiceAdapter,
  workflowCommentServiceAdapter,
  workflowServiceAdapter,
  workflowRunServiceAdapter,
} from "./adapters/core-services.js";
import {
  calendarEventServiceAdapter,
  cardCommentServiceAdapter,
  taskCardServiceAdapter,
} from "./adapters/productivity.js";
import { operationRunAdapter } from "./adapters/operation-runs.js";
import { releaseAdapters } from "./adapters/release.js";
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
import { identityAdminAdapters } from "./adapters/identity-admin.js";
import { platformConfigAdapters } from "./adapters/platform-config.js";
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
import { structureNodeAdapter } from "./adapters/structure-node.js";
import { listObjectTypes, registerObjectType } from "./registry.js";

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

export const CORE_OBJECT_TYPE_NAMES = [
  "Notification",
  "Artifact",
  "WorkflowRun",
  "WorkflowComment",
  "HookRun",
  "PlatformEvent",
  "ActionLog",
  "OperationRun",
  "Release",
  "InstallationUpdateState",
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
  "UserCredential",
  "Tenant",
  "TenantMembership",
  "TenantProvisioningRun",
  "PlatformBillingConfig",
  "TenantOnboardingConfig",
  "ShareGrant",
  "MarketplaceListing",
  "MarketplaceEntitlement",
  "MarketplaceOrder",
  "MarketplaceSellerAccount",
  "CatalogSource",
  "CatalogInstall",
  "BridgeConnection",
  "PeerConnection",
  "InferenceEndpoint",
  "SupportTicket",
  "SupportMessage",
  "DirectConversation",
  "DirectMessage",
  "DmBlob",
  "FederatedShareInvite",
  "PlatformGroup",
  "PlatformGroupMember",
  "ChatSession",
  "ChatMessage",
  "ModelAdapter",
  "EmbeddingRuntime",
  "CapabilityIndex",
  "IntelligenceSettings",
  "PromptFlow",
  "VaultSecret",
  "ProviderCredential",
  "ModelRuntime",
  "PromptQueueJob",
  "Dataset",
  "MemoryMaintenance",
  "AutonomousRuntime",
  "TrainingJob",
  "InferenceRuntime",
  "IntegrationRuntime",
] as const;

const SPECS_BY_NAME = new Map(DOMAIN_SPECS.map((spec) => [spec.name, spec]));
if (
  SPECS_BY_NAME.size !== DOMAIN_SPECS.length ||
  SPECS_BY_NAME.size !== CORE_OBJECT_TYPE_NAMES.length ||
  CORE_OBJECT_TYPE_NAMES.some((name) => !SPECS_BY_NAME.has(name))
) {
  throw new Error(
    "Core ObjectType declaration set does not exactly match the production registration set"
  );
}
const SPECS = CORE_OBJECT_TYPE_NAMES.map((name) => {
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
    workflowCommentServiceAdapter,
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
    ...releaseAdapters,
    artifactServiceAdapter,
    memoryServiceAdapter,
    notificationServiceAdapter,
    reflectionProposalServiceAdapter,
    ruleServiceAdapter,
    skillServiceAdapter,
    wikiProposalServiceAdapter,
    ...identityAdminAdapters,
    ...platformConfigAdapters,
    ...platformActionAdapters,
    ...runtimeAdapters,
  ].map((adapter) => [adapter.id, adapter])
);

const RECORD_OPERATIONS = [
  "list",
  "get",
  "create",
  "update",
  "delete",
] as const;

function assertAdapterParity(def: ObjectTypeDef, adapter: RecordAdapter): void {
  const declaredOperations = [...(def.operations ?? [])].sort();
  const implementedOperations = RECORD_OPERATIONS.filter(
    (operation) => typeof adapter[operation] === "function"
  ).sort();
  if (
    declaredOperations.length !== implementedOperations.length ||
    declaredOperations.some(
      (operation, index) => operation !== implementedOperations[index]
    )
  ) {
    throw new Error(
      `ObjectType ${def.name} operation parity mismatch for adapter ${adapter.id}: declared [${declaredOperations.join(", ")}], implemented [${implementedOperations.join(", ")}]`
    );
  }
  const declaredActions = (def.actions ?? [])
    .map((action) => action.name)
    .sort();
  const implementedActions = Object.keys(adapter.actions ?? {}).sort();
  if (
    declaredActions.length !== implementedActions.length ||
    declaredActions.some(
      (action, index) => action !== implementedActions[index]
    )
  ) {
    throw new Error(
      `ObjectType ${def.name} action parity mismatch for adapter ${adapter.id}: declared [${declaredActions.join(", ")}], implemented [${implementedActions.join(", ")}]`
    );
  }
}

export function assertCoreObjectTypeBootstrapComplete(): void {
  const definitions = listObjectTypes().filter((def) => !def.pluginId);
  const expectedNames = ["StructureNode", ...CORE_OBJECT_TYPE_NAMES].sort();
  const actualNames = definitions.map((def) => def.name).sort();
  if (
    expectedNames.length !== actualNames.length ||
    expectedNames.some((name, index) => name !== actualNames[index])
  ) {
    throw new Error(
      `Core ObjectType bootstrap mismatch: expected [${expectedNames.join(", ")}], registered [${actualNames.join(", ")}]`
    );
  }
  for (const def of definitions) {
    if (def.storage.kind !== "adapter") {
      throw new Error(`Core ObjectType ${def.name} is not adapter-backed`);
    }
    const adapter = getRecordAdapter(def.storage.adapterId);
    if (!adapter) {
      throw new Error(
        `Core ObjectType ${def.name} has no registered adapter ${def.storage.adapterId}`
      );
    }
    assertAdapterParity(def, adapter);
  }
}

export function registerCoreObjectTypes(): void {
  if (registered) {
    assertCoreObjectTypeBootstrapComplete();
    return;
  }
  if (!hasRecordAdapter(structureNodeAdapter.id)) {
    registerRecordAdapter(structureNodeAdapter);
  }
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
    assertAdapterParity(def, adapter);
    registerRecordAdapter(adapter);
    registerObjectType(def);
  }
  registered = true;
  assertCoreObjectTypeBootstrapComplete();
}
