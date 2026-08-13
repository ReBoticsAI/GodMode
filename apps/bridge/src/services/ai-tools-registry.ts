import type { AppDatabase } from "../db.js";
import { agentCodeAccess, getAgent } from "./agents/agents-db.js";
import { isOperatorTenantDb } from "./tenant-kind.js";
import { pluginToolsAsAiDefs, isTradingDepartmentPluginTool } from "../plugins/plugin-tools.js";
import {
  filterToolsForChatMode,
  type IntelligenceChatMode,
} from "./chat-mode.js";
import {
  genericObjectTypeToolDefs,
  objectTypeAutoToolDefs,
} from "../kernel/auto-tools.js";
import { pageKindJsonSchema } from "../kernel/kind-registry.js";

/** JSON-schema for structure node `kind` — live Kind registry (plugins extend). */
function kindSchema(): Record<string, unknown> {
  const base = pageKindJsonSchema();
  return { ...base, description: "Page renderer kind from the Kind registry" };
}

export type ToolMode = "auto" | "confirm";

export interface AiToolDef {
  name: string;
  description: string;
  mode: ToolMode;
  parameters?: Record<string, unknown>;
  /** Coarse grouping used to derive per-department tool access. */
  category?: string;
  /** Department ids this tool is scoped to (empty/undefined = general). */
  departments?: string[];
  /**
   * Auto-mode tools default to read-only. Set when an `auto` tool mutates state
   * (writes data without a confirm gate) so the tools index labels it honestly.
   */
  write?: boolean;
}

const supersededStaticName = (name: string): string => name;

