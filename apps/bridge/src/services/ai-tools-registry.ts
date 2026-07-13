import type { AppDatabase } from "../db.js";
import { agentCodeAccess, getAgent } from "./agents/agents-db.js";
import { isOperatorTenantDb } from "./tenant-kind.js";
import { PAGE_KINDS } from "./page-kinds.js";
import { pluginToolsAsAiDefs, isTradingDepartmentPluginTool } from "../plugins/plugin-tools.js";
import {
  filterToolsForChatMode,
  type IntelligenceChatMode,
} from "./chat-mode.js";

/** JSON-schema enum for structure node `kind` (mirrors web page-registry). */
const KIND_SCHEMA = { type: "string", enum: [...PAGE_KINDS] } as const;

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
      "Load the full step-by-step instructions for a named skill. Pass the skill id in `skillId` (e.g. 'optimize-playbook' to backtest+tune a playbook, 'platform-self-loop' to set up a recurring self-monitoring loop). Call this BEFORE starting a workflow the skill covers.",
    mode: "auto",
    parameters: {
      type: "object",
      properties: {
        skillId: {
          type: "string",
          description:
            "Skill id from the 'Available skills' list (e.g. optimize-playbook, platform-self-loop).",
        },
      },
      required: ["skillId"],
    },
  },
  {
    name: "web_search",
    description:
      "Search the web via DuckDuckGo and return a list of result titles, URLs, and snippets. Use for live/current information not in your training data.",
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
      "Fetch a web page (or any URL) and return its readable text content. Use after web_search to read a specific result, or when given a URL directly.",
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
    name: "list_artifacts",
    description: "List this agent's saved artifacts (id, name, size, description).",
    mode: "auto",
    parameters: {
      type: "object",
      properties: { limit: { type: "number" } },
    },
  },
  {
    name: "delete_artifact",
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
      "Create a card on the Projects Kanban board. Set priority (1=high,2=med,3=low) and tags (e.g. [\"auto\"] to make it an autonomous Task the runner will execute). prompt holds the detailed goal for the runner.",
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
      "Create a subtask under a parent card. Inherits the parent's project and priority; defaults to the In Progress column.",
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
    name: "list_card_comments",
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
      "Add a to-do item to the human USER's personal task board. This is NOT a notification/alert/message — when asked to 'create a notification', 'notify', or 'send a message', use create_notification instead. For your OWN work plan use todo_write / create_subtask.",
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
      "Invoke another named subagent with a prompt and return its answer. Use for specialized tasks (planning, review, coding). Requires user confirmation.",
    mode: "confirm",
    parameters: {
      type: "object",
      properties: {
        agent: { type: "string", description: "Subagent id or name" },
        prompt: { type: "string" },
        context: { type: "string", description: "Optional extra context for the subagent" },
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
      "Create or update your task list. Each item is persisted as a card on your Kanban board (pending→Backlog, in_progress→In Progress, completed/cancelled→Done) and also renders as a live in-chat checklist. Use for multi-step work: pass the FULL list each time with updated statuses; re-running updates the same cards (keyed by item id) instead of duplicating. Keep exactly one item 'in_progress'. Parent items with nested subtasks are auto-tagged for the autonomous executor (resume after backtests). Optional maxTaskTicks (default 200) on the parent or at the top level for long optimization runs.",
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
    name: "create_skill",
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
    name: "create_rule",
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
  {
    name: "create_department",
    description:
      "Create a new top-level department. Platform-wide action — Intelligence only. Requires confirmation.",
    mode: "confirm",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "lowercase slug (a-z 0-9 -)" },
        label: { type: "string" },
        icon: { type: "string", description: "lucide icon slug" },
        kind: { ...KIND_SCHEMA, description: "Page renderer kind (default placeholder)" },
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
        kind: { ...KIND_SCHEMA, description: "Page renderer kind (e.g. sierra-dashboard-group)" },
        segment: { type: "string", description: "URL segment (defaults to id)" },
      },
      required: ["departmentId", "id", "label", "icon"],
    },
  },
  {
    name: "create_page",
    description:
      "Create a page under a division (starts as a placeholder renderer). Requires editor on the division. Requires confirmation.",
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
        kind: { ...KIND_SCHEMA, description: "Page renderer kind (e.g. sierra-playbooks-group)" },
      },
      required: ["departmentId", "divisionId", "id", "label", "icon"],
    },
  },
  {
    name: "update_structure_node",
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
        kind: KIND_SCHEMA,
      },
      required: ["nodeType", "departmentId"],
    },
  },
  {
    name: "delete_structure_node",
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
    name: "create_agent",
    description:
      "Create a new subagent (page-owner or specialist). Intelligence-only platform action. Requires confirmation.",
    mode: "confirm",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Optional deterministic id (e.g. sierra-chart)" },
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
    name: "list_share_grants",
    description:
      "List share grants owned by or granted to the current user (includes shared sidebar tree).",
    mode: "auto",
  },
  {
    name: "create_share_grant",
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
    name: "list_workflows",
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
    name: "create_workflow",
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
    name: "update_workflow",
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
    name: "list_schedules",
    description: "List cron schedules for automation workflows.",
    mode: "auto",
  },
  {
    name: "create_schedule",
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
      "Run a shell command in the platform repository (cwd relative to repo root). Requires confirmation unless agent has codeAutonomy.",
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
    name: "codebase_search",
    description:
      "Semantic codebase search: ripgrep + path ranking. Prefer this over raw grep for exploratory questions.",
    mode: "auto",
    category: "coding",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
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
  // --- Notifications ---
  {
    name: "list_notifications",
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
    name: "create_notification",
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
    name: "create_support_ticket",
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
    name: "list_support_tickets",
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
    name: "list_wiki_pages",
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
    name: "create_wiki_page",
    description: "Create a wiki page. Requires confirmation.",
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
    name: "update_wiki_page",
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
    name: "delete_wiki_page",
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
    name: "list_hooks",
    description: "List automation hooks owned by the user or their agents.",
    mode: "auto",
    parameters: { type: "object", properties: {} },
  },
    {
    name: "create_hook",
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
          enum: ["notify", "run_agent", "run_workflow", "send_message", "webhook"],
          description: "Use 'run_agent' for a self-loop (set actionConfigJson with agentId+prompt).",
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
    name: "update_hook",
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
    name: "delete_hook",
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
    name: "list_hook_runs",
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
      "Create a plugin under plugins/<id> (coding root). Returns pluginRoot + codingPath. Then edit → build_plugin → install_plugin. Requires confirmation.",
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
      "Compile plugin with Bridge esbuild (src → dist). Pass pluginRoot or pluginId. Then call install_plugin. Requires confirmation.",
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
    name: "list_inference_endpoints",
    description: "List inference endpoints owned by the current user.",
    mode: "auto",
    parameters: { type: "object", properties: {} },
  },
];

