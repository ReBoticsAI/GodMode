import { describe, expect, it } from "vitest";
import type { StructureNode } from "@/lib/navigation";
import {
  isLeafDivision,
  nodesToLegacyDepartments,
} from "@/lib/structure-adapters";

function node(
  partial: Partial<StructureNode> & Pick<StructureNode, "id" | "label" | "segment" | "path">
): StructureNode {
  return {
    parentId: null,
    icon: "folder",
    kind: "placeholder",
    objectType: null,
    rightSidebar: null,
    agentId: null,
    builtIn: false,
    sortOrder: 0,
    tabs: null,
    children: [],
    ...partial,
  };
}

describe("nodesToLegacyDepartments leaf pages", () => {
  it("marks department leaf children as leaf divisions (index only)", () => {
    const roots: StructureNode[] = [
      node({
        id: "plant-care",
        label: "Plant Care",
        segment: "plant-care",
        path: "/plant-care",
        children: [
          node({
            id: "plant-care-welcome",
            parentId: "plant-care",
            label: "Welcome",
            segment: "welcome",
            path: "/plant-care/welcome",
            kind: "plant-care-welcome",
          }),
          node({
            id: "plant-care-items",
            parentId: "plant-care",
            label: "Plants",
            segment: "plants",
            path: "/plant-care/plants",
            kind: "record-list",
            objectType: "plant",
          }),
        ],
      }),
    ];

    const depts = nodesToLegacyDepartments(roots);
    expect(depts).toHaveLength(1);
    expect(depts[0].divisions).toHaveLength(2);

    const welcome = depts[0].divisions[0];
    const plants = depts[0].divisions[1];
    expect(welcome.label).toBe("Welcome");
    expect(plants.label).toBe("Plants");
    expect(isLeafDivision(welcome)).toBe(true);
    expect(isLeafDivision(plants)).toBe(true);
    expect(welcome.pages).toHaveLength(1);
    expect(welcome.pages[0].segment).toBe("");
  });

  it("does not treat multi-page divisions as leaves", () => {
    const roots: StructureNode[] = [
      node({
        id: "work",
        label: "Work",
        segment: "work",
        path: "/work",
        children: [
          node({
            id: "work-ops",
            parentId: "work",
            label: "Ops",
            segment: "ops",
            path: "/work/ops",
            children: [
              node({
                id: "work-ops-board",
                parentId: "work-ops",
                label: "Board",
                segment: "board",
                path: "/work/ops/board",
              }),
            ],
          }),
        ],
      }),
    ];

    const ops = nodesToLegacyDepartments(roots)[0].divisions[0];
    expect(ops.pages).toHaveLength(2);
    expect(isLeafDivision(ops)).toBe(false);
  });
});