/** Registry of platform tools exposed to the model (schemas for inspect UI). */
export const AI_TOOL_REGISTRY: AiToolDef[] = [
  {
    name: "remember",
    description: "Save a short fact to persistent memory.",
    mode: "auto",
  },
  {
    name: "use_skill",
    description:
      "Load the full step-by-step instructions for a named skill. Pass the skill id in `skillId` (e.g. 'plugin-authoring' for Bridge plugins, 'platform-workspace' for Tier 1 setup, 'shadcn-ui' before apps/web edits). Call this BEFORE starting a workflow the skill covers.",
    mode: "auto",
    parameters: {
      type: "object",
      properties: {
        skillId: {
          type: "string",
          description:
            "Skill id from the 'Available skills' list (e.g. plugin-authoring, platform-workspace, shadcn-ui).",
        },
      },
      required: ["skillId"],
    },
  },
  {
    name: "web_search",
    description:
      "Search the web and return result titles, URLs, and snippets. On GodMode Cloud this uses Exa with a tenant/agent BYOK key (Vault secret exa_api_key or agent provider exa). Self-host may fall back to DuckDuckGo when no Exa key is configured. Use for live/current information not in your training data.",
    mode: "auto",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number", description: "Max results (default 5, max 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "fetch_url",
    description:
      "Fetch a web page (or any URL) and return its readable text content. On GodMode Cloud this uses Exa contents with a tenant/agent BYOK key (same as web_search). Self-host may fall back to a direct fetch when no Exa key is configured. Use after web_search to read a specific result, or when given a URL directly.",
    mode: "auto",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        maxChars: { type: "number", description: "Max characters of text (default 6000)" },
      },
      required: ["url"],
    },
  },
  {
    name: "save_artifact",
    description:
      "Save a text file to this agent's private artifacts directory. Overwrites by name.",
    mode: "auto",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "File name (no path components)" },
        content: { type: "string" },
        kind: { type: "string" },
        mimeType: { type: "string" },
        description: { type: "string" },
      },
      required: ["name", "content"],
    },
  },
  {
    name: "read_artifact",
    description: "Read a saved artifact's content by id or name (this agent only).",
    mode: "auto",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
      },
    },
  },
  {
    name: supersededStaticName("list_artifacts"),
    description: "List this agent's saved artifacts (id, name, size, description).",
    mode: "auto",
    parameters: {
      type: "object",
      properties: { limit: { type: "number" } },
    },
  },
  {
    name: supersededStaticName("delete_artifact"),
    description: "Delete one of this agent's artifacts by id or name. Requires confirmation.",
    mode: "confirm",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
      },
    },
  },
  {
    name: "create_project_card",
    description:
      "Create a standing card on the user's Projects Kanban (work they asked to track outside the current chat run). Set priority (1=high,2=med,3=low) and tags (e.g. [\"auto\"] for the autonomous runner). prompt holds the detailed goal for the runner. Do NOT use this to plan your own Intelligence Active Work turn: use todo_write (it nests under the host-run card).",
    mode: "auto",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        columnId: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        prompt: { type: "string" },
        priority: { type: "number", description: "1=high, 2=medium, 3=low" },
        tags: { type: "array", items: { type: "string" } },
        assignedAgentId: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "move_project_card",
    description: "Move a Kanban card to another column.",
    mode: "auto",
    parameters: {
      type: "object",
      properties: {
        cardId: { type: "string" },
        columnId: { type: "string" },
      },
      required: ["cardId", "columnId"],
    },
  },
  {
    name: "list_project_cards",
    description:
      "Query Kanban cards. Filter by columnId/priority/parentCardId; default sorts by priority (1=high..3=low) and excludes subtasks. Use limit:1 to grab the single top card.",
    mode: "auto",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        columnId: { type: "string" },
        priority: { type: "number" },
        parentCardId: { type: ["string", "null"] },
        includeSubtasks: { type: "boolean" },
        sort: { type: "string", enum: ["priority", "order"] },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "set_card_priority",
    description: "Set a card's priority (1=high, 2=medium, 3=low).",
    mode: "auto",
    parameters: {
      type: "object",
      properties: {
        cardId: { type: "string" },
        priority: { type: "number" },
      },
      required: ["cardId", "priority"],
    },
  },
  {
    name: "create_subtask",
    description:
      "Create a subtask under an existing parent card (standing user Kanban work). Inherits the parent's project and priority; defaults to the In Progress column. Do NOT use this to build the chat Active Work plan hierarchy: use todo_write with nested subtasks under the host-run card instead.",
    mode: "auto",
    parameters: {
      type: "object",
      properties: {
        parentCardId: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        prompt: { type: "string" },
        columnId: { type: "string" },
      },
      required: ["parentCardId", "title"],
    },
  },
  {
    name: "list_subtasks",
    description:
      "List subtasks for a parent card plus a {total, done, open} progress summary.",
    mode: "auto",
    parameters: {
      type: "object",
      properties: { parentCardId: { type: "string" } },
      required: ["parentCardId"],
    },
  },
  {
    name: "add_card_comment",
    description:
      "Append a comment to a card's review thread. author is 'agent' (default) or 'user'. Optional kind tags it as an audit entry: note | action | result | issue.",
    mode: "auto",
    parameters: {
      type: "object",
      properties: {
        cardId: { type: "string" },
        body: { type: "string" },
        author: { type: "string", enum: ["agent", "user"] },
        kind: { type: "string", enum: ["note", "action", "result", "issue"] },
      },
      required: ["cardId", "body"],
    },
  },
  {
    name: "comment_card",
    description:
      "Append a short audit-log note to a card as you work it — what you ran, the result, or a problem you hit. REQUIRED: `cardId` (the card/subtask id) AND `body` (the note text, a non-empty sentence). A `kind` alone is NOT enough — always include the sentence in `body`. kind is note | action | result | issue (default note). Send each note once; do not repeat the same comment.",
    mode: "auto",
    parameters: {
      type: "object",
      properties: {
        cardId: { type: "string" },
        body: { type: "string" },
        kind: { type: "string", enum: ["note", "action", "result", "issue"] },
      },
      required: ["cardId", "body"],
    },
  },
  {
    name: supersededStaticName("list_card_comments"),
    description: "List the comment thread for a card, oldest first.",
    mode: "auto",
    parameters: {
      type: "object",
      properties: { cardId: { type: "string" } },
      required: ["cardId"],
    },
  },
  {
    name: "list_user_calendar",
    description:
      "List the authenticated user's personal calendar events. Optional ISO from/to range filters.",
    mode: "auto",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "create_user_calendar_event",
    description:
      "Create an event on the authenticated user's personal calendar.",
    mode: "confirm",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        start_at: { type: "string" },
        end_at: { type: "string" },
        kind: { type: "string", enum: ["event", "task", "appointment"] },
        description: { type: "string" },
        location: { type: "string" },
        all_day: { type: "boolean" },
      },
      required: ["title", "start_at"],
    },
  },
  {
    name: "list_user_tasks",
    description:
      "List the authenticated user's personal Kanban task cards. Filter by columnId; excludes subtasks by default.",
    mode: "auto",
    parameters: {
      type: "object",
      properties: {
        columnId: { type: "string" },
        includeSubtasks: { type: "boolean" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "create_user_task",
    description:
      "Add a to-do item to the human USER's personal task board. This is NOT a notification/alert/message — when asked to 'create a notification', 'notify', or 'send a message', use create_notification instead. For your OWN Active Work chat plan use todo_write only (not create_subtask / create_project_card).",
    mode: "confirm",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        columnId: { type: "string" },
        dueAt: { type: "string" },
        priority: { type: "number" },
      },
      required: ["title"],
    },
  },
  {
    name: "watch_pr_checks",
    description:
      "Babysit GitHub PR CI for Core work. Returns pending/success/failure for required checks. Do not close issues or mark Done while state is pending or failure; fix failures with production-grade changes (no workarounds) and re-check.",
    mode: "auto",
    parameters: {
      type: "object",
      properties: {
        pr: {
          type: "string",
          description: "PR number or URL (e.g. 461 or https://github.com/org/repo/pull/461)",
        },
        repo: {
          type: "string",
          description: "owner/name when pr is a bare number (default ReBoticsAI/GodMode)",
        },
      },
      required: ["pr"],
    },
  },
  {
    name: "update_card",
    description:
      "Partial update of a card: columnId (lane), status, title, description, priority, assignedAgentId. Use for lane transitions and lifecycle status.",
    mode: "confirm",
    parameters: {
      type: "object",
      properties: {
        cardId: { type: "string" },
        columnId: { type: "string" },
        status: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        priority: { type: "number" },
        assignedAgentId: { type: "string" },
      },
      required: ["cardId"],
    },
  },
  {
    name: "delegate_to_subagent",
    description:
      "Invoke another named subagent with a prompt and return a structured result: { agentId, status: ok|timeout|error, answer?, error?, durationMs }. Default wall-clock timeout is 120s (override with timeoutMs, max 300s). On timeout or error, recover by narrowing the ask, retrying, or using explore_codebase. Requires user confirmation.",
    mode: "confirm",
    parameters: {
      type: "object",
      properties: {
        agent: { type: "string", description: "Subagent id or name" },
        prompt: { type: "string" },
        context: { type: "string", description: "Optional extra context for the subagent" },
        timeoutMs: {
          type: "number",
          description:
            "Optional wall-clock timeout in milliseconds (default 120000, max 300000)",
        },
        mode: {
          type: "string",
          enum: ["explore", "implement"],
          description:
            "explore = read-only coding search handoff. implement = full subagent (default).",
        },
      },
      required: ["agent", "prompt"],
    },
  },
  {
    name: "list_subagents",
    description: "List available subagents (id, name, backend, description).",
    mode: "auto",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "todo_write",
    description:
      "Create or update your Active Work plan for this chat. Items nest under the host-run card by default (do not create_project_card a parallel parent). Persist as Kanban cards (pending→Backlog, in_progress→In Progress, completed/cancelled→Done) and as a live in-chat checklist. For multi-step work: ONE parent with nested subtasks (exactly one in_progress); pass the FULL nested list each time with updated statuses so cards update in place. Parent items with nested subtasks are auto-tagged for the autonomous executor. Optional maxTaskTicks (default 200) on the parent or top level for long runs.",
    mode: "auto",
    parameters: {
      type: "object",
      properties: {
        merge: {
          type: "boolean",
          description: "Merge into the existing list by id instead of replacing.",
        },
        maxTaskTicks: {
          type: "number",
          description:
            "Tick budget for autonomous parent tasks with subtasks (default 200).",
        },
        todos: {
          type: "array",
          description: "The full ordered list of todo items.",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "stable id for this item" },
              content: { type: "string", description: "what the step does" },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed", "cancelled"],
              },
              auto: {
                type: "boolean",
                description:
                  "Opt parent into autonomous resume (default true when subtasks are present).",
              },
              maxTaskTicks: {
                type: "number",
                description: "Per-parent tick budget when subtasks are present.",
              },
            },
            required: ["content", "status"],
          },
        },
      },
      required: ["todos"],
    },
  },
  {
    name: "ask_cursor_agent",
    description:
      "LAST RESORT only when the USER explicitly requests Cursor CLI delegation. Intelligence should implement code itself via read_file/edit_file/run_terminal. Dispatches to cursor-agent with GodMode context bundle. Requires confirmation.",
    mode: "confirm",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The task or question for the Cursor agent" },
        model: {
          type: "string",
          description: "Model id (default 'auto'); e.g. gpt-5.2, sonnet-4, composer-2.5",
        },
        mode: {
          type: "string",
          enum: ["plan", "ask"],
          description: "plan = read-only planning; ask = read-only Q&A; omit for full agent mode",
        },
        worktree: {
          type: "boolean",
          description: "Run in an isolated git worktree (default true). Set false to act on the live tree.",
        },
        workspace: {
          type: "string",
          description: "Workspace directory (defaults to the platform repo)",
        },
        force: {
          type: "boolean",
          description: "Allow shell commands without prompting (headless). Use with care.",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: supersededStaticName("create_skill"),
    description:
      "Draft a playbook skill (named steps: when X, do Y). Pending approval. Rejected if too short or a near-duplicate.",
    mode: "confirm",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Human-readable skill name" },
        description: { type: "string", description: "One-line summary" },
        body: { type: "string", description: "Full step-by-step skill instructions (markdown)" },
        tools: { type: "array", items: { type: "string" } },
        departments: { type: "array", items: { type: "string" } },
      },
      required: ["name", "description", "body"],
    },
  },
  {
    name: supersededStaticName("create_rule"),
    description:
      "Draft a new file-backed rule (.mdc guardrail) for this agent. Created in 'pending' status awaiting user approval before it is applied.",
    mode: "confirm",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Human-readable rule name" },
        description: { type: "string", description: "One-line summary" },
        body: { type: "string", description: "Full rule text (markdown)" },
        globs: { type: "array", items: { type: "string" } },
        departments: { type: "array", items: { type: "string" } },
        alwaysApply: { type: "boolean" },
        priority: { type: "number" },
      },
      required: ["name", "description", "body"],
    },
  },

  /* -------------------- Platform Builder: Structure (Phase A) ------------- */
  {
    name: "list_structure",
    description:
      "List the full platform structure tree (departments, divisions, pages).",
    mode: "auto",
  },
  ...genericObjectTypeToolDefs(),
  {
    name: "create_department",
    description:
      "Create a new top-level department. Empty departments show DepartmentOverview (\"No workspaces configured…\") and are NOT a notes/app surface - also create divisions/pages (or wiki) the user can open. Platform-wide action — Intelligence only. Requires confirmation.",
    mode: "confirm",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "lowercase slug (a-z 0-9 -)" },
        label: { type: "string" },
        icon: { type: "string", description: "lucide icon slug" },
        kind: { ...kindSchema(), description: "Page renderer kind (default placeholder)" },
      },
      required: ["id", "label", "icon"],
    },
  },
  {
    name: "create_division",
    description:
      "Create a division under a department. Requires editor on the department. Requires confirmation.",
    mode: "confirm",
    parameters: {
      type: "object",
      properties: {
        departmentId: { type: "string" },
        id: { type: "string", description: "lowercase slug (a-z 0-9 -)" },
        label: { type: "string" },
        icon: { type: "string", description: "lucide icon slug" },
        rightSidebar: { type: "string", description: "Plugin sidebar slot id, or none to clear" },
        kind: { ...kindSchema(), description: "Page renderer kind (plugin-registered or core)" },
        segment: { type: "string", description: "URL segment (defaults to id)" },
      },
      required: ["departmentId", "id", "label", "icon"],
    },
  },
  {
    name: "create_page",
    description:
      "Create a page under a division (starts as a placeholder renderer unless kind is set, e.g. record-list). For notes/content apps set a real kind and object_type; placeholder-only pages are incomplete. Requires editor on the division. Requires confirmation.",
    mode: "confirm",
    parameters: {
      type: "object",
      properties: {
        departmentId: { type: "string" },
        divisionId: { type: "string" },
        id: { type: "string", description: "lowercase slug (a-z 0-9 -)" },
        label: { type: "string" },
        icon: { type: "string", description: "lucide icon slug" },
        segment: { type: "string", description: "URL segment (a-z 0-9 -, may be empty)" },
        kind: { ...kindSchema(), description: "Page renderer kind (plugin-registered or core)" },
      },
      required: ["departmentId", "divisionId", "id", "label", "icon"],
    },
  },
  {
    name: supersededStaticName("update_structure_node"),
    description:
      "Update a department, division, or page (label/icon/segment/rightSidebar/kind). Requires editor. Requires confirmation.",
    mode: "confirm",
    parameters: {
      type: "object",
      properties: {
        nodeType: { type: "string", enum: ["department", "division", "page"] },
        departmentId: { type: "string" },
        divisionId: { type: "string" },
        pageId: { type: "string" },
        label: { type: "string" },
        icon: { type: "string" },
        segment: { type: "string" },
        rightSidebar: { type: "string", description: "Plugin sidebar slot id, or none to clear" },
        kind: kindSchema(),
      },
      required: ["nodeType", "departmentId"],
    },
  },
  {
    name: supersededStaticName("delete_structure_node"),
    description:
      "Delete a non-built-in department, division, or page. Requires owner. Requires confirmation.",
    mode: "confirm",
    parameters: {
      type: "object",
      properties: {
        nodeType: { type: "string", enum: ["department", "division", "page"] },
        departmentId: { type: "string" },
        divisionId: { type: "string" },
        pageId: { type: "string" },
      },
      required: ["nodeType", "departmentId"],
    },
  },
  {
    name: "assign_agent",
    description:
      "Assign a subagent (with a viewer/editor/owner role) to a department, division, or page scope. Requires owner. Requires confirmation.",
    mode: "confirm",
    parameters: {
      type: "object",
      properties: {
        scopeType: { type: "string", enum: ["department", "division", "page"] },
        scopeId: { type: "string", description: "e.g. trading, trading/sierra, trading/sierra/dashboard" },
        agentId: { type: "string" },
        role: { type: "string", enum: ["viewer", "editor", "owner"] },
      },
      required: ["scopeType", "scopeId", "agentId"],
    },
  },
  {
    name: "set_agent_role",
    description:
      "Change the role of the agent already assigned to a scope. Requires owner. Requires confirmation.",
    mode: "confirm",
    parameters: {
      type: "object",
      properties: {
        scopeType: { type: "string", enum: ["department", "division", "page"] },
        scopeId: { type: "string" },
        role: { type: "string", enum: ["viewer", "editor", "owner"] },
      },
      required: ["scopeType", "scopeId", "role"],
    },
  },
  {
    name: supersededStaticName("create_agent"),
    description:
      "Create a new subagent (page-owner or specialist). Intelligence-only platform action. Requires confirmation.",
    mode: "confirm",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Optional deterministic id (e.g. trading-dashboard)" },
        name: { type: "string" },
        description: { type: "string" },
        icon: { type: "string", description: "lucide icon slug" },
        parentId: { type: "string", description: "Parent agent id (default intelligence)" },
        systemPrompt: { type: "string" },
        cloneFromId: { type: "string", description: "Clone settings from an existing agent" },
        modelPath: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "attach_node_agent",
    description:
      "Attach an agent to a structure node so navigation auto-opens that agent's chat. Sets structure_nodes.agent_id (distinct from RBAC assign_agent). Requires editor. Requires confirmation.",
    mode: "confirm",
    parameters: {
      type: "object",
      properties: {
        nodeId: { type: "string", description: "structure_nodes.id (e.g. trading-sierra)" },
        agentId: { type: "string", description: "Agent id to attach, or null to detach" },
      },
      required: ["nodeId"],
    },
  },

  /* -------------------- Shares & collaboration --------------------------- */
  {
    name: supersededStaticName("list_share_grants"),
    description:
      "List share grants owned by or granted to the current user (includes shared sidebar tree).",
    mode: "auto",
  },
  {
    name: supersededStaticName("create_share_grant"),
    description:
      "Share a department, division, page, agent, or other resource with another user or tenant. Requires confirmation.",
    mode: "confirm",
    parameters: {
      type: "object",
      properties: {
        resourceKind: {
          type: "string",
          enum: [
            "agent",
            "department",
            "division",
            "page",
            "model",
            "workflow",
            "skill",
            "rule",
            "artifact",
          ],
        },
        resourceId: { type: "string" },
        granteeUserId: { type: "string" },
        granteeEmail: { type: "string", description: "Resolve grantee by email if userId omitted" },
        granteeTenantId: { type: "string" },
        role: { type: "string", enum: ["viewer", "editor", "owner"] },
      },
      required: ["resourceKind", "resourceId"],
    },
  },
  {
    name: "share_model",
    description:
      "Share a local .gguf model path with another user (creates inference endpoint + model grant). Requires confirmation.",
    mode: "confirm",
    parameters: {
      type: "object",
      properties: {
        modelPath: { type: "string" },
        granteeUserId: { type: "string" },
        granteeEmail: { type: "string" },
        name: { type: "string", description: "Display name for the shared model" },
      },
      required: ["modelPath"],
    },
  },
  {
    name: "revoke_share_grant",
    description: "Revoke a share grant you own. Requires confirmation.",
    mode: "confirm",
    parameters: {
      type: "object",
      properties: { grantId: { type: "string" } },
      required: ["grantId"],
    },
  },

  /* -------------------- Automations / workflows -------------------------- */
  {
    name: supersededStaticName("list_workflows"),
    description: "List automation workflows for the active agent.",
    mode: "auto",
    parameters: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Defaults to active agent" },
      },
    },
  },
  {
    name: "run_workflow",
    description:
      "Enqueue a stored automation workflow for serialized execution (same path as schedules/hooks). Prefer this over long improvised tool chains when capabilities suggest a matching workflow.",
    mode: "confirm",
    parameters: {
      type: "object",
      properties: {
        workflowId: { type: "string", description: "Workflow id (e.g. autonomous-task-runner)" },
        input: {
          description: "Optional trigger input string or JSON object passed to the workflow",
        },
      },
      required: ["workflowId"],
    },
  },
  {
    name: supersededStaticName("create_workflow"),
    description:
      "Create an automation workflow (directed graph of trigger/prompt/tool/agent nodes). Requires confirmation.",
    mode: "confirm",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        agentId: { type: "string" },
        config: { type: "object", description: "WorkflowGraph { nodes, edges, triggerEvents? }" },
        enabled: { type: "boolean" },
      },
      required: ["name"],
    },
  },
  {
    name: supersededStaticName("update_workflow"),
    description: "Update a workflow name, graph config, or enabled flag. Requires confirmation.",
    mode: "confirm",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        config: { type: "object" },
        enabled: { type: "boolean" },
      },
      required: ["id"],
    },
  },
  {
    name: supersededStaticName("list_schedules"),
    description: "List cron schedules for automation workflows.",
    mode: "auto",
  },
  {
    name: supersededStaticName("create_schedule"),
    description:
      "Create a cron schedule to run a workflow on a timer. Requires confirmation.",
    mode: "confirm",
    parameters: {
      type: "object",
      properties: {
        workflowId: { type: "string" },
        cronExpr: { type: "string" },
        timezone: { type: "string" },
        enabled: { type: "boolean" },
      },
      required: ["workflowId", "cronExpr"],
    },
  },

  // --- Coding / terminal (Cursor parity; requires agent codeAccess) ---
  {
    name: "read_file",
    description: "Read a text file from the platform repository (line-numbered, offset/limit supported).",
    mode: "auto",
    category: "coding",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        offset: { type: "number", description: "1-based start line (default 1)" },
        limit: { type: "number", description: "Max lines to return (default 2000)" },
      },
      required: ["path"],
    },
  },
  {
    name: "list_dir",
    description: "List files and directories under a repo path.",
    mode: "auto",
    category: "coding",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path (default .)" },
        recursive: { type: "boolean" },
      },
    },
  },
  {
    name: "glob",
    description: "Find files matching a glob pattern under the repo (e.g. **/*.ts).",
    mode: "auto",
    category: "coding",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        cwd: { type: "string", description: "Search root relative to repo (default .)" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "grep",
    description: "Search file contents with a regex (uses ripgrep when available).",
    mode: "auto",
    category: "coding",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
        glob: { type: "string" },
        caseInsensitive: { type: "boolean" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "write_file",
    description: "Write or overwrite a file in the platform repository. Requires confirmation.",
    mode: "confirm",
    category: "coding",
    write: true,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description:
      "Replace exactly one unique old_string with new_string in a repo file. Requires confirmation.",
    mode: "confirm",
    category: "coding",
    write: true,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_string: { type: "string" },
        new_string: { type: "string" },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  {
    name: "delete_file",
    description: "Delete a file in the platform repository. Requires confirmation.",
    mode: "confirm",
    category: "coding",
    write: true,
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "run_terminal",
    description:
      "Run a one-shot shell command in the platform repository (cwd relative to repo root). Prefer terminal_session_* + terminal_monitor for long-lived servers, watchers, or REPLs. Requires confirmation unless agent has codeAutonomy.",
    mode: "confirm",
    category: "coding",
    write: true,
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: { type: "string", description: "Working directory relative to repo (default .)" },
        timeoutMs: { type: "number" },
      },
      required: ["command"],
    },
  },
  {
    name: "terminal_session_create",
    description:
      "Create a shared sandboxed PTY session (interactive shell). Use for long-lived processes; humans can attach in Coding Terminal. Prefer over run_terminal for servers/watchers/REPLs.",
    mode: "confirm",
    category: "coding",
    write: true,
    parameters: {
      type: "object",
      properties: {
        cwd: { type: "string" },
        name: { type: "string" },
        shell: { type: "string", description: "bash | sh (default bash)" },
      },
    },
  },
  {
    name: "terminal_session_list",
    description: "List shared PTY sessions for this tenant (id, cwd, running, lastLine, attachedClients).",
    mode: "auto",
    category: "coding",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "terminal_session_read",
    description:
      "Read scrollback from a shared PTY session (like reading a background output file). Pass sinceOffset from a prior read for incremental chunks.",
    mode: "auto",
    category: "coding",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        sinceOffset: { type: "number" },
        maxChars: { type: "number" },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "terminal_session_write",
    description:
      "Write to a shared PTY session stdin (commands, Ctrl+C as \\u0003, etc.). Humans may also type when attached.",
    mode: "confirm",
    category: "coding",
    write: true,
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        data: { type: "string" },
      },
      required: ["sessionId", "data"],
    },
  },
  {
    name: "terminal_session_close",
    description: "Kill and remove a shared PTY session.",
    mode: "confirm",
    category: "coding",
    write: true,
    parameters: {
      type: "object",
      properties: { sessionId: { type: "string" } },
      required: ["sessionId"],
    },
  },
  {
    name: "terminal_monitor",
    description:
      "Subscribe to new PTY output for this chat turn (Claude Monitor analogue). Batches lines (~200ms), caps bytes, stops on idle timeout, regex pattern, session exit, or abort. Prefer over busy-polling terminal_session_read.",
    mode: "auto",
    category: "coding",
    parameters: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        idleMs: { type: "number", description: "Stop after this idle (default 8000)" },
        pattern: { type: "string", description: "Stop when this regex matches recent output" },
        maxBytes: { type: "number" },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "codebase_search",
    description:
      "Hybrid semantic codebase search for natural-language questions (where/how is X handled?). Fuses code-chunk vectors with ripgrep when the code embedder is ready; soft-fails to grep-only with an explicit note when embeddings are down or warming. Empty results in soft-fail mode are inconclusive. Prefer this for exploratory NL queries; use grep for exact symbols/regex and glob for path patterns.",
    mode: "auto",
    category: "coding",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Natural-language or symbol query (e.g. \"where is chat compaction handled?\")",
        },
        path: { type: "string" },
        glob: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "apply_patch",
    description:
      "Apply a unified diff patch to a repo file (multi-hunk). Requires confirmation. Prefer over edit_file for multi-line changes.",
    mode: "confirm",
    category: "coding",
    write: true,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        patch: { type: "string", description: "Unified diff content" },
      },
      required: ["path", "patch"],
    },
  },
  {
    name: "read_diagnostics",
    description: "Run TypeScript typecheck (tsc --noEmit) and return structured diagnostics.",
    mode: "auto",
    category: "coding",
    parameters: {
      type: "object",
      properties: {
        cwd: { type: "string", description: "Package root relative to repo (default .)" },
      },
    },
  },
  {
    name: "revert_file",
    description: "Revert a file to git HEAD. Requires confirmation.",
    mode: "confirm",
    category: "coding",
    write: true,
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "git_status",
    description:
      "Show git branch, dirty files, ahead/behind, remotes, and local branches for the coding root. Prefer this over run_terminal git status.",
    mode: "auto",
    category: "coding",
  },
  {
    name: "git_diff",
    description:
      "Show unstaged or staged git diff for the coding root (optional path).",
    mode: "auto",
    category: "coding",
    parameters: {
      type: "object",
      properties: {
        staged: { type: "boolean", description: "If true, show staged diff" },
        path: { type: "string", description: "Optional path relative to coding root" },
      },
    },
  },
  {
    name: "git_branch",
    description: "Create a local git branch on the coding root. Requires confirmation.",
    mode: "confirm",
    category: "coding",
    write: true,
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "New branch name" },
        checkout: {
          type: "boolean",
          description: "Switch to the new branch (default true)",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "git_checkout",
    description: "Switch the coding-root work tree to an existing local branch. Requires confirmation.",
    mode: "confirm",
    category: "coding",
    write: true,
    parameters: {
      type: "object",
      properties: { ref: { type: "string", description: "Branch or ref name" } },
      required: ["ref"],
    },
  },
  {
    name: "git_add",
    description: "Stage paths in the coding-root git index. Requires confirmation.",
    mode: "confirm",
    category: "coding",
    write: true,
    parameters: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Paths relative to the coding root (use \".\" for all)",
        },
      },
      required: ["paths"],
    },
  },
  {
    name: "git_commit",
    description:
      "Commit staged changes on the coding root. Strips Cursor Cloud Co-authored-by / Made-with trailers. Confirm shows the staged diff. Does not push. Prefer over Cursor Cloud Agent commits for public GodMode. Requires confirmation.",
    mode: "confirm",
    category: "coding",
    write: true,
    parameters: {
      type: "object",
      properties: {
        message: { type: "string" },
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Optional paths to stage before commit",
        },
      },
      required: ["message"],
    },
  },
  {
    name: "git_push",
    description:
      "Push the current (or named) branch to an existing HTTPS remote. Never force-pushes. Always requires confirmation, including full autonomy. PR create is a separate host connector / Official GitHub plugin tool.",
    mode: "confirm",
    category: "coding",
    write: true,
    parameters: {
      type: "object",
      properties: {
        remote: { type: "string", description: "Remote name (default origin)" },
        branch: { type: "string", description: "Branch to push (default current)" },
      },
    },
  },
  {
    name: "explore_codebase",
    description:
      "Spawn parallel read-only codebase explorations (grep/search). Use for wide searches before editing.",
    mode: "auto",
    category: "coding",
    parameters: {
      type: "object",
      properties: {
        queries: {
          type: "array",
          items: { type: "string" },
          description: "Up to 4 search queries to run in parallel",
        },
        query: { type: "string", description: "Single query (alias when queries omitted)" },
      },
    },
  },
  {
    name: "explore_coding",
    description:
      "Launch a bounded read-only coding explore sub-run. Returns { paths, findings, openQuestions, status, implementOnParent: true }. Parent must implement edits. Prefer this over mutating tools when you only need to locate code.",
    mode: "auto",
    category: "coding",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "What to find or explain in the coding root" },
        query: { type: "string", description: "Alias for prompt" },
        agent: { type: "string", description: "Optional explorer agent id (default current)" },
        timeoutMs: { type: "number" },
      },
    },
  },
  // --- Notifications ---
  {
    name: supersededStaticName("list_notifications"),
    description: "List notifications for the current user or active agent.",
    mode: "auto",
    parameters: {
      type: "object",
      properties: {
        unreadOnly: { type: "boolean" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: supersededStaticName("create_notification"),
    description:
      "Send a notification/alert/message to a user or agent — e.g. a summary, review, or status update they should see. This is the CORRECT tool whenever the user asks you to 'create a notification', 'notify', or 'send a message'. Provide a real `title` AND a non-empty `body` (blank notifications are rejected). Not a task card.",
    mode: "confirm",
    write: true,
    parameters: {
      type: "object",
      properties: {
        recipientKind: { type: "string", enum: ["user", "agent"] },
        recipientId: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
        link: { type: "string" },
        category: { type: "string" },
      },
      required: ["recipientKind", "recipientId", "title"],
    },
  },
  {
    name: "mark_notification_read",
    description: "Mark one or more notifications as read.",
    mode: "auto",
    write: true,
    parameters: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" } },
        markAll: { type: "boolean" },
      },
    },
  },
  // --- Support ---
  {
    name: supersededStaticName("create_support_ticket"),
    description: "Submit a support ticket to platform admins.",
    mode: "confirm",
    write: true,
    parameters: {
      type: "object",
      properties: {
        subject: { type: "string" },
        body: { type: "string" },
        category: { type: "string" },
        priority: { type: "string" },
      },
      required: ["subject", "body"],
    },
  },
  {
    name: supersededStaticName("list_support_tickets"),
    description: "List support tickets for the requester or all tickets (admin).",
    mode: "auto",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string" },
        admin: { type: "boolean", description: "List all tickets (admin only)" },
      },
    },
  },
  {
    name: "reply_support_ticket",
    description: "Add a message to a support ticket. Requires confirmation.",
    mode: "confirm",
    write: true,
    parameters: {
      type: "object",
      properties: {
        ticketId: { type: "string" },
        body: { type: "string" },
      },
      required: ["ticketId", "body"],
    },
  },
  {
    name: "update_support_ticket",
    description: "Update support ticket status (admin). Requires confirmation.",
    mode: "confirm",
    write: true,
    parameters: {
      type: "object",
      properties: {
        ticketId: { type: "string" },
        status: { type: "string", enum: ["open", "in_progress", "resolved", "closed"] },
      },
      required: ["ticketId", "status"],
    },
  },
  // --- Wiki ---
  {
    name: supersededStaticName("list_wiki_pages"),
    description: "List wiki pages visible to the current user.",
    mode: "auto",
    parameters: {
      type: "object",
      properties: {
        visibility: { type: "string", enum: ["internal", "external"] },
        space: { type: "string" },
        q: { type: "string" },
      },
    },
  },
  {
    name: "read_wiki_page",
    description: "Read a wiki page by id or slug.",
    mode: "auto",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        slug: { type: "string" },
      },
    },
  },
  {
    name: supersededStaticName("create_wiki_page"),
    description:
      "Create a wiki page. Prefer this (or record-list pages) for personal notes / notes-taker asks instead of an empty department. Requires confirmation.",
    mode: "confirm",
    write: true,
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        bodyMarkdown: { type: "string" },
        visibility: { type: "string", enum: ["internal", "external"] },
        space: { type: "string" },
        slug: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: supersededStaticName("update_wiki_page"),
    description: "Update a wiki page. Requires confirmation.",
    mode: "confirm",
    write: true,
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        bodyMarkdown: { type: "string" },
        visibility: { type: "string", enum: ["internal", "external"] },
        space: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: supersededStaticName("delete_wiki_page"),
    description: "Delete a wiki page. Requires confirmation.",
    mode: "confirm",
    write: true,
    parameters: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  // --- DM / chat ---
  {
    name: "list_conversations",
    description: "List DM/group conversations for the current user.",
    mode: "auto",
    parameters: {
      type: "object",
      properties: { limit: { type: "number" } },
    },
  },
  {
    name: "read_conversation",
    description: "Read messages in a DM/group conversation.",
    mode: "auto",
    parameters: {
      type: "object",
      properties: {
        conversationId: { type: "string" },
        limit: { type: "number" },
        before: { type: "string" },
      },
      required: ["conversationId"],
    },
  },
  {
    name: "send_message",
    description: "Send a message in a DM/group conversation. Requires confirmation.",
    mode: "confirm",
    write: true,
    parameters: {
      type: "object",
      properties: {
        conversationId: { type: "string" },
        body: { type: "string" },
      },
      required: ["conversationId", "body"],
    },
  },
  {
    name: "create_conversation",
    description: "Create a DM or group conversation. Requires confirmation.",
    mode: "confirm",
    write: true,
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["dm", "group"] },
        title: { type: "string" },
        memberUserIds: { type: "array", items: { type: "string" } },
        memberAgentIds: { type: "array", items: { type: "string" } },
      },
      required: ["kind", "memberUserIds"],
    },
  },
  // --- Hooks / events ---
  {
    name: supersededStaticName("list_hooks"),
    description: "List automation hooks owned by the user or their agents.",
    mode: "auto",
    parameters: { type: "object", properties: {} },
  },
    {
    name: supersededStaticName("create_hook"),
    description:
      "Create an automation hook so you can KEEP WORKING across turns (self-loop). For a recurring timer loop set triggerKind:'schedule' WITH scheduleCron (cron, e.g. '*/5 * * * *') and actionKind:'run_agent' WITH actionConfigJson = a JSON STRING '{\"agentId\":\"<your agent id>\",\"prompt\":\"<what to do each wake>\"}'. ownerKind defaults to 'agent' and ownerId to your agent id. A schedule hook MUST include scheduleCron; an event hook (triggerKind:'event') MUST include eventType. Requires confirmation.",
    mode: "confirm",
    write: true,
    parameters: {
      type: "object",
      properties: {
        ownerKind: { type: "string", enum: ["user", "agent"], description: "Default 'agent'." },
        ownerId: { type: "string", description: "Your agent id when ownerKind='agent'." },
        name: { type: "string" },
        triggerKind: {
          type: "string",
          enum: ["event", "schedule"],
          description: "'schedule' for a recurring timer loop (needs scheduleCron); 'event' needs eventType.",
        },
        eventType: { type: "string", description: "Required when triggerKind='event'." },
        scheduleCron: {
          type: "string",
          description: "Cron expression, REQUIRED when triggerKind='schedule' (e.g. '*/5 * * * *').",
        },
        actionKind: {
          type: "string",
          enum: ["notify", "run_agent", "run_workflow", "send_message", "webhook", "gate"],
          description: "Use 'run_agent' for a self-loop (set actionConfigJson with agentId+prompt). Use 'gate' to fail-closed block coding.file.before / coding.shell.before.",
        },
        actionConfigJson: {
          type: "string",
          description:
            "JSON STRING. For run_agent: '{\"agentId\":\"<id>\",\"prompt\":\"<task>\"}'. For run_workflow: '{\"workflowId\":\"<id>\"}'.",
        },
        enabled: { type: "boolean" },
      },
      required: ["name", "triggerKind", "actionKind"],
    },
  },
  {
    name: supersededStaticName("update_hook"),
    description: "Update an automation hook. Requires confirmation.",
    mode: "confirm",
    write: true,
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        enabled: { type: "boolean" },
        eventType: { type: "string" },
        scheduleCron: { type: "string" },
        actionConfigJson: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: supersededStaticName("delete_hook"),
    description: "Delete an automation hook. Requires confirmation.",
    mode: "confirm",
    write: true,
    parameters: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: supersededStaticName("list_hook_runs"),
    description: "List recent runs for a hook.",
    mode: "auto",
    parameters: {
      type: "object",
      properties: {
        hookId: { type: "string" },
        limit: { type: "number" },
      },
      required: ["hookId"],
    },
  },
  {
    name: "emit_event",
    description: "Emit a platform event (may trigger hooks). Requires confirmation.",
    mode: "confirm",
    write: true,
    parameters: {
      type: "object",
      properties: {
        type: { type: "string" },
        payload: { type: "object" },
      },
      required: ["type"],
    },
  },
  {
    name: "list_events",
    description: "List recent platform events visible to the owner.",
    mode: "auto",
    parameters: {
      type: "object",
      properties: { limit: { type: "number" } },
    },
  },
  // --- Financial / holdings ---
  {
    name: "list_holdings",
    description: "List bank/wallet/crypto/PayPal holdings connections.",
    mode: "auto",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "get_net_worth",
    description: "Get total net worth in CAD across all holdings.",
    mode: "auto",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "create_holding",
    description: "Create a manual holdings connection. Requires confirmation.",
    mode: "confirm",
    write: true,
    parameters: {
      type: "object",
      properties: {
        category: { type: "string" },
        provider: { type: "string" },
        label: { type: "string" },
        currency: { type: "string" },
        balance: { type: "number" },
        balanceCad: { type: "number" },
        reference: { type: "string" },
      },
      required: ["category", "provider", "label", "currency", "balance", "balanceCad"],
    },
  },
  {
    name: "refresh_holdings",
    description: "Refresh balance for a crypto wallet or PayPal connection. Requires confirmation.",
    mode: "confirm",
    write: true,
    parameters: {
      type: "object",
      properties: { connectionId: { type: "string" } },
      required: ["connectionId"],
    },
  },
  // --- Marketplace ---
  {
    name: "search_marketplace",
    description: "Search public marketplace listings.",
    mode: "auto",
    parameters: {
      type: "object",
      properties: {
        q: { type: "string" },
        kind: { type: "string" },
      },
    },
  },
  {
    name: "list_my_listings",
    description: "List marketplace listings created by the current user.",
    mode: "auto",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "create_listing",
    description: "Create a marketplace listing. Requires confirmation.",
    mode: "confirm",
    write: true,
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string" },
        resourceId: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        priceCredits: { type: "number" },
        visibility: { type: "string" },
        deliveryMode: { type: "string" },
      },
      required: ["kind", "title", "priceCredits"],
    },
  },
  {
    name: "install_catalog_entry",
    description: "Install a free pack from the Official or Unofficial marketplace catalog. Requires confirmation.",
    mode: "confirm",
    write: true,
    parameters: {
      type: "object",
      properties: {
        entryId: { type: "string" },
        sourceCatalog: { type: "string" },
      },
      required: ["entryId"],
    },
  },
  {
    name: "list_available_plugins",
    description: "List discovered and tenant-installed Bridge plugins.",
    mode: "auto",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "scaffold_plugin",
    description:
      "Create a plugin under plugins/<id> (active coding root / worktree). Returns pluginRoot + codingPath. Then edit (ObjectTypes, Structure seed, wire primary Button handlers) → build_plugin → install_plugin. Do not ship decorative CTAs or empty department-only Structure. Requires confirmation.",
    mode: "confirm",
    write: true,
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        departments: { type: "array", items: { type: "string" } },
      },
      required: ["id", "name"],
    },
  },
  {
    name: "coding_worktree_create",
    description:
      "Create a Bridge-owned git worktree under .worktrees/<slug> inside the tenant coding root and set agent.config.workspace to it so subsequent coding tools edit the worktree. Requires confirmation.",
    mode: "confirm",
    write: true,
    parameters: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Short kebab-case worktree name" },
        name: { type: "string", description: "Alias for slug" },
      },
    },
  },
  {
    name: "coding_worktree_list",
    description: "List Bridge-owned coding worktrees under .worktrees/ for this tenant.",
    mode: "auto",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "coding_worktree_discard",
    description:
      "Remove a Bridge-owned coding worktree and clear agent.config.workspace if it pointed at that path. Does not merge changes into the live tenant tree. Requires confirmation.",
    mode: "confirm",
    write: true,
    parameters: {
      type: "object",
      properties: {
        slug: { type: "string" },
        workspace: {
          type: "string",
          description: "Relative path e.g. .worktrees/my-feature",
        },
      },
    },
  },
  {
    name: "coding_worktree_promote",
    description:
      "Merge a Bridge-owned worktree branch into the live tenant coding root, clear agent.config.workspace, then build/install affected plugins from live plugins/<id> paths (never leave install rooted under .worktrees/). Optional discard removes the worktree after merge. Requires confirmation.",
    mode: "confirm",
    write: true,
    parameters: {
      type: "object",
      properties: {
        slug: { type: "string" },
        workspace: {
          type: "string",
          description: "Relative path e.g. .worktrees/my-feature",
        },
        install: {
          type: "boolean",
          description: "Build and install affected plugins from live paths (default true)",
        },
        discard: {
          type: "boolean",
          description: "Remove the worktree after a successful merge (default false)",
        },
      },
    },
  },
  {
    name: "install_plugin",
    description:
      "Build if needed, load plugin at runtime (no Bridge restart), and enable for the current tenant. Same pipeline as Marketplace Unofficial. Requires confirmation.",
    mode: "confirm",
    write: true,
    parameters: {
      type: "object",
      properties: {
        pluginId: { type: "string" },
        pluginRoot: { type: "string" },
      },
      required: ["pluginId"],
    },
  },
  {
    name: "build_plugin",
    description:
      "Compile plugin with Bridge esbuild (src → dist). Pass pluginRoot or pluginId. Then call install_plugin. Requires confirmation. For npm/native deps use run_ephemeral_build when Layer 4 is enabled.",
    mode: "confirm",
    write: true,
    parameters: {
      type: "object",
      properties: {
        pluginRoot: { type: "string" },
        pluginId: { type: "string" },
      },
    },
  },
  {
    name: "run_ephemeral_build",
    description:
      "Run an allowlisted npm build in an ephemeral host container (Layer 4). Requires CODING_BUILD_MODE=ephemeral and the build supervisor. Prefer build_plugin for GodMode plugins; use this for npm ci / native deps. Requires confirmation.",
    mode: "confirm",
    category: "coding",
    write: true,
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            "One of: npm ci | npm install | npm run build | npm test | npm run typecheck",
        },
        cwd: {
          type: "string",
          description: "Working directory relative to coding root (default .)",
        },
        timeoutMs: { type: "number" },
      },
      required: ["command"],
    },
  },
  {
    name: "prepare_marketplace_submission",
    description: "Generate a catalog manifest JSON for an Official GodMode-Marketplace PR.",
    mode: "auto",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        pluginRepo: { type: "string" },
      },
      required: ["id", "title", "description"],
    },
  },
  // --- LLM / inference ---
  {
    name: "get_llm_status",
    description: "Get local LLM server status (model, ready state).",
    mode: "auto",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "list_models",
    description: "List scanned local GGUF models.",
    mode: "auto",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "scan_models",
    description: "Rescan the models directory for GGUF files.",
    mode: "auto",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "start_llm",
    description: "Start the local LLM server with a model path. Requires confirmation.",
    mode: "confirm",
    write: true,
    parameters: {
      type: "object",
      properties: { modelPath: { type: "string" } },
      required: ["modelPath"],
    },
  },
  {
    name: "stop_llm",
    description: "Stop the local LLM server. Requires confirmation.",
    mode: "confirm",
    write: true,
    parameters: { type: "object", properties: {} },
  },
  {
    name: "restart_llm",
    description: "Restart the local LLM server (optionally with a new model). Requires confirmation.",
    mode: "confirm",
    write: true,
    parameters: {
      type: "object",
      properties: { modelPath: { type: "string" } },
    },
  },
  {
    name: supersededStaticName("list_inference_endpoints"),
    description: "List inference endpoints owned by the current user.",
    mode: "auto",
    parameters: { type: "object", properties: {} },
  },
];

