# @godmode/flow-core

GodMode flow-chart source-of-truth contract.

## Pattern

1. **Graph** — canonical authoring state (edited in React Flow UI)
2. **Spec** — compiled runtime/deploy input (`compile(graph)`)
3. **Apply** — propagates spec downstream (codegen, DB tables, navigation, etc.)

## Example domain

```
GraphDoc → compileGraphToSpec() → Domain spec → apply() → runtime artifacts
```

Plugins can persist graph + spec pairs in tenant SQLite and wire apply hooks during install.

## Structure domain

```
StructureGraphDoc → structureGraphCompiler → StructureSpec (structure_nodes tree)
```

Layout sidecar (`structure.graph_json` in `ai_settings`) stores positions/collapse/viewport.
Structural edits in the flow chart write directly to `structure_nodes` and reload the tree.
