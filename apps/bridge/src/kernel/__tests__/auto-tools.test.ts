import { describe, expect, it } from "vitest";
import { genericObjectTypeToolDefs, objectTypeAutoToolDefs } from "../auto-tools.js";

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
});