/**
 * Static definitions with names now generated from core ObjectTypes. Keeping
 * both made the legacy switch win over kernel dispatch and exposed divergent
 * schemas. The legacy definitions remain above only as migration reference;
 * callers see the generated CRUD/action definition.
 */
export const STATIC_GENERATED_COLLISION_NAMES = new Set([
  "create_agent",
  "create_hook",
  "create_notification",
  "create_rule",
  "create_schedule",
  "create_share_grant",
  "create_skill",
  "create_support_ticket",
  "create_wiki_page",
  "create_workflow",
  "delete_artifact",
  "delete_hook",
  "delete_structure_node",
  "delete_wiki_page",
  "list_artifacts",
  "list_card_comments",
  "list_hook_runs",
  "list_hooks",
  "list_inference_endpoints",
  "list_notifications",
  "list_schedules",
  "list_share_grants",
  "list_support_tickets",
  "list_wiki_pages",
  "list_workflows",
  "update_hook",
  "update_structure_node",
  "update_wiki_page",
  "update_workflow",
]);

function effectiveStaticTools(): AiToolDef[] {
  return AI_TOOL_REGISTRY.filter(
    (tool) => !STATIC_GENERATED_COLLISION_NAMES.has(tool.name)
  );
}

/** Native coding/terminal tools gated by agent codeAccess. */
export const CODING_TOOL_NAMES = new Set<string>([
  "read_file",
  "list_dir",
  "glob",
  "grep",
  "codebase_search",
  "explore_codebase",
  "explore_coding",
  "read_diagnostics",
  "write_file",
  "edit_file",
  "apply_patch",
  "revert_file",
  "git_status",
  "git_diff",
  "git_branch",
  "git_checkout",
  "git_add",
  "git_commit",
  "git_push",
  "delete_file",
  "run_terminal",
  "terminal_session_create",
  "terminal_session_list",
  "terminal_session_read",
  "terminal_session_write",
  "terminal_session_close",
  "terminal_monitor",
  "scaffold_plugin",
  "coding_worktree_create",
  "coding_worktree_list",
  "coding_worktree_discard",
  "coding_worktree_promote",
  "build_plugin",
  "install_plugin",
  "run_ephemeral_build",
]);