/** Native coding/terminal tools gated by agent codeAccess. */
export const CODING_TOOL_NAMES = new Set<string>([
  "read_file",
  "list_dir",
  "glob",
  "grep",
  "codebase_search",
  "explore_codebase",
  "read_diagnostics",
  "write_file",
  "edit_file",
  "apply_patch",
  "revert_file",
  "delete_file",
  "run_terminal",
]);

const CODING_WRITE_TOOLS = new Set([
  "write_file",
  "edit_file",
  "apply_patch",
  "delete_file",
  "run_terminal",
  "revert_file",
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
]);

// Platform Builder — Phase A structure tools every department agent may hold
// (scope/role is still enforced at runtime). create_department is platform-wide
// (Intelligence only) but lives in this subset so the model can discover it.
const PLATFORM_STRUCTURE_TOOLS = new Set<string>([
  "list_structure",
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
  return AI_TOOL_REGISTRY.filter(
    (t) => t.category === "platform" && !t.departments?.length
  ).map((t) => t.name);
}

/**
 * Names of tools available to every agent (no department scoping). Platform
 * Builder tools are excluded — the engine registry layers them on per
 * department explicitly so non-platform contexts don't receive them implicitly.
 */
export function generalToolNames(): string[] {
  return AI_TOOL_REGISTRY.filter(
    (t) =>
      !t.departments?.length && t.category !== "platform" && t.category !== "coding"
  ).map((t) => t.name);
}

/** Names of tools scoped to a specific department. */
export function departmentToolNames(departmentId: string): string[] {
  const core = AI_TOOL_REGISTRY.filter((t) =>
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
  return [...AI_TOOL_REGISTRY, ...pluginToolsAsAiDefs()];
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
