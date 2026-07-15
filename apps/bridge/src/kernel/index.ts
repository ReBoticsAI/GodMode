export {
  registerObjectType,
  registerObjectTypes,
  replaceObjectTypesByPlugin,
  unregisterObjectType,
  getObjectType,
  listObjectTypes,
  hasObjectType,
  bootstrapBuiltInObjectTypes,
} from "./registry.js";

export {
  registerPageKind,
  registerPageKinds,
  listPageKinds,
  isRegisteredPageKind,
  pageKindJsonSchema,
} from "./kind-registry.js";

export {
  KernelError,
  listRecords,
  getRecord,
  createRecord,
  updateRecord,
  deleteRecord,
  executeRecordAction,
  executeCollectionAction,
  createSystemOperationContext,
  cancelOperationRun,
  recoverInterruptedOperationRuns,
  processClaimedOperationRun,
  seedRecords,
  materializeAllNativeTypes,
  ensureObjectTypeStorage,
} from "./record-api.js";

export {
  OperationRunWorker,
  claimOperationRun,
  ensureOperationRunTables,
  type OperationRunRow,
} from "./operation-run-worker.js";

export {
  genericObjectTypeToolDefs,
  objectTypeAutoToolDefs,
  allKernelToolDefs,
  KERNEL_GENERIC_TOOL_NAMES,
} from "./auto-tools.js";

export { createKernelRouter } from "./routes.js";

export {
  registerRecordAdapter,
  unregisterRecordAdapter,
  getRecordAdapter,
  setKernelEventBus,
  type RecordAdapter,
  type OperationContext,
  type RecordQuery,
} from "./adapter-registry.js";

export {
  registerPluginObjectTypes,
  applyPluginObjectTypeSeeds,
} from "./plugin-object-types.js";

export {
  assertCoreObjectTypeBootstrapComplete,
  registerCoreObjectTypes,
} from "./core-object-types.js";