const CODING_WRITE_TOOLS = new Set([
  "write_file",
  "edit_file",
  "apply_patch",
  "delete_file",
  "run_terminal",
  "terminal_session_create",
  "terminal_session_write",
  "terminal_session_close",
  "revert_file",
  "git_branch",
  "git_checkout",
  "git_add",
  "git_commit",
  "git_push",
  "scaffold_plugin",
  "coding_worktree_create",
  "coding_worktree_discard",
  "coding_worktree_promote",
  "build_plugin",
  "install_plugin",
  "run_ephemeral_build",
]);

export function isCodingWriteTool(name: string): boolean {
  return CODING_WRITE_TOOLS.has(name);
}

export function isCodingTool(name: string): boolean {
  return CODING_TOOL_NAMES.has(name);
}

// Domain-specific tools are registered by optional plugins at runtime with
// departments: ["trading"] and arrive via departmentToolNames("trading").
const TASK_TOOLS = new Set<string>([
  "create_project_card",
  "move_project_card",
  "list_project_cards",
  "set_card_priority",
  "create_subtask",
  "list_subtasks",
  "add_card_comment",
  "comment_card",
  "list_card_comments",
  "update_card",
  "watch_pr_checks",
]);

// Platform Builder — Phase A structure tools every department agent may hold
// (scope/role is still enforced at runtime). create_department is platform-wide
// (Intelligence only) but lives in this subset so the model can discover it.
const PLATFORM_STRUCTURE_TOOLS = new Set<string>([
  "list_structure",
  "list_object_types",
  "list_records",
  "get_record",
  "create_record",
  "update_record",
  "delete_record",
  "create_department",
  "create_division",
  "create_page",
  "update_structure_node",
  "delete_structure_node",
  "assign_agent",
  "set_agent_role",
]);

