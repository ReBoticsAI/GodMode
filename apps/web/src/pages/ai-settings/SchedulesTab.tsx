import { useEffect, useMemo, useState } from "react";
import { fetchAiSchedules, type AiSchedule } from "@/api";

export function SchedulesTab({
  workflowIds,
}: {
  /** When set, only show legacy schedules for these workflow ids (agent cockpit). */
  workflowIds?: string[];
}) {
  const [schedules, setSchedules] = useState<AiSchedule[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetchAiSchedules()
      .then((r) => setSchedules(r.schedules))
      .catch(() => setSchedules([]))
      .finally(() => setLoaded(true));
  }, []);

  const visible = useMemo(() => {
    if (!workflowIds) return schedules;
    const ids = new Set(workflowIds);
    return schedules.filter((s) => ids.has(s.workflow_id));
  }, [schedules, workflowIds]);

  if (workflowIds && loaded && visible.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">Cron schedules enqueue workflow jobs.</p>
      {!loaded && <p className="text-xs text-muted-foreground">Loading…</p>}
      {loaded && visible.length === 0 && (
        <p className="text-xs text-muted-foreground">No schedules.</p>
      )}
      {visible.map((s) => (
        <div key={s.id} className="rounded-md border px-2 py-1.5 text-xs">
          <div className="font-medium">{s.cron_expr}</div>
          <div className="text-muted-foreground">workflow {s.workflow_id}</div>
        </div>
      ))}
    </div>
  );
}
