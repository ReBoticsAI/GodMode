// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TENANT_STORAGE_KEY } from "../lib/storage-keys";
import { withActiveTenantQuery } from "../api";
import { waitForOperationRun } from "../lib/object-types-api";

describe("Marketplace OperationRun tenant poll (#567)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("appends tenantId so OperationRun GET cannot hit the wrong workspace", () => {
    localStorage.setItem(TENANT_STORAGE_KEY, "workspace-a");
    expect(withActiveTenantQuery("/records/OperationRun/run-1")).toBe(
      "/records/OperationRun/run-1?tenantId=workspace-a"
    );
    expect(
      withActiveTenantQuery("/records/OperationRun/run-1?tenantId=workspace-a")
    ).toBe("/records/OperationRun/run-1?tenantId=workspace-a");
  });

  it("appends tenantId on plugin web bundles because dynamic import cannot send X-Tenant-Id", () => {
    localStorage.setItem(TENANT_STORAGE_KEY, "workspace-a");
    expect(withActiveTenantQuery("/api/plugins/workspace-pulse/web.js")).toBe(
      "/api/plugins/workspace-pulse/web.js?tenantId=workspace-a"
    );
  });

  it("stops polling OperationRun 404s instead of spinning forever", async () => {
    localStorage.setItem(TENANT_STORAGE_KEY, "workspace-a");
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "KERNEL_404",
            message: "OperationRun record not found: run-missing",
            retryable: false,
          },
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      )
    );
    await expect(
      waitForOperationRun("run-missing", { intervalMs: 20, timeoutMs: 200 })
    ).rejects.toMatchObject({ status: 404 });
    expect(fetchMock.mock.calls[0]?.[0]).toContain("tenantId=workspace-a");
  });

  it("returns when the workspace OperationRun succeeds", async () => {
    localStorage.setItem(TENANT_STORAGE_KEY, "workspace-a");
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "run-ok",
            objectType: "OperationRun",
            data: { status: "running" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "run-ok",
            objectType: "OperationRun",
            data: { status: "succeeded", result_json: { pluginId: "workspace-pulse" } },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    const run = await waitForOperationRun("run-ok", { intervalMs: 10, timeoutMs: 1000 });
    expect(run.status).toBe("succeeded");
    expect(run.result).toEqual({ pluginId: "workspace-pulse" });
  });

  it("on timeout, returns a late terminal failed run instead of a bare 408", async () => {
    localStorage.setItem(TENANT_STORAGE_KEY, "workspace-a");
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "run-late-fail",
            objectType: "OperationRun",
            data: { status: "running" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "run-late-fail",
            objectType: "OperationRun",
            data: {
              status: "failed",
              error_code: "KERNEL_INTERNAL_ERROR",
              error_message: "Catalog entry not found",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    const run = await waitForOperationRun("run-late-fail", {
      intervalMs: 30,
      timeoutMs: 40,
    });
    expect(run.status).toBe("failed");
    expect(run.errorMessage).toBe("Catalog entry not found");
  });
});
