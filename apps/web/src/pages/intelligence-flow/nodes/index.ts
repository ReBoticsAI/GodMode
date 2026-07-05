import type { NodeTypes } from "@xyflow/react";
import { BuilderNode } from "./BuilderNode";
import { AgentNode } from "./AgentNode";
import { ScopeNode } from "./ScopeNode";
import { PageNode } from "./PageNode";

export const builderNodeTypes: NodeTypes = {
  builder: BuilderNode,
};

export const orgChartNodeTypes: NodeTypes = {
  agent: AgentNode,
  scope: ScopeNode,
  page: PageNode,
};