// Auto-mode tools that mutate state without a confirm gate. Labeled distinctly
// in the tools index so mutating autos aren't presented as read-only.
const AUTO_WRITE_TOOLS = new Set<string>([
  "remember",
  "save_artifact",
  "create_project_card",
  "move_project_card",
  "set_card_priority",
  "create_subtask",
  "add_card_comment",
  "comment_card",
  "mark_notification_read",
  "todo_write",
]);

for (const t of AI_TOOL_REGISTRY) {
  if (PLATFORM_STRUCTURE_TOOLS.has(t.name)) {
    t.category = "platform";
  } else if (TASK_TOOLS.has(t.name)) {
    t.category = "tasks";
  } else {
    t.category = "general";
  }
  if (AUTO_WRITE_TOOLS.has(t.name)) t.write = true;
}

/**
 * Phase A Platform Builder structure tools — granted to every department agent
 * (scope/role enforced at runtime). Phase B/C platform tools are trading-only
 * and arrive via departmentToolNames("trading").
 */
export function platformStructureToolNames(): string[] {
  return effectiveStaticTools().filter(
    (t) => t.category === "platform" && !t.departments?.length
  ).map((t) => t.name);
}

/**
 * Names of tools available to every agent (no department scoping). Platform
 * Builder tools are excluded — the engine registry layers them on per
 * department explicitly so non-platform contexts don't receive them implicitly.
 */
