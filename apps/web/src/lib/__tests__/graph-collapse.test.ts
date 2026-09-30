import { describe, expect, it } from "vitest";

import {
  DEFAULT_FULL_DEPTH_WING_ROOT,
  DEFAULT_HUB_TO_PAGE_PATH,
  DEFAULT_YOU_STRUCTURE_ID,
  DEFAULT_YOU_VAULT_ID,
  defaultCollapsedSet,
  hiddenDescendantIds,
  PLATFORM_SPINE_IDS,
  recollapsePlatformRayBeyond,
} from "../graph-collapse";

/** Minimal architecture edges for Hub fan + Personal→Page + Vault / surfaces. */
const EDGES = [
  { id: "e:you-heart", source: "hub:you", target: "hub:heart", kind: "runtime" },
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
    id: "e:structure-you-pages",
    source: "hub:structure-you",
    target: "hub:pages-you",
    kind: "structure-child",
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
    id: "e:structure-intel-pages",
    source: "hub:structure-intelligence",
    target: "hub:pages-intelligence",
    kind: "structure-child",
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
] as const;

describe("graph-collapse", () => {
  it("default land opens Hub→Workspace→Page, You Vault, and You surfaces; keeps duplicates collapsed", () => {
    const collapsed = defaultCollapsedSet();
    expect(collapsed.has("hub:heart")).toBe(false);
    expect(collapsed.has(DEFAULT_FULL_DEPTH_WING_ROOT)).toBe(false);
    expect(collapsed.has("hub:ws-personal")).toBe(false);
    expect(collapsed.has(DEFAULT_YOU_VAULT_ID)).toBe(false);
    expect(collapsed.has(DEFAULT_YOU_STRUCTURE_ID)).toBe(false);
    expect(collapsed.has("hub:structure-intelligence")).toBe(true);
    expect(collapsed.has("hub:knowledge-intelligence")).toBe(true);
    expect(collapsed.has("hub:vault-intelligence")).toBe(true);
    expect(collapsed.has("hub:ws-project-alpha")).toBe(true);

    const hidden = hiddenDescendantIds(EDGES, collapsed);
    for (const id of DEFAULT_HUB_TO_PAGE_PATH) {
      expect(hidden.has(id)).toBe(false);
    }
    expect(hidden.has("hub:bank-you")).toBe(false);
    expect(hidden.has("hub:wallet-you")).toBe(false);
    expect(hidden.has("hub:support-tickets")).toBe(true);
    expect(hidden.has("hub:shared-grants")).toBe(true);
    expect(hidden.has("hub:marketplace-official")).toBe(true);
    expect(hidden.has("hub:agents-project-alpha")).toBe(true);
    expect(hidden.has("hub:structure-you")).toBe(false);
    expect(hidden.has("hub:pages-you")).toBe(false);
    expect(hidden.has("hub:pages-intelligence")).toBe(true);
    expect(hidden.has("hub:agent-research")).toBe(false);
    expect(hidden.has("hub:agent-ops")).toBe(false);
  });

  it("Support chevron hides only side branches, not Shared / Marketplace", () => {
    const collapsed = defaultCollapsedSet();
    expect(collapsed.has("hub:support")).toBe(true);
    let hidden = hiddenDescendantIds(EDGES, collapsed);
    expect(hidden.has("hub:shared")).toBe(false);
    expect(hidden.has("hub:marketplace")).toBe(false);
    expect(hidden.has("hub:workspace")).toBe(false);
    expect(hidden.has("hub:support-tickets")).toBe(true);

    collapsed.delete("hub:support");
    hidden = hiddenDescendantIds(EDGES, collapsed);
    expect(hidden.has("hub:support-tickets")).toBe(false);
    expect(hidden.has("hub:shared")).toBe(false);

    collapsed.add("hub:support");
    recollapsePlatformRayBeyond(collapsed, "hub:support");
    hidden = hiddenDescendantIds(EDGES, collapsed);
    expect(hidden.has("hub:shared")).toBe(false);
    expect(hidden.has("hub:marketplace")).toBe(false);
    expect(hidden.has("hub:workspace")).toBe(false);
    expect(hidden.has("hub:pages-personal")).toBe(false);
  });

  it("Shared / Marketplace chevrons do not hide further Hub fan hubs", () => {
    const collapsed = defaultCollapsedSet();
    collapsed.delete("hub:shared");
    collapsed.delete("hub:marketplace");

    collapsed.add("hub:shared");
    recollapsePlatformRayBeyond(collapsed, "hub:shared");
    let hidden = hiddenDescendantIds(EDGES, collapsed);
    expect(hidden.has("hub:marketplace")).toBe(false);
    expect(hidden.has("hub:workspace")).toBe(false);
    expect(hidden.has("hub:shared-grants")).toBe(true);

    collapsed.add("hub:marketplace");
    recollapsePlatformRayBeyond(collapsed, "hub:marketplace");
    hidden = hiddenDescendantIds(EDGES, collapsed);
    expect(hidden.has("hub:workspace")).toBe(false);
    expect(hidden.has("hub:pages-personal")).toBe(false);
    expect(hidden.has("hub:marketplace-official")).toBe(true);
  });

  it("collapsing Hub hides the fan; re-expand restores Workspace→Page path", () => {
    const collapsed = defaultCollapsedSet();
    collapsed.delete("hub:support");
    collapsed.delete("hub:marketplace");

    collapsed.add("hub:heart");
    recollapsePlatformRayBeyond(collapsed, "hub:heart");
    let hidden = hiddenDescendantIds(EDGES, collapsed);
    for (const id of PLATFORM_SPINE_IDS) {
      expect(hidden.has(id)).toBe(true);
    }
    expect(hidden.has("hub:agent-research")).toBe(false);
    expect(hidden.has("hub:agent-ops")).toBe(false);
    expect(collapsed.has("hub:support")).toBe(true);
    expect(collapsed.has("hub:ws-personal")).toBe(false);

    collapsed.delete("hub:heart");
    hidden = hiddenDescendantIds(EDGES, collapsed);
    for (const id of DEFAULT_HUB_TO_PAGE_PATH) {
      expect(hidden.has(id)).toBe(false);
    }
  });
});
