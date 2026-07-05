/**
 * Shared contract for GodMode flow charts: the visual graph is canonical,
 * a derived spec is the runtime/apply input, and `apply` propagates it down.
 *
 * Sierra playbooks are the reference implementation:
 *   GraphDoc → compile → Playbook spec → codegen → deploy
 */
export interface GraphDiagnostic {
  level: "error" | "warn";
  message: string;
  nodeId?: string;
}

export interface CompileResult<TSpec> {
  spec: TSpec;
  diagnostics: GraphDiagnostic[];
}

export interface GraphCompiler<TGraph, TSpec> {
  /** Compile the canonical graph into a deployable/runtime spec. */
  compile(graph: TGraph): CompileResult<TSpec>;
  /** Project an existing spec back into an editable graph (lossy for layout). */
  project(spec: TSpec): TGraph;
  /** Optional pre-save validation. */
  validate?(graph: TGraph): GraphDiagnostic[];
}

/** Per-domain wiring: compile graph → spec, then apply spec downstream. */
export interface GraphDomain<TGraph, TSpec, TApplyCtx = unknown> {
  id: string;
  compiler: GraphCompiler<TGraph, TSpec>;
  apply: (spec: TSpec, ctx: TApplyCtx) => void | Promise<void>;
}

/** Persistence convention: graph_json is canonical; spec_json is derived. */
export interface PersistedGraphRecord<TGraph, TSpec> {
  graph: TGraph;
  spec: TSpec;
}
