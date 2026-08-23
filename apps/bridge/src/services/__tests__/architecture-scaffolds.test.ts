import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyScaffoldTokens,
  loadScaffoldBlueprint,
  scaffoldsRoot,
  scaffoldTokens,
} from "../architecture-scaffolds.js";
import { scaffoldPlugin } from "../plugin-scaffold.js";

describe("architecture scaffolds (#630)", () => {
  const temps: string[] = [];

  afterEach(() => {
    while (temps.length) {
      fs.rmSync(temps.pop()!, { recursive: true, force: true });
    }
  });

  it("resolves scaffolds root with plugin-domain and blueprints", () => {
    const root = scaffoldsRoot();
    expect(fs.existsSync(path.join(root, "plugin-domain", "src", "bridge.ts"))).toBe(
      true
    );
    expect(fs.existsSync(path.join(root, "plugin-records", "src", "bridge.ts"))).toBe(
      true
    );
    expect(loadScaffoldBlueprint("pack").id).toBeTruthy();
    expect(loadScaffoldBlueprint("agent").template).toBe("default");
    expect(loadScaffoldBlueprint("automation").actionKind).toBe("run_agent");
  });

  it("applies scaffold tokens", () => {
    const tokens = scaffoldTokens({
      id: "session-journal",
      name: "Session Journal",
      deptId: "session-journal",
    });
    expect(tokens.RECORD_TYPE).toBe("SessionJournalItem");
    expect(tokens.RECORD_TABLE).toBe("session_journal_items");
    expect(
      applyScaffoldTokens("openPluginDb(\"__PLUGIN_ID__\")", tokens)
    ).toBe('openPluginDb("session-journal")');
  });

  it("domain scaffold emits openPluginDb and builds tools", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "gm-scaffold-domain-"));
    temps.push(base);
    process.env.GODMODE_PLUGIN_SCAFFOLD_DIR = base;
    try {
      const result = scaffoldPlugin({
        id: "demo-domain",
        name: "Demo Domain",
        template: "domain",
      });
      expect(result.created).toBe(true);
      expect(result.template).toBe("domain");
      const bridge = fs.readFileSync(
        path.join(result.pluginRoot, "src", "bridge.ts"),
        "utf8"
      );
      expect(bridge).toMatch(/openPluginDb/);
      expect(bridge).toMatch(/ensureDomainItemsTable|domain_items/);
      expect(bridge).toMatch(/registerDomainSqliteObjectType/);
      expect(bridge).toMatch(/-welcome/);
      expect(bridge).toMatch(/record-list/);
      expect(bridge).not.toMatch(/tools\.register/);
      expect(bridge).not.toMatch(/_list_items|_add_item/);
      expect(bridge).not.toMatch(/__PLUGIN_ID__/);
      expect(
        fs.existsSync(path.join(result.pluginRoot, "src", "domain-sqlite-ot.ts"))
      ).toBe(true);
      const helper = fs.readFileSync(
        path.join(result.pluginRoot, "src", "domain-sqlite-ot.ts"),
        "utf8"
      );
      expect(helper).toMatch(/domain_items/);
      const web = fs.readFileSync(
        path.join(result.pluginRoot, "src", "web.tsx"),
        "utf8"
      );
      expect(web).toMatch(/listRecords/);
      expect(web).toMatch(/No rows yet/);
      const manifest = JSON.parse(
        fs.readFileSync(path.join(result.pluginRoot, "godmode.plugin.json"), "utf8")
      ) as { id: string; dataPlane?: string; scaffoldTemplate?: string };
      expect(manifest.id).toBe("demo-domain");
      expect(manifest.dataPlane === undefined || manifest.dataPlane === "domain").toBe(
        true
      );
      expect(
        manifest.scaffoldTemplate === undefined ||
          manifest.scaffoldTemplate === "domain"
      ).toBe(true);
    } finally {
      delete process.env.GODMODE_PLUGIN_SCAFFOLD_DIR;
    }
  });

  it("records scaffold is Core Records path without openPluginDb default table", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "gm-scaffold-records-"));
    temps.push(base);
    process.env.GODMODE_PLUGIN_SCAFFOLD_DIR = base;
    try {
      const result = scaffoldPlugin({
        id: "demo-records",
        name: "Demo Records",
        template: "records",
      });
      expect(result.template).toBe("records");
      const bridge = fs.readFileSync(
        path.join(result.pluginRoot, "src", "bridge.ts"),
        "utf8"
      );
      expect(bridge).not.toMatch(/openPluginDb/);
      expect(bridge).toMatch(/records/);
      const manifest = JSON.parse(
        fs.readFileSync(path.join(result.pluginRoot, "godmode.plugin.json"), "utf8")
      ) as {
        objectTypes?: unknown[];
        dataPlane?: string;
        scaffoldTemplate?: string;
      };
      expect(Array.isArray(manifest.objectTypes)).toBe(true);
      expect(manifest.objectTypes?.length).toBeGreaterThan(0);
      expect(manifest.dataPlane).toBe("core-records");
      expect(manifest.scaffoldTemplate).toBe("records");
    } finally {
      delete process.env.GODMODE_PLUGIN_SCAFFOLD_DIR;
    }
  });
});