export function generalToolNames(): string[] {
  return effectiveStaticTools().filter(
    (t) =>
      !t.departments?.length && t.category !== "platform" && t.category !== "coding"
  ).map((t) => t.name);
}

/** Names of tools scoped to a specific department. */
export function departmentToolNames(departmentId: string): string[] {
  const core = effectiveStaticTools().filter((t) =>
    t.departments?.includes(departmentId)
  ).map((t) => t.name);
  const plugin = pluginToolsAsAiDefs()
    .filter((t) => t.departments?.includes(departmentId))
    .map((t) => t.name);
  return [...core, ...plugin];
}

/** Personal workspaces: tools granted to Digital You by default. */
export const PERSONAL_DIGITAL_YOU_TOOL_NAMES = [
  "remember",
  "list_user_calendar",
  "create_user_calendar_event",
  "list_user_tasks",
  "create_user_task",
  "list_wiki_pages",
  "read_wiki_page",
  "web_search",
  "fetch_url",
] as const;

function allRegisteredTools(): AiToolDef[] {
  const staticTools = effectiveStaticTools();
  const coreNames = new Set(staticTools.map((t) => t.name));
  const autoOt = objectTypeAutoToolDefs(coreNames).map(
    (t): AiToolDef => ({
      name: t.name,
      description: t.description,
      mode: t.mode,
      parameters: t.parameters,
      category: t.category ?? "platform",
      write: t.write,
    })
  );
  const plugin = pluginToolsAsAiDefs().filter((t) => !coreNames.has(t.name));
  return [...staticTools, ...autoOt, ...plugin];
}

