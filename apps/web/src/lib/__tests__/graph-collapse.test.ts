import { describe, expect, it } from "vitest";

import {
  DEFAULT_FULL_DEPTH_WING_ROOT,
  DEFAULT_HUB_TO_PAGE_PATH,
  DEFAULT_YOU_STRUCTURE_ID,
  DEFAULT_YOU_VAULT_ID,
  agentDifferenceChildIds,
  applyAgentDifferenceExpansions,
  cycleTieredBranch,
  defaultBranchTiers,
  defaultCollapsedSet,
  hiddenDescendantIds,
  hiddenGraphNodeIds,
  PLATFORM_SPINE_IDS,
  recollapsePlatformRayBeyond,
} from "../graph-collapse";

/** Minimal architecture edges for Hub fan + Personal→Page + Vault / surfaces. */
const EDGES = [
  { id: "e:you-heart", source: "hub:you", target: "hub:heart", kind: "runtime" },
  {
    id: "e:you-admin",
    source: "hub:you",
    target: "hub:admin",
    kind: "platform",
  },
  {
    id: "e:you-settings",
    source: "hub:you",
    target: "hub:settings",
    kind: "platform",
  },
  {
    id: "e:you-agents",
    source: "hub:you",
    target: "hub:agents",
    kind: "platform",
  },
  {
    id: "e:you-users",
    source: "hub:you",
    target: "hub:users",
    kind: "platform",
  },
  {
    id: "e:heart-research",
    source: "hub:heart",
    target: "hub:agent-research",
    kind: "runtime",
  },
  {
    id: "e:heart-ops",
    source: "hub:heart",
    target: "hub:agent-ops",
    kind: "runtime",
  },
  {
    id: "e:heart-support",
    source: "hub:heart",
    target: "hub:support",
    kind: "platform",
  },
  {
    id: "e:heart-shared",
    source: "hub:heart",
    target: "hub:shared",
    kind: "platform",
  },
  {
    id: "e:heart-marketplace",
    source: "hub:heart",
    target: "hub:marketplace",
    kind: "platform",
  },
  {
    id: "e:heart-workspace",
    source: "hub:heart",
    target: "hub:workspace",
    kind: "platform",
  },
  {
    id: "e:heart-wiki",
    source: "hub:heart",
    target: "hub:wiki",
    kind: "platform",
  },
  {
    id: "e:heart-coding",
    source: "hub:heart",
    target: "hub:coding",
    kind: "platform",
  },
  {
    id: "e:heart-releases",
    source: "hub:heart",
    target: "hub:releases",
    kind: "platform",
  },
  {
    id: "e:heart-vault-platform",
    source: "hub:heart",
    target: "hub:vault-platform",
    kind: "vault",
  },
  {
    id: "e:support-tickets",
    source: "hub:support",
    target: "hub:support-tickets",
    kind: "platform-surface",
  },
  {
    id: "e:support-chat",
    source: "hub:support",
    target: "hub:support-chat",
    kind: "platform-surface",
  },
  {
    id: "e:shared-grants",
    source: "hub:shared",
    target: "hub:shared-grants",
    kind: "platform-surface",
  },
  {
    id: "e:marketplace-official",
    source: "hub:marketplace",
    target: "hub:marketplace-official",
    kind: "platform-surface",
  },
  {
    id: "e:workspace-personal",
    source: "hub:workspace",
    target: "hub:ws-personal",
    kind: "workspace-child",
  },
  {
    id: "e:workspace-project",
    source: "hub:workspace",
    target: "hub:ws-project-alpha",
    kind: "workspace-child",
  },
  {
    id: "e:personal-structure",
    source: "hub:ws-personal",
    target: "hub:structure-personal",
    kind: "workspace-structure",
  },
  {
    id: "e:structure-personal-pages",
    source: "hub:structure-personal",
    target: "hub:pages-personal",
    kind: "structure-child",
  },
  {
    id: "e:project-agents",
    source: "hub:ws-project-alpha",
    target: "hub:agents-project-alpha",
    kind: "workspace-agents",
  },
  {
    id: "e:you-structure",
    source: "hub:you",
    target: "hub:structure-you",
    kind: "surface",
  },
  {
    id: "e:you-knowledge",
    source: "hub:you",
    target: "hub:knowledge-you",
    kind: "surface",
  },
  {
    id: "e:you-auto",
    source: "hub:you",
    target: "hub:automations-you",
    kind: "surface",
  },
  {
    id: "e:you-cal",
    source: "hub:you",
    target: "hub:calendar-you",
    kind: "surface",
  },
  {
    id: "e:structure-you-pages",
    source: "hub:structure-you",
    target: "hub:pages-you",
    kind: "structure-child",
  },
  {
    id: "e:cal-you-events",
    source: "hub:calendar-you",
    target: "hub:events-you",
    kind: "calendar-child",
  },
  {
    id: "e:cal-you-tasks",
    source: "hub:calendar-you",
    target: "hub:tasks-you",
    kind: "calendar-child",
  },
  {
    id: "e:intel-structure",
    source: "hub:intelligence",
    target: "hub:structure-intelligence",
    kind: "surface",
  },
  {
    id: "e:intel-knowledge",
    source: "hub:intelligence",
    target: "hub:knowledge-intelligence",
    kind: "surface",
  },
  {
    id: "e:intel-auto",
    source: "hub:intelligence",
    target: "hub:automations-intelligence",
    kind: "surface",
  },
  {
    id: "e:intel-cal",
    source: "hub:intelligence",
    target: "hub:calendar-intelligence",
    kind: "surface",
  },
  {
    id: "e:intel-vault",
    source: "hub:intelligence",
    target: "hub:vault-intelligence",
    kind: "vault",
  },
  {
    id: "e:structure-intel-pages",
    source: "hub:structure-intelligence",
    target: "hub:pages-intelligence",
    kind: "structure-child",
  },
  {
    id: "e:cal-intel-tasks",
    source: "hub:calendar-intelligence",
    target: "hub:tasks-intelligence",
    kind: "calendar-child",
  },
  {
    id: "e:you-vault",
    source: "hub:you",
    target: "hub:vault-you",
    kind: "vault",
  },
  {
    id: "e:vault-you-bank",
    source: "hub:vault-you",
    target: "hub:bank-you",
    kind: "vault-child",
  },
  {
    id: "e:bank-you-wallet",
    source: "hub:bank-you",
    target: "hub:wallet-you",
    kind: "bank-child",
  },
  {
    id: "e:research-structure",
    source: "hub:agent-research",
    target: "hub:structure-research",
    kind: "surface",
  },
  {
    id: "e:research-extra",
    source: "hub:agent-research",
    target: "hub:custom-research-only",
    kind: "surface",
  },
] as const;

