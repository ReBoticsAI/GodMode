#!/usr/bin/env node
/**
 * Idempotent demo workspace seed for README screenshots and local exploration.
 *
 * Prerequisites:
 *   - Bridge running (npm run dev) at BRIDGE_URL
 *   - Fresh signup or existing demo account
 *
 * Usage:
 *   node scripts/seed-readme-demo.mjs
 *
 * Env:
 *   BRIDGE_URL=http://localhost:3847
 *   DEMO_EMAIL=demo@godmode.local
 *   DEMO_PASSWORD=your-demo-password   (required)
 *   DEMO_NAME=Demo
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BRIDGE = process.env.BRIDGE_URL || "http://localhost:3847";
const EMAIL = (process.env.DEMO_EMAIL || "readme-demo@godmode.local").trim().toLowerCase();
const PASSWORD = process.env.DEMO_PASSWORD?.trim();
const NAME = process.env.DEMO_NAME || "Demo";

if (!PASSWORD) {
  console.error("DEMO_PASSWORD is required (no default). Example:");
  console.error("  DEMO_PASSWORD=your-secret node scripts/seed-readme-demo.mjs");
  process.exit(1);
}

let sessionCookie = "";

async function request(method, apiPath, body) {
  const res = await fetch(`${BRIDGE}${apiPath}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(sessionCookie ? { Cookie: sessionCookie } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const rawSetCookie = res.headers.get("set-cookie");
  if (rawSetCookie) {
    sessionCookie = rawSetCookie.split(";")[0];
  }
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const msg = json?.error || json?.message || text || res.statusText;
    throw new Error(`${method} ${apiPath} → ${res.status}: ${msg}`);
  }
  if (json?.sessionToken && !sessionCookie) {
    sessionCookie = `godmode_session=${json.sessionToken}`;
  }
  return json;
}

async function ensureAuth() {
  try {
    await request("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
    console.log("Logged in as", EMAIL);
    return;
  } catch (loginErr) {
    try {
      await request("POST", "/api/auth/signup", {
        email: EMAIL,
        password: PASSWORD,
        name: NAME,
      });
      console.log("Signed up as", EMAIL);
    } catch (signupErr) {
      if (String(signupErr.message).includes("409")) {
        throw new Error(
          `Account ${EMAIL} exists but login failed — set DEMO_PASSWORD to the correct password`
        );
      }
      throw signupErr;
    }
  }
}

async function seedStructure() {
  const nodes = [
    { id: "work", parentId: null, label: "Work", icon: "briefcase", kind: "department" },
    { id: "projects", parentId: "work", label: "Projects", icon: "folder-kanban", kind: "division" },
    { id: "dashboard", parentId: "work-projects", label: "Dashboard", icon: "layout-dashboard", kind: "dashboard" },
    { id: "research", parentId: "work-projects", label: "Research", icon: "search", kind: "placeholder" },
    { id: "life", parentId: null, label: "Life", icon: "heart", kind: "department" },
    { id: "personal", parentId: "life", label: "Personal", icon: "user", kind: "division" },
    { id: "goals", parentId: "life-personal", label: "Goals", icon: "target", kind: "placeholder" },
  ];
  for (const n of nodes) {
    try {
      await request("POST", "/api/nodes", n);
      console.log("  structure:", n.label);
    } catch (err) {
      if (String(err.message).includes("409")) {
        console.log("  structure (exists):", n.label);
      } else {
        throw err;
      }
    }
  }
}

async function seedAgent() {
  try {
    const agent = await request("POST", "/api/ai/agents", {
      name: "Research Agent",
      description: "Specialist for research tasks under Work.",
      parentId: "intelligence",
      icon: "search",
    });
    console.log("  agent:", agent.name || agent.id);
  } catch (err) {
    if (String(err.message).includes("409") || String(err.message).includes("already")) {
      console.log("  agent (exists): Research Agent");
    } else {
      console.log("  agent (skipped):", err.message);
    }
  }
}

async function seedTasks() {
  const cards = [
    {
      columnId: "backlog",
      title: "Draft Q3 roadmap",
      description: "Outline priorities for the next quarter.",
      priority: 1,
      tags: ["planning"],
    },
    {
      columnId: "in-progress",
      title: "Review wiki onboarding",
      description: "Update welcome article links.",
      priority: 2,
      tags: ["docs"],
    },
    {
      columnId: "done",
      title: "Set up local dev environment",
      description: "Clone repo, npm install, npm run dev.",
      priority: 3,
      tags: ["setup"],
    },
    {
      columnId: "backlog",
      title: "Automate weekly summary",
      description: "Intelligence should compile calendar + tasks each Friday.",
      priority: 1,
      tags: ["auto", "automation"],
      prompt: "Every Friday, summarize my open tasks and calendar events into a wiki note.",
    },
  ];
  for (const c of cards) {
    try {
      await request("POST", "/api/user/projects/cards", c);
      console.log("  task:", c.title);
    } catch (err) {
      console.log("  task (skipped):", c.title, "-", err.message);
    }
  }
}

async function seedWiki() {
  try {
    await request("POST", "/api/wiki/pages", {
      title: "Getting started with GodMode",
      slug: "getting-started",
      space: "guides",
      bodyMarkdown: [
        "# Getting started",
        "",
        "GodMode is your personal operating system. Use **Intelligence** in the Chat panel to:",
        "",
        "- Create departments and pages",
        "- Manage tasks and calendar events",
        "- Build wiki knowledge over time",
        "",
        "Your **Digital You** agent holds personal preferences and tone.",
      ].join("\n"),
    });
    console.log("  wiki: Getting started with GodMode");
  } catch (err) {
    console.log("  wiki (skipped):", err.message);
  }
}

async function seedCalendar() {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86400000);
  const events = [
    {
      title: "Team sync",
      start_at: tomorrow.toISOString().slice(0, 10) + "T10:00:00",
      end_at: tomorrow.toISOString().slice(0, 10) + "T10:30:00",
    },
    {
      title: "Focus block",
      start_at: tomorrow.toISOString().slice(0, 10) + "T14:00:00",
      end_at: tomorrow.toISOString().slice(0, 10) + "T16:00:00",
    },
  ];
  for (const e of events) {
    try {
      await request("POST", "/api/user/calendar/events", e);
      console.log("  calendar:", e.title);
    } catch (err) {
      console.log("  calendar (skipped):", e.title, "-", err.message);
    }
  }
}

async function seedSupport() {
  try {
    await request("POST", "/api/support/tickets", {
      subject: "Question about Memory and Reflection",
      body: "How do I review proposals from the Reflection engine before they merge into Memory?",
      category: "how-to",
    });
    console.log("  support: sample ticket");
  } catch (err) {
    console.log("  support (skipped):", err.message);
  }
}

async function seedMemories() {
  const memories = [
    "Prefer concise bullet summaries in chat replies.",
    "Primary work area is the Work department; Life holds personal goals.",
    "Use wiki space 'guides' for onboarding documentation.",
  ];
  for (const text of memories) {
    try {
      await request("POST", "/api/ai/memories?agentId=intelligence", { text, scope: "global" });
      console.log("  memory:", text.slice(0, 40) + "…");
    } catch (err) {
      console.log("  memory (skipped):", err.message);
    }
  }
}

async function main() {
  console.log("Seeding demo workspace via", BRIDGE);
  await ensureAuth();
  console.log("Structure:");
  await seedStructure();
  console.log("Agents:");
  await seedAgent();
  console.log("Tasks:");
  await seedTasks();
  console.log("Wiki:");
  await seedWiki();
  console.log("Calendar:");
  await seedCalendar();
  console.log("Support:");
  await seedSupport();
  console.log("Memories:");
  await seedMemories();
  console.log("Done. Log in at http://localhost:5173 as", EMAIL);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
