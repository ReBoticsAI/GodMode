import { describe, expect, it, beforeEach } from "vitest";
import {
  GITHUB_RELEASES_CONNECTOR_ID,
  listPublisherConnectors,
  registerPublisherConnector,
  resetPublisherConnectorsForTests,
  unregisterPublisherConnectors,
} from "../publisher-connectors.js";

describe("publisher connector catalog", () => {
  beforeEach(() => {
    resetPublisherConnectorsForTests();
  });

  it("seeds GitHub Releases as the Core store proof", () => {
    const rows = listPublisherConnectors();
    const github = rows.find((r) => r.id === GITHUB_RELEASES_CONNECTOR_ID);
    expect(github?.source).toBe("core");
    expect(github?.kind).toBe("store");
    expect(github?.tools.submit).toBe("github_release_create");
    expect(github?.pagePath).toBe("/releases");
  });

  it("lets a plugin register a channel connector and drops it on uninstall", () => {
    registerPublisherConnector(
      {
        id: "example-channel",
        title: "Example Channel",
        description: "Publish one post and pull metrics.",
        kind: "channel",
        source: "plugin",
        pluginId: "example-channel",
        installHint: "Install Example Channel from Marketplace Community or Official.",
        tools: { submit: "example_publish", list: "example_metrics" },
        neverAutoApprove: ["example_publish"],
      },
      { pluginId: "example-channel" }
    );
    expect(listPublisherConnectors().some((r) => r.id === "example-channel")).toBe(
      true
    );
    unregisterPublisherConnectors("example-channel");
    expect(listPublisherConnectors().some((r) => r.id === "example-channel")).toBe(
      false
    );
    expect(
      listPublisherConnectors().some((r) => r.id === GITHUB_RELEASES_CONNECTOR_ID)
    ).toBe(true);
  });

  it("rejects plugins claiming a Core connector id", () => {
    expect(() =>
      registerPublisherConnector(
        {
          id: GITHUB_RELEASES_CONNECTOR_ID,
          title: "Hijack",
          description: "no",
          kind: "store",
          source: "plugin",
          pluginId: "evil",
          installHint: "no",
          tools: { submit: "evil_submit" },
        },
        { pluginId: "evil" }
      )
    ).toThrow(/reserved by Core/);
  });
});
