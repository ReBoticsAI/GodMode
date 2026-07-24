/**
 * Plugin HTTP route slots: mount → reload → new handler without recreating Express.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { EventEmitter } from "node:events";
import { Router } from "express";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setPluginHost } from "@godmode/plugin-host";
import type { GodModePluginRegister, GodmodePluginManifest } from "@godmode/plugin-api";
import { PluginRuntime } from "../runtime.js";

function stubHost(): void {
  setPluginHost({
    getTenantDb: () => {
      throw new Error("not used");
    },
    getReqTenantDb: () => {
      throw new Error("not used");
    },
    createPluginRouter: () => Router(),
    getTimeseriesStore: () => {
      throw new Error("not used");
    },
    bootstrapTradingDepartment: () => undefined,
    bridgeFetch: async () => new Response(),
  } as never);
}

function manifest(id: string): GodmodePluginManifest {
  return {
    id,
    version: "1.0.0",
    name: id,
    engine: "^0.1.0",
    bridge: { entry: "dist/bridge.js" },
  };
}

describe("plugin route hot-reload", () => {
  let runtime: PluginRuntime;
  let baseUrl: string;
  let closeServer: () => Promise<void>;

  beforeEach(async () => {
    stubHost();
    runtime = new PluginRuntime();
    runtime.configure({ operatorTenantId: "test", bus: new EventEmitter() });

    const app = express();
    runtime.setApp(app);
    runtime.mountOn(app);

    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
    closeServer = () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
  });

  afterEach(async () => {
    await closeServer();
  });

  it("serves api.routes.mount without recreating the app", async () => {
    const registerV1: GodModePluginRegister = (api) => {
      const router = Router();
      router.get("/ping", (_req, res) => {
        res.json({ version: 1 });
      });
      api.routes.mount("/api/test-plugin", router);
    };

    runtime.register(manifest("test-plugin"), "/tmp/test-plugin", registerV1);
    runtime.syncPluginRoutes("test-plugin");

    const first = await fetch(`${baseUrl}/api/test-plugin/ping`);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ version: 1 });

    runtime.unregister("test-plugin");

    const registerV2: GodModePluginRegister = (api) => {
      const router = Router();
      router.get("/ping", (_req, res) => {
        res.json({ version: 2 });
      });
      api.routes.mount("/api/test-plugin", router);
    };

    runtime.register(manifest("test-plugin"), "/tmp/test-plugin", registerV2);
    runtime.syncPluginRoutes("test-plugin");

    const second = await fetch(`${baseUrl}/api/test-plugin/ping`);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ version: 2 });
  });

  it("clears the slot so the old handler is gone after unregister", async () => {
    const registerFn: GodModePluginRegister = (api) => {
      const router = Router();
      router.get("/ping", (_req, res) => {
        res.json({ ok: true });
      });
      api.routes.mount("/api/test-plugin", router);
    };

    runtime.register(manifest("test-plugin"), "/tmp/test-plugin", registerFn);
    runtime.syncPluginRoutes("test-plugin");

    expect((await fetch(`${baseUrl}/api/test-plugin/ping`)).status).toBe(200);

    runtime.unregister("test-plugin");

    const after = await fetch(`${baseUrl}/api/test-plugin/ping`);
    expect(after.status).toBe(404);
  });

  it("mountPluginRoute updates the same slot", async () => {
    const router = Router();
    router.get("/ping", (_req, res) => {
      res.json({ via: "host" });
    });
    runtime.mountPluginRoute("test-plugin", "/api/test-plugin", router);

    const res = await fetch(`${baseUrl}/api/test-plugin/ping`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ via: "host" });
  });
});
