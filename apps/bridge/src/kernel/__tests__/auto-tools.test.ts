import { describe, expect, it } from "vitest";
import { genericObjectTypeToolDefs, objectTypeAutoToolDefs } from "../auto-tools.js";
import { registerObjectType, unregisterObjectType } from "../registry.js";

describe("ObjectType AI tools", () => {
  it("defines safe generic modes and schemas", () => {
    const tools = genericObjectTypeToolDefs();
    expect(tools.find((tool) => tool.name === "list_records")?.mode).toBe("auto");
    expect(tools.find((tool) => tool.name === "create_record")).toMatchObject({
      mode: "confirm",
      parameters: expect.objectContaining({ required: ["objectType", "data"] }),
    });
  });

  it("does not duplicate static tool names", () => {
    const generated = objectTypeAutoToolDefs(
      new Set(["list_structure_nodes", "update_structure_node"])
    );
    const names = generated.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).not.toContain("list_structure_nodes");
    expect(names).not.toContain("update_structure_node");
  });

  it("generates per-type tools for plugin ObjectTypes", () => {
    registerObjectType({
      name: "GiftIdeaItem",
      label: "Gift Idea Item",
      labelPlural: "Gift Idea Items",
      pluginId: "gift-ideas",
      storage: { kind: "adapter", adapterId: "plugin:gift-ideas:GiftIdeaItem" },
      operations: ["list", "get", "create", "update", "delete"],
      fields: [
        { name: "id", label: "Id", fieldType: "Data", required: true },
        {
          name: "title",
          label: "Title",
          fieldType: "Data",
          required: true,
          inList: true,
          inForm: true,
        },
      ],
    });
    try {
      const generated = objectTypeAutoToolDefs(new Set());
      const names = generated.map((tool) => tool.name);
      expect(names).toContain("create_gift_idea_item");
      expect(names).toContain("list_gift_idea_items");
      expect(names).toContain("get_gift_idea_item");
    } finally {
      unregisterObjectType("GiftIdeaItem");
    }
  });
});
