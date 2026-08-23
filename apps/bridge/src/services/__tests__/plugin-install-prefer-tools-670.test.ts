import { afterEach, describe, expect, it } from "vitest";
import { mergeInstallPluginTools } from "../../plugins/plugin-install-tools.js";
import {
  registerObjectType,
  unregisterObjectType,
} from "../../kernel/registry.js";

describe("mergeInstallPluginTools (#670)", () => {
  afterEach(() => {
    unregisterObjectType("RecipeBoxItem");
  });

  it("merges generated create/list names into install tools and preferToolsHint", () => {
    registerObjectType({
      name: "RecipeBoxItem",
      label: "Recipe Box Item",
      labelPlural: "Recipe Box Items",
      pluginId: "recipe-box",
      storage: { kind: "adapter", adapterId: "plugin:recipe-box:RecipeBoxItem" },
      operations: ["list", "get", "create", "update", "delete"],
      fields: [
        { name: "id", label: "Id", fieldType: "Data", required: true },
        {
          name: "title",
          label: "Title",
          fieldType: "Data",
          required: true,
          inList: true,
        },
      ],
    });

    const { tools, preferToolsHint } = mergeInstallPluginTools("recipe-box", [
      "recipe_box_ping",
    ]);

    expect(tools).toContain("recipe_box_ping");
    expect(tools).toContain("create_recipe_box_item");
    expect(tools).toContain("list_recipe_box_items");
    expect(preferToolsHint).toContain("create_recipe_box_item");
    expect(preferToolsHint).toContain("list_recipe_box_items");
  });

  it("omits preferToolsHint when the plugin has no ObjectTypes", () => {
    const { tools, preferToolsHint } = mergeInstallPluginTools("empty-plugin", [
      "empty_ping",
    ]);
    expect(tools).toEqual(["empty_ping"]);
    expect(preferToolsHint).toBeUndefined();
  });
});