/** Default tool allowlist for Intelligence on personal (non-operator) tenants. */
export function personalIntelligenceToolNames(): string[] {
  return allRegisteredTools()
    .filter((t) => !isTradingDepartmentPluginTool(t.name))
    .map((t) => t.name);
}

export function personalDigitalYouToolNames(): string[] {
  return [...PERSONAL_DIGITAL_YOU_TOOL_NAMES];
}

/** True when a tool must not appear on personal workspace default allowlists. */
export function isPersonalExcludedTool(toolName: string): boolean {
  return isTradingDepartmentPluginTool(toolName);
}

function defaultAllowSetForAgent(db: AppDatabase, agentId: string): Set<string> {
  if (agentId.startsWith("user-")) {
    return new Set(personalDigitalYouToolNames());
  }
  return new Set(personalIntelligenceToolNames());
}

/**
 * Resolves the set of tool names an agent may use.
 * - Operator + null toolAllow → null (unrestricted)
 * - Personal + null toolAllow → workspace default allowlist
 * - [] → zero tools
 * - non-empty → explicit allowlist
 */
function allowedToolNames(
  db?: AppDatabase,
  agentId?: string
): Set<string> | null {
  if (!db || !agentId) return null;
  const agent = getAgent(db, agentId);
  if (!agent) return null;
  const allow = agent.toolAllow;
  if (allow === null || allow === undefined) {
    if (isOperatorTenantDb(db)) return null;
    return defaultAllowSetForAgent(db, agentId);
  }
  if (allow.length === 0) return new Set();
  if (allow.includes("*")) {
    return isOperatorTenantDb(db) ? null : defaultAllowSetForAgent(db, agentId);
  }
  return new Set(allow);
}

