import { describe, expect, it } from "vitest";
import {
  getFeatureDoc,
  stripAgentFacingSections,
} from "../lib/feature-docs";

describe("stripAgentFacingSections", () => {
  it("removes Narrative for agents and Agent notes sections", () => {
    const input = `# Overview

Intro for customers.

## Narrative for agents

When explaining GodMode to the user, lean on:

1. Last platform

Do not invent shipped features.

## Key pieces

- Digital You

## Agent notes

- Do not conflate Digital You with Intelligence.

## Route

\`/home\`
`;
    const out = stripAgentFacingSections(input);
    expect(out).toContain("Intro for customers.");
    expect(out).toContain("## Key pieces");
    expect(out).toContain("## Route");
    expect(out).not.toContain("Narrative for agents");
    expect(out).not.toContain("When explaining");
    expect(out).not.toContain("Agent notes");
    expect(out).not.toContain("Do not conflate");
  });

  it("keeps human-facing pillars headings", () => {
    const input = `## What GodMode stands for

1. Last platform

## Agent notes

Internal only.
`;
    const out = stripAgentFacingSections(input);
    expect(out).toContain("## What GodMode stands for");
    expect(out).toContain("1. Last platform");
    expect(out).not.toContain("Internal only");
  });
});

describe("marketing FEATURE_DOCS load", () => {
  it("does not keep Agent notes bodies in loaded marketing docs", () => {
    const digitalYou = getFeatureDoc("digital-you");
    expect(digitalYou).toBeTruthy();
    expect(digitalYou!.bodyMarkdown).not.toContain("Agent notes");
    expect(digitalYou!.bodyMarkdown).not.toContain("Do not conflate");

    const overview = getFeatureDoc("godmode-overview");
    expect(overview).toBeTruthy();
    expect(overview!.bodyMarkdown).not.toContain("Narrative for agents");
    expect(overview!.bodyMarkdown).toContain("What GodMode stands for");
  });
});
