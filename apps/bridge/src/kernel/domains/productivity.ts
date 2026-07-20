import type { BuiltinSpec } from "./shared.js";
import {
  CALENDAR_EVENT_ACTIONS,
  CARD_COMMENT_ACTIONS,
  TASK_CARD_ACTIONS,
} from "../adapters/productivity.js";

export const PRODUCTIVITY_SPECS: BuiltinSpec[] = [
  { name: "Project", label: "Project", module: "productivity", id: "project_read", table: "ai_projects", defaultSort: "updated_at", fields: ["id", "name", "agent_id", "user_id", "created_at", "updated_at"] },
  { name: "ProjectColumn", label: "Project Column", module: "productivity", id: "project_column_read", table: "ai_project_columns", fields: ["id", "project_id", "name", ["sort_order", "Int"]] },
  { name: "TaskCard", label: "Task Card", module: "productivity", id: "task_card_service", table: "ai_project_cards", defaultSort: "updated_at", writable: ["id", "project_id", "title", "description", "prompt", "context_json", "tags_json", "due_at", "linked_chat_id", "linked_workflow_id", "priority", "assigned_agent_id", "column_id", "parent_card_id", "status", "sort_order"], required: ["title"], operations: ["list", "get", "create", "update", "delete"], actions: TASK_CARD_ACTIONS, fields: ["id", "project_id", "column_id", "title", "description", "prompt", ["context_json", "JSON"], ["tags_json", "JSON"], "due_at", "linked_chat_id", "linked_workflow_id", ["priority", "Int"], "parent_card_id", "status", "assigned_agent_id", ["sort_order", "Int"], "created_at", "updated_at"] },
  { name: "CardComment", label: "Card Comment", module: "productivity", id: "card_comment_service", table: "ai_card_comments", defaultSort: "created_at", actions: CARD_COMMENT_ACTIONS, fields: ["id", "card_id", "author", "body", "created_at"] },
  { name: "CalendarEvent", label: "Calendar Event", module: "productivity", id: "calendar_event_service", table: "ai_calendar_events", defaultSort: "start_at", writable: ["id", "kind", "title", "description", "start_at", "end_at", "all_day", "location", "linked_card_id", "linked_run_id", "status"], required: ["title", "start_at"], actions: CALENDAR_EVENT_ACTIONS, fields: ["id", "agent_id", "kind", "title", "description", "start_at", "end_at", ["all_day", "Check"], "location", "linked_card_id", "linked_run_id", "status", "created_at", "updated_at"] },
];