export function isToolVisibleForAgent(
  db: AppDatabase,
  agentId: string,
  toolName: string
): boolean {
  const allowed = allowedToolNames(db, agentId);
  if (allowed && !allowed.has(toolName)) return false;
  const agent = getAgent(db, agentId);
  if (CODING_TOOL_NAMES.has(toolName) && !agentCodeAccess(agent)) return false;
  return true;
}

function visibleTools(db?: AppDatabase, agentId?: string): AiToolDef[] {
  const allowed = allowedToolNames(db, agentId);
  const agent = db && agentId ? getAgent(db, agentId) : null;
  const codeAccess = agentCodeAccess(agent);
  return allRegisteredTools().filter((t) => {
    if (allowed && !allowed.has(t.name)) return false;
    if (CODING_TOOL_NAMES.has(t.name) && !codeAccess) return false;
    return true;
  });
}

/** Effective tools for an agent after tenant kind, allowlist, and codeAccess. */
export function listVisibleTools(
  db?: AppDatabase,
  agentId?: string
): AiToolDef[] {
  return visibleTools(db, agentId);
}

export function getToolSchemasForLlm(
  db?: AppDatabase,
  agentId?: string,
  chatMode?: IntelligenceChatMode
): Array<{
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  const visible = visibleTools(db, agentId);
  const schemas = visible.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters ?? {
        type: "object",
        properties: {},
        additionalProperties: true,
      },
    },
  }));
  if (!chatMode || chatMode === "agent") return schemas;
  const defsByName = new Map(visible.map((t) => [t.name, t]));
  return filterToolsForChatMode(schemas, chatMode, defsByName);
}

export function getToolsIndexText(db?: AppDatabase, agentId?: string): string {
  const visible = visibleTools(db, agentId);
  const autoRead = visible.filter((t) => t.mode === "auto" && !t.write);
  const autoWrite = visible.filter((t) => t.mode === "auto" && t.write);
  const confirm = visible.filter((t) => t.mode === "confirm");
  const lines = ["--- Available tools ---"];
  if (autoRead.length) {
    lines.push("Auto (read-only): " + autoRead.map((t) => t.name).join(", "));
  }
  if (autoWrite.length) {
    lines.push(
      "Auto (writes data, no confirm): " + autoWrite.map((t) => t.name).join(", ")
    );
  }
  if (confirm.length) {
    lines.push("Confirm required: " + confirm.map((t) => t.name).join(", "));
  }
  lines.push(
    "Confirm-required tools need user approval in the UI before execution. Auto tools that write data take effect immediately."
  );
  return lines.join("\n");
}
