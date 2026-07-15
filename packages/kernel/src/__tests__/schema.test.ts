import { describe, expect, it } from "vitest";
import {
  STRUCTURE_NODE_OBJECT_TYPE,
  fieldsToJsonSchema,
  perObjectTypeToolNames,
  validateObjectTypeDef,
} from "../index.js";

describe("ObjectType schema", () => {
  it("accepts the built-in dynamic Structure kind", () => {
    expect(validateObjectTypeDef(STRUCTURE_NODE_OBJECT_TYPE)).toEqual([]);
  });

  it("rejects malformed definitions", () => {
    expect(
      validateObjectTypeDef({
        name: "bad-name",
        label: "",
        storage: { kind: "native" },
        fields: [{ name: "id", label: "Id", fieldType: "Int" }],
      })
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("PascalCase"),
        "label required",
        "id field must use Data",
      ])
    );
  });

  it("derives create/update schemas and readable plurals", () => {
    const fields = [
      { name: "id", label: "Id", fieldType: "Data" as const, required: true },
      { name: "title", label: "Title", fieldType: "Data" as const, required: true },
      { name: "computed", label: "Computed", fieldType: "ReadOnly" as const },
    ];
    const create = fieldsToJsonSchema(fields, {
      mode: "create",
      includeId: true,
    }) as { required: string[]; properties: Record<string, unknown> };
    expect(create.required).toEqual(["title"]);
    expect(create.properties.computed).toBeUndefined();
    expect(perObjectTypeToolNames("Address").list).toBe("list_addresses");
    expect(perObjectTypeToolNames("Category").list).toBe("list_categories");
  });
});
