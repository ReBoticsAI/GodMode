/**
 * Host build-supervisor Docker egress network helpers (#170).
 */
import { describe, expect, it } from "vitest";
import {
  buildDockerRunArgs,
  DEFAULT_BUILD_EGRESS_NETWORK,
  resolveBuildEgressNetworkName,
} from "../../../../../deploy/build-supervisor/egress-network.mjs";

describe("build-supervisor egress network", () => {
  it("defaults network name and reads CODING_BUILD_EGRESS_NETWORK", () => {
    const prev = process.env.CODING_BUILD_EGRESS_NETWORK;
    try {
      delete process.env.CODING_BUILD_EGRESS_NETWORK;
      expect(resolveBuildEgressNetworkName()).toBe(DEFAULT_BUILD_EGRESS_NETWORK);
      process.env.CODING_BUILD_EGRESS_NETWORK = " custom-net ";
      expect(resolveBuildEgressNetworkName()).toBe("custom-net");
    } finally {
      if (prev == null) delete process.env.CODING_BUILD_EGRESS_NETWORK;
      else process.env.CODING_BUILD_EGRESS_NETWORK = prev;
    }
  });

  it("uses --network none for none mode", () => {
    const args = buildDockerRunArgs({
      network: "none",
      bindHost: "/data/tenant-workspaces/t1",
      workdir: "/workspace",
      image: "node:22-bookworm-slim",
      argv: ["npm", "ci"],
    });
    expect(args).toEqual([
      "--rm",
      "--network",
      "none",
      "-v",
      "/data/tenant-workspaces/t1:/workspace:rw",
      "-w",
      "/workspace",
      "node:22-bookworm-slim",
      "npm",
      "ci",
    ]);
  });

  it("pins allowlist builds to an internal network + proxy env", () => {
    const args = buildDockerRunArgs({
      network: "allowlist",
      networkName: "godmode-build-egress",
      proxyPort: 8793,
      bindHost: "/data/tenant-workspaces/t1",
      workdir: "/workspace/pkg",
      image: "node:22-bookworm-slim",
      argv: ["npm", "ci"],
    });
    expect(args).toContain("--network");
    expect(args[args.indexOf("--network") + 1]).toBe("godmode-build-egress");
    expect(args).not.toContain("bridge");
    expect(args).toEqual(
      expect.arrayContaining([
        "--add-host",
        "host.docker.internal:host-gateway",
        "-e",
        "HTTP_PROXY=http://host.docker.internal:8793",
        "-e",
        "HTTPS_PROXY=http://host.docker.internal:8793",
      ])
    );
  });

  it("fails closed when allowlist lacks network name or proxy port", () => {
    expect(() =>
      buildDockerRunArgs({
        network: "allowlist",
        proxyPort: 8793,
        bindHost: "/data/t",
        workdir: "/workspace",
        image: "node:22",
        argv: ["npm", "ci"],
      })
    ).toThrow(/internal Docker network/i);
    expect(() =>
      buildDockerRunArgs({
        network: "allowlist",
        networkName: "godmode-build-egress",
        bindHost: "/data/t",
        workdir: "/workspace",
        image: "node:22",
        argv: ["npm", "ci"],
      })
    ).toThrow(/proxy port/i);
  });
});
