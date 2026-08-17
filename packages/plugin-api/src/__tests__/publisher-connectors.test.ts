import { describe, expect, it } from "vitest";
import { parsePublisherConnectorDef } from "../publisher-connectors.js";

describe("parsePublisherConnectorDef", () => {
  const base = {
    id: "example-store",
    title: "Example Store",
    description: "Submit a draft listing.",
    kind: "store",
    source: "plugin",
    pluginId: "example-store-plugin",
    installHint: "Install the Example Store Official pack from Marketplace.",
    tools: { submit: "example_submit", list: "example_list" },
    neverAutoApprove: ["example_submit"],
  };

  it("accepts a plugin store connector", () => {
    expect(parsePublisherConnectorDef(base)).toMatchObject({
      id: "example-store",
      kind: "store",
      source: "plugin",
      tools: { submit: "example_submit", list: "example_list" },
    });
  });

  it("rejects missing submit and invalid ids", () => {
    expect(() =>
      parsePublisherConnectorDef({ ...base, tools: { list: "example_list" } })
    ).toThrow(/tools.submit/);
    expect(() => parsePublisherConnectorDef({ ...base, id: "Nope" })).toThrow(
      /kebab-case/
    );
  });

  it("requires neverAutoApprove to cover submit and publish", () => {
    expect(() =>
      parsePublisherConnectorDef({
        ...base,
        tools: { submit: "example_submit", publish: "example_publish" },
        neverAutoApprove: ["example_submit"],
      })
    ).toThrow(/tools.publish/);
  });
});
