import { describe, expect, it } from "vitest";
import {
  GRAPH_NODE_KINDS,
  KIND_COLOR_FAMILY,
  buildGraphNodeColors,
  graphNodeColor,
  parseHexToHsl,
  resolveGraphGlyphKey,
} from "@/lib/graph-node-style";

describe("graph-node-style", () => {
  it("gives every kind a color family", () => {
    for (const kind of GRAPH_NODE_KINDS) {
      expect(KIND_COLOR_FAMILY[kind]).toBeTruthy();
    }
  });

  it("keeps chat in the bright yellow family", () => {
    const c = graphNodeColor("chat", "hub:chat-you");
    const hsl = parseHexToHsl(c);
    expect(hsl).not.toBeNull();
    expect(hsl!.h).toBeGreaterThan(40);
    expect(hsl!.h).toBeLessThan(65);
    expect(hsl!.s).toBeGreaterThan(80);
    expect(hsl!.l).toBeGreaterThan(48);
  });

  it("keeps persons in greens and agents in purples", () => {
    const person = parseHexToHsl(graphNodeColor("user", "person-a"))!;
    const agent = parseHexToHsl(graphNodeColor("agent", "bot-a"))!;
    expect(person.h).toBeGreaterThan(120);
    expect(person.h).toBeLessThan(180);
    expect(agent.h).toBeGreaterThan(240);
    expect(agent.h).toBeLessThan(300);
  });

  it("paints only the You hub white, not other person nodes", () => {
    expect(graphNodeColor("user", "hub:you", null, "User", "You").toLowerCase()).toBe(
      "#ffffff"
    );
    const otherPerson = parseHexToHsl(
      graphNodeColor("user", "user:local", null, "User", "You")
    )!;
    expect(otherPerson.h).toBeGreaterThan(120);
    expect(otherPerson.h).toBeLessThan(180);
    expect(otherPerson.l).toBeLessThan(70);
  });

  it("does not wash chat yellow with white You parent color", () => {
    const colors = buildGraphNodeColors(
      [
        { id: "hub:you", kind: "user", objectType: "User", label: "You" },
        { id: "hub:chat-you", kind: "chat", objectType: "ChatSession", label: "Chat" },
      ],
      [{ source: "hub:you", target: "hub:chat-you" }]
    );
    const chat = parseHexToHsl(colors.get("hub:chat-you")!)!;
    expect(chat.h).toBeGreaterThan(40);
    expect(chat.h).toBeLessThan(65);
  });

  it("derives child shades from the parent within a family", () => {
    const colors = buildGraphNodeColors(
      [
        { id: "root", kind: "user" },
        { id: "child-a", kind: "user" },
        { id: "child-b", kind: "user" },
      ],
      [
        { source: "root", target: "child-a" },
        { source: "root", target: "child-b" },
      ]
    );
    expect(colors.get("child-a")).not.toBe(colors.get("root"));
    expect(colors.get("child-b")).not.toBe(colors.get("root"));
    const root = parseHexToHsl(colors.get("root")!)!;
    const a = parseHexToHsl(colors.get("child-a")!)!;
    expect(Math.abs(a.h - root.h)).toBeLessThan(30);
  });

  it("gives Life, Vault, Heart, Support distinct glyphs", () => {
    expect(
      resolveGraphGlyphKey({
        kind: "system",
        objectType: "LifeSurface",
        label: "Life",
      })
    ).toBe("life");
    expect(
      resolveGraphGlyphKey({
        kind: "system",
        objectType: "VaultSecret",
        label: "Vault",
      })
    ).toBe("vault");
    expect(
      resolveGraphGlyphKey({
        kind: "system",
        objectType: "BridgeConnection",
        label: "Heart",
      })
    ).toBe("heart");
    expect(
      resolveGraphGlyphKey({
        kind: "system",
        objectType: "Support",
        label: "Support",
      })
    ).toBe("support");
  });

  it("gives Artifacts and Tools distinct glyphs", () => {
    expect(
      resolveGraphGlyphKey({
        kind: "tool",
        objectType: "Artifact",
        label: "Artifacts",
      })
    ).toBe("artifact");
    expect(
      resolveGraphGlyphKey({
        kind: "tool",
        objectType: "ToolDefinition",
        label: "Tools",
      })
    ).toBe("tool");
  });

  it("gives Agents hub a group glyph distinct from a single Agent", () => {
    expect(
      resolveGraphGlyphKey({
        kind: "system",
        objectType: "Agent",
        id: "hub:agents-personal",
        label: "Agents",
      })
    ).toBe("agents");
    expect(
      resolveGraphGlyphKey({
        kind: "agent",
        objectType: "Agent",
        id: "hub:intelligence",
        label: "Intelligence",
      })
    ).toBe("agent");
    expect(
      resolveGraphGlyphKey({
        kind: "agent",
        objectType: "Agent",
        id: "hub:agent-research",
        label: "Research",
      })
    ).toBe("agent");
  });
});
