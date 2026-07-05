/**
 * GodMode flow-chart source-of-truth contract (structure domain in core).
 * Domain-specific graph compilers live in optional plugins.
 */
export {
  STRUCTURE_GRAPH_DOMAIN_ID,
  structureGraphCompiler,
  type CompileResult,
  type GraphCompiler,
  type GraphDiagnostic,
  type GraphDomain,
  type PersistedGraphRecord,
  type StructureGraphDoc,
  type StructureGraphLayout,
  type StructureSpec,
  type StructureSpecNode,
} from "@godmode/flow-core";
