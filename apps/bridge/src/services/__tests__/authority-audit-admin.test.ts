import { describe, expect, it, vi } from "vitest";

vi.mock("../coding/coding-authority-admin.js", () => ({
  listCodingAuthorityEvents: vi.fn(),
}));
vi.mock("../authority/spend-authority-admin.js", () => ({
  listSpendAuthorityEvents: vi.fn(),
}));
vi.mock("../authority/deploy-authority-admin.js", () => ({
  listDeployAuthorityEvents: vi.fn(),
}));
vi.mock("../authority/delete-authority-admin.js", () => ({
  listDeleteAuthorityEvents: vi.fn(),
}));
vi.mock("../authority/send-authority-admin.js", () => ({
  listSendAuthorityEvents: vi.fn(),
}));

import { listCodingAuthorityEvents } from "../coding/coding-authority-admin.js";
import { listDeleteAuthorityEvents } from "../authority/delete-authority-admin.js";
import { listDeployAuthorityEvents } from "../authority/deploy-authority-admin.js";
import { listSendAuthorityEvents } from "../authority/send-authority-admin.js";
import { listSpendAuthorityEvents } from "../authority/spend-authority-admin.js";
import {
  classifyAuthorityResult,
  listAuthorityAuditEvents,
} from "../authority/authority-audit-admin.js";

const codingList = vi.mocked(listCodingAuthorityEvents);
const spendList = vi.mocked(listSpendAuthorityEvents);
const deployList = vi.mocked(listDeployAuthorityEvents);
const deleteList = vi.mocked(listDeleteAuthorityEvents);
const sendList = vi.mocked(listSendAuthorityEvents);

function base(overrides: Partial<{
  tenantId: string;
  tenantName: string | null;
  agentId: string;
  userId: string | null;
  action: string;
  result: string;
  command: string | null;
  createdAt: string;
}> = {}) {
  return {
    tenantId: "t1",
    tenantName: "One",
    agentId: "agent-a",
    userId: "u1",
    action: "gate",
    result: "kill:global_spend",
    command: null,
    createdAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("classifyAuthorityResult", () => {
  it("maps quota and coding kills to coding", () => {
    expect(classifyAuthorityResult("quota:tenant_terminal")).toBe("coding");
    expect(classifyAuthorityResult("kill:global_coding")).toBe("coding");
    expect(classifyAuthorityResult("kill:tenant_builds")).toBe("coding");
  });

  it("maps domain-specific kill codes", () => {
    expect(classifyAuthorityResult("kill:env_spend")).toBe("spend");
    expect(classifyAuthorityResult("kill:global_deploy")).toBe("deploy");
    expect(classifyAuthorityResult("kill:tenant_delete")).toBe("delete");
    expect(classifyAuthorityResult("kill:env_send")).toBe("send");
  });
});

describe("listAuthorityAuditEvents", () => {
  it("merges, sorts desc, and tags domain", () => {
    codingList.mockReturnValue([
      base({
        result: "quota:global_terminal",
        createdAt: "2026-01-01T00:00:00.000Z",
        action: "run_terminal",
      }),
    ]);
    spendList.mockReturnValue([
      base({
        result: "kill:global_spend",
        createdAt: "2026-01-03T00:00:00.000Z",
        action: "spend_gate",
      }),
    ]);
    deployList.mockReturnValue([]);
    deleteList.mockReturnValue([]);
    sendList.mockReturnValue([
      base({
        result: "kill:tenant_send",
        createdAt: "2026-01-02T12:00:00.000Z",
        action: "hook_webhook",
      }),
    ]);

    const events = listAuthorityAuditEvents({ limit: 10 });
    expect(events.map((e) => e.domain)).toEqual(["spend", "send", "coding"]);
    expect(events[0].result).toBe("kill:global_spend");
  });

  it("dedupes coding overlap preferring specific domain", () => {
    const shared = base({
      result: "kill:global_spend",
      createdAt: "2026-01-02T00:00:00.000Z",
      action: "spend_gate",
    });
    codingList.mockReturnValue([shared]);
    spendList.mockReturnValue([shared]);
    deployList.mockReturnValue([]);
    deleteList.mockReturnValue([]);
    sendList.mockReturnValue([]);

    const events = listAuthorityAuditEvents();
    expect(events).toHaveLength(1);
    expect(events[0].domain).toBe("spend");
  });

  it("filters by domain and tenantId", () => {
    codingList.mockReturnValue([
      base({
        tenantId: "t1",
        result: "quota:tenant_pty",
        createdAt: "2026-01-04T00:00:00.000Z",
      }),
    ]);
    spendList.mockReturnValue([
      base({
        tenantId: "t2",
        result: "kill:tenant_spend",
        createdAt: "2026-01-05T00:00:00.000Z",
      }),
    ]);
    deployList.mockReturnValue([]);
    deleteList.mockReturnValue([]);
    sendList.mockReturnValue([]);

    expect(listAuthorityAuditEvents({ domain: "coding" })).toHaveLength(1);
    expect(listAuthorityAuditEvents({ domain: "coding" })[0].domain).toBe(
      "coding"
    );
    expect(listAuthorityAuditEvents({ tenantId: "t2" })).toHaveLength(1);
    expect(listAuthorityAuditEvents({ tenantId: "t2" })[0].tenantId).toBe(
      "t2"
    );
    expect(
      listAuthorityAuditEvents({ domain: "spend", tenantId: "t1" })
    ).toHaveLength(0);
  });
});
