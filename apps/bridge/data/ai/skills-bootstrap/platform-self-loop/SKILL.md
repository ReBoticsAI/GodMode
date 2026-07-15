---
name: platform-self-loop
description: Set up Kanban-backed autonomous work with a schedule hook or workflow loop until stop conditions
tools: ["list_object_types", "run_record_action", "todo_write", "list_project_cards", "create_hook", "create_schedule", "run_workflow", "list_hooks", "update_hook", "run_agent"]
---
1. Plan with todo_write — breakdown: board setup → hook/schedule → verify loop → stop condition.
2. Discover `Workflow`, `Schedule`, `Hook`, and `OperationRun` actions first;
   use declared actions for durable work. Specialized operational tools remain
   conveniences, not alternate durable-write paths.
3. Ensure cards exist on the Kanban (todo_write or create_project_card).
4. Prefer run_workflow with workflowId autonomous-task-runner for the canonical loop, OR create_hook with triggerKind schedule and actionKind run_agent.
5. create_schedule on autonomous-task-runner at */30 * * * * if cron-based workflow execution is desired.
6. Each loop iteration: list_project_cards (backlog, limit 1), work the card, move to done.
7. STOP when the board is clear: update_hook enabled false or disable the schedule.
8. Verify in Automations tab (hooks/schedules) and list_hook_runs.
