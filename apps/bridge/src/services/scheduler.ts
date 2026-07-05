import cron, { type ScheduledTask } from "node-cron";
import type { CoreHook } from "../core-db.js";
import { listEnabledScheduleHooks } from "./hook-service.js";
import { executeHook } from "./hook-dispatcher.js";

const tasks = new Map<string, ScheduledTask>();
let started = false;

function registerHook(hook: CoreHook): void {
  if (!hook.schedule_cron || !cron.validate(hook.schedule_cron)) {
    console.warn(`[scheduler] invalid cron for hook ${hook.id}: ${hook.schedule_cron}`);
    return;
  }
  const task = cron.schedule(hook.schedule_cron, () => {
    // Re-read the hook each tick so toggles/edits take effect without restart.
    void executeHook(hook, null).catch((err) =>
      console.error(`[scheduler] hook ${hook.id} tick failed`, err)
    );
  });
  tasks.set(hook.id, task);
}

function clearAll(): void {
  for (const task of tasks.values()) {
    task.stop();
  }
  tasks.clear();
}

/** Load all enabled schedule hooks and register cron jobs. Idempotent. */
export function startScheduler(): void {
  started = true;
  clearAll();
  for (const hook of listEnabledScheduleHooks()) {
    registerHook(hook);
  }
  console.log(`[scheduler] registered ${tasks.size} schedule hook(s)`);
}

/** Re-register all schedule hooks after a create/update/delete. */
export function refreshScheduler(): void {
  if (!started) return;
  startScheduler();
}

export function stopScheduler(): void {
  clearAll();
  started = false;
}
