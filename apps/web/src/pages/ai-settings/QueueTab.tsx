import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { fetchAiQueue, type AiQueueJob } from "@/api";

export function QueueTab() {
  const [jobs, setJobs] = useState<AiQueueJob[]>([]);

  useEffect(() => {
    fetchAiQueue()
      .then((r) => setJobs(r.jobs))
      .catch(() => setJobs([]));
    const t = setInterval(() => {
      fetchAiQueue()
        .then((r) => setJobs(r.jobs))
        .catch(() => undefined);
    }, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">Single-GPU prompt queue (sequential).</p>
      {jobs.length === 0 && <p className="text-xs text-muted-foreground">Queue empty.</p>}
      {jobs.slice(0, 12).map((j) => (
        <div key={j.id} className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
          <Badge variant="outline" className="text-[10px]">{j.status}</Badge>
          <span className="truncate">{j.prompt ?? j.workflow_id ?? j.id}</span>
        </div>
      ))}
    </div>
  );
}