describe("graph-collapse", () => {
  it("simple land shows You/Hub essentials; keeps deeper nodes without deleting them", () => {
    const collapsed = defaultCollapsedSet();
    const tiers = defaultBranchTiers();
    const hidden = hiddenGraphNodeIds(EDGES, collapsed, tiers);

    expect(collapsed.has("hub:heart")).toBe(false);
    expect(collapsed.has(DEFAULT_YOU_VAULT_ID)).toBe(false);
    expect(collapsed.has(DEFAULT_YOU_STRUCTURE_ID)).toBe(true);
    expect(collapsed.has("hub:structure-intelligence")).toBe(true);
    expect(collapsed.has("hub:vault-intelligence")).toBe(false);
    expect(collapsed.has(DEFAULT_FULL_DEPTH_WING_ROOT)).toBe(true);

    // You simple
    expect(hidden.has("hub:calendar-you")).toBe(false);
    expect(hidden.has("hub:tasks-you")).toBe(false);
    expect(hidden.has("hub:events-you")).toBe(true);
    expect(hidden.has("hub:settings")).toBe(false);
    expect(hidden.has("hub:knowledge-you")).toBe(false);
    expect(hidden.has("hub:users")).toBe(false);
    expect(hidden.has("hub:structure-you")).toBe(false);
    expect(hidden.has("hub:pages-you")).toBe(true);
    expect(hidden.has("hub:vault-you")).toBe(false);
    expect(hidden.has("hub:bank-you")).toBe(true);
    expect(hidden.has("hub:admin")).toBe(true);
    expect(hidden.has("hub:agents")).toBe(true);
    expect(hidden.has("hub:automations-you")).toBe(true);

    // Hub simple
    expect(hidden.has("hub:support")).toBe(false);
    expect(hidden.has("hub:shared")).toBe(false);
    expect(hidden.has("hub:marketplace")).toBe(false);
    expect(hidden.has("hub:workspace")).toBe(false);
    expect(hidden.has("hub:wiki")).toBe(false);
    expect(hidden.has("hub:vault-platform")).toBe(false);
    expect(hidden.has("hub:ws-personal")).toBe(true);
    expect(hidden.has("hub:coding")).toBe(true);
    expect(hidden.has("hub:releases")).toBe(true);
    expect(hidden.has("hub:support-tickets")).toBe(true);

    // Intelligence expanded; Research/Ops surfaces collapsed
    expect(hidden.has("hub:calendar-intelligence")).toBe(false);
    expect(hidden.has("hub:tasks-intelligence")).toBe(false);
    expect(hidden.has("hub:automations-intelligence")).toBe(true);
    expect(hidden.has("hub:structure-research")).toBe(true);
    expect(hidden.has("hub:agent-research")).toBe(false);
    expect(hidden.has("hub:agent-ops")).toBe(false);
  });

  it("You chevron cycles simple → standard → full → collapsed", () => {
    const collapsed = defaultCollapsedSet();
    const tiers = defaultBranchTiers();

    expect(tiers["hub:you"]).toBe("simple");
    expect(hiddenGraphNodeIds(EDGES, collapsed, tiers).has("hub:admin")).toBe(
      true
    );

    cycleTieredBranch("hub:you", collapsed, tiers);
    expect(tiers["hub:you"]).toBe("standard");
    expect(hiddenGraphNodeIds(EDGES, collapsed, tiers).has("hub:admin")).toBe(
      false
    );
    expect(hiddenGraphNodeIds(EDGES, collapsed, tiers).has("hub:agents")).toBe(
      false
    );

    cycleTieredBranch("hub:you", collapsed, tiers);
    expect(tiers["hub:you"]).toBe("full");
    expect(collapsed.has("hub:structure-you")).toBe(false);
    expect(hiddenGraphNodeIds(EDGES, collapsed, tiers).has("hub:pages-you")).toBe(
      false
    );

    cycleTieredBranch("hub:you", collapsed, tiers);
    expect(collapsed.has("hub:you")).toBe(true);
    expect(tiers["hub:you"]).toBe("simple");
  });

  it("Hub chevron standard reveals Workspaces path; full opens side trees", () => {
    const collapsed = defaultCollapsedSet();
    const tiers = defaultBranchTiers();

    cycleTieredBranch("hub:heart", collapsed, tiers);
    expect(tiers["hub:heart"]).toBe("standard");
    let hidden = hiddenGraphNodeIds(EDGES, collapsed, tiers);
    expect(hidden.has("hub:workspace")).toBe(false);
    expect(hidden.has("hub:coding")).toBe(false);
    expect(hidden.has("hub:ws-personal")).toBe(true);

    cycleTieredBranch("hub:heart", collapsed, tiers);
    expect(tiers["hub:heart"]).toBe("full");
    hidden = hiddenGraphNodeIds(EDGES, collapsed, tiers);
    for (const id of DEFAULT_HUB_TO_PAGE_PATH) {
      expect(hidden.has(id)).toBe(false);
    }
  });

  it("Support chevron hides only side branches, not Shared / Marketplace", () => {
    const collapsed = defaultCollapsedSet();
    const tiers = defaultBranchTiers();
    expect(collapsed.has("hub:support")).toBe(true);
    let hidden = hiddenGraphNodeIds(EDGES, collapsed, tiers);
    expect(hidden.has("hub:shared")).toBe(false);
    expect(hidden.has("hub:marketplace")).toBe(false);
    expect(hidden.has("hub:support-tickets")).toBe(true);

    collapsed.delete("hub:support");
    hidden = hiddenGraphNodeIds(EDGES, collapsed, tiers);
    expect(hidden.has("hub:support-tickets")).toBe(false);
    expect(hidden.has("hub:shared")).toBe(false);

    collapsed.add("hub:support");
    recollapsePlatformRayBeyond(collapsed, "hub:support");
    hidden = hiddenGraphNodeIds(EDGES, collapsed, tiers);
    expect(hidden.has("hub:shared")).toBe(false);
    expect(hidden.has("hub:marketplace")).toBe(false);
  });

  it("Shared / Marketplace chevrons do not hide further Hub fan hubs", () => {
    const collapsed = defaultCollapsedSet();
    const tiers = defaultBranchTiers();
    // Hub already shows Workspaces on simple; standard opens Coding / Releases.
    cycleTieredBranch("hub:heart", collapsed, tiers);

    collapsed.delete("hub:shared");
    collapsed.delete("hub:marketplace");

    collapsed.add("hub:shared");
    recollapsePlatformRayBeyond(collapsed, "hub:shared");
    let hidden = hiddenGraphNodeIds(EDGES, collapsed, tiers);
    expect(hidden.has("hub:marketplace")).toBe(false);
    expect(hidden.has("hub:workspace")).toBe(false);
    expect(hidden.has("hub:shared-grants")).toBe(true);

    collapsed.add("hub:marketplace");
    recollapsePlatformRayBeyond(collapsed, "hub:marketplace");
    hidden = hiddenGraphNodeIds(EDGES, collapsed, tiers);
    expect(hidden.has("hub:workspace")).toBe(false);
    expect(hidden.has("hub:marketplace-official")).toBe(true);
  });

  it("collapsing Hub hides the fan; agent spine stays", () => {
    const collapsed = defaultCollapsedSet();
    collapsed.delete("hub:support");
    collapsed.delete("hub:marketplace");

    collapsed.add("hub:heart");
    recollapsePlatformRayBeyond(collapsed, "hub:heart");
    const hidden = hiddenDescendantIds(EDGES, collapsed);
    for (const id of PLATFORM_SPINE_IDS) {
      expect(hidden.has(id)).toBe(true);
    }
    expect(hidden.has("hub:agent-research")).toBe(false);
    expect(hidden.has("hub:agent-ops")).toBe(false);
    expect(collapsed.has("hub:support")).toBe(true);
  });

  it("expands only agent branches that differ from Intelligence", () => {
    expect(agentDifferenceChildIds(EDGES, "hub:agent-research")).toEqual([
      "hub:custom-research-only",
    ]);
    const collapsed = defaultCollapsedSet();
    expect(collapsed.has("hub:agent-research")).toBe(true);
    applyAgentDifferenceExpansions(EDGES, collapsed, ["hub:agent-research"]);
    expect(collapsed.has("hub:agent-research")).toBe(false);
    const hidden = hiddenGraphNodeIds(EDGES, collapsed, defaultBranchTiers());
    expect(hidden.has("hub:custom-research-only")).toBe(false);
    expect(hidden.has("hub:structure-research")).toBe(true);
  });
});
