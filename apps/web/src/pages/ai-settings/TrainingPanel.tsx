import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress, ProgressValue } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  buildAiDataset,
  cancelAiTrainingJob,
  createAiDataset,
  createAiTrainingJob,
  fetchAiAdapters,
  fetchAiDatasetChats,
  fetchAiDatasetPreview,
  fetchAiDatasetSources,
  fetchAiDatasets,
  fetchAiTrainingConfig,
  fetchAiTrainingJob,
  fetchAiTrainingJobs,
  updateAiAdapter,
  type AiAdapter,
  type AiChatSummary,
  type AiDataset,
  type AiDatasetExample,
  type AiDatasetSource,
  type AiTrainingJob,
} from "@/api";

function jobAdapterName(job: AiTrainingJob): string {
  try {
    const cfg = JSON.parse(job.config_json) as { adapterName?: string };
    return cfg.adapterName ?? job.adapter_id.slice(0, 8);
  } catch {
    return job.adapter_id.slice(0, 8);
  }
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "done") return "default";
  if (status === "running" || status === "pending") return "secondary";
  if (status === "error") return "destructive";
  return "outline";
}

export function TrainingPanel() {
  const [jobs, setJobs] = useState<AiTrainingJob[]>([]);
  const [datasets, setDatasets] = useState<AiDataset[]>([]);
  const [adapters, setAdapters] = useState<AiAdapter[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [trainConfig, setTrainConfig] = useState<{ trainBaseModel: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [adapterName, setAdapterName] = useState("");
  const [description, setDescription] = useState("");
  const [domain, setDomain] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const [baseModel, setBaseModel] = useState("");
  const [epochs, setEpochs] = useState("3");
  const [learningRate, setLearningRate] = useState("0.0002");
  const [loraRank, setLoraRank] = useState("16");

  const [newDatasetName, setNewDatasetName] = useState("");
  const [newDatasetPath, setNewDatasetPath] = useState("");

  const [sources, setSources] = useState<AiDatasetSource[]>([]);
  const [buildSource, setBuildSource] = useState("");
  const [buildName, setBuildName] = useState("");
  const [buildDomain, setBuildDomain] = useState("");
  const [preview, setPreview] = useState<{ examples: AiDatasetExample[]; total: number } | null>(
    null
  );
  const [previewing, setPreviewing] = useState(false);
  const [building, setBuilding] = useState(false);
  const [sourceChats, setSourceChats] = useState<AiChatSummary[]>([]);
  const [selectedChatIds, setSelectedChatIds] = useState<string[]>([]);

  const selectedJob = useMemo(
    () => jobs.find((j) => j.id === selectedJobId) ?? null,
    [jobs, selectedJobId]
  );

  const runningJob = useMemo(
    () => jobs.find((j) => j.status === "running" || j.status === "pending") ?? null,
    [jobs]
  );

  const loadAll = useCallback(async () => {
    const [jobsRes, datasetsRes, adaptersRes, configRes, sourcesRes] = await Promise.all([
      fetchAiTrainingJobs().catch(() => ({ jobs: [] as AiTrainingJob[] })),
      fetchAiDatasets().catch(() => ({ datasets: [] as AiDataset[] })),
      fetchAiAdapters().catch(() => ({ adapters: [] as AiAdapter[] })),
      fetchAiTrainingConfig().catch(() => null),
      fetchAiDatasetSources().catch(() => ({ sources: [] as AiDatasetSource[] })),
    ]);
    setJobs(jobsRes.jobs);
    setDatasets(datasetsRes.datasets);
    setAdapters(adaptersRes.adapters);
    if (configRes) setTrainConfig(configRes);
    setSources(sourcesRes.sources);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!runningJob) return;
    setSelectedJobId((prev) => prev ?? runningJob.id);
    const poll = setInterval(() => {
      fetchAiTrainingJob(runningJob.id)
        .then((job) => {
          setJobs((prev) => prev.map((j) => (j.id === job.id ? job : j)));
        })
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(poll);
  }, [runningJob?.id, runningJob]);

  useEffect(() => {
    if (!selectedJobId) return;
    if (selectedJob && (selectedJob.status === "running" || selectedJob.status === "pending")) {
      return;
    }
    const poll = setInterval(() => {
      fetchAiTrainingJob(selectedJobId)
        .then((job) => {
          setJobs((prev) => prev.map((j) => (j.id === job.id ? job : j)));
        })
        .catch(() => undefined);
    }, 5000);
    return () => clearInterval(poll);
  }, [selectedJobId, selectedJob?.status]);

  const producedAdapter = useMemo(() => {
    if (!selectedJob || selectedJob.status !== "done") return null;
    return adapters.find((a) => a.id === selectedJob.adapter_id) ?? null;
  }, [selectedJob, adapters]);

  const handleRegisterDataset = async () => {
    if (!newDatasetName.trim() || !newDatasetPath.trim()) {
      setError("Dataset name and path required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ds = await createAiDataset({
        name: newDatasetName.trim(),
        path: newDatasetPath.trim(),
        domain: domain.trim() || undefined,
      });
      setDatasets((prev) => [ds, ...prev]);
      setDatasetId(ds.id);
      setNewDatasetName("");
      setNewDatasetPath("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (buildSource !== "chats") {
      setSourceChats([]);
      setSelectedChatIds([]);
      return;
    }
    fetchAiDatasetChats()
      .then((res) => setSourceChats(res.chats))
      .catch(() => setSourceChats([]));
  }, [buildSource]);

  const handlePreview = async () => {
    if (!buildSource) {
      setError("Select a source");
      return;
    }
    setPreviewing(true);
    setError(null);
    try {
      const res = await fetchAiDatasetPreview(buildSource, 50);
      setPreview(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewing(false);
    }
  };

  const toggleChat = (id: string) => {
    setSelectedChatIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const handleBuildDataset = async () => {
    if (!buildName.trim()) {
      setError("Dataset name required");
      return;
    }
    if (!buildSource) {
      setError("Select a source");
      return;
    }
    setBuilding(true);
    setError(null);
    try {
      const ds = await buildAiDataset({
        name: buildName.trim(),
        domain: buildDomain.trim() || undefined,
        source: buildSource,
        chatIds:
          buildSource === "chats" && selectedChatIds.length ? selectedChatIds : undefined,
      });
      setDatasets((prev) => [ds, ...prev.filter((d) => d.id !== ds.id)]);
      setDatasetId(ds.id);
      setBuildName("");
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBuilding(false);
    }
  };

  const handleStartTraining = async () => {
    if (!adapterName.trim()) {
      setError("Adapter name required");
      return;
    }
    if (!datasetId && !newDatasetPath.trim()) {
      setError("Select or register a dataset");
      return;
    }
    if (runningJob) {
      setError("A training job is already running");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await createAiTrainingJob({
        adapterName: adapterName.trim(),
        description: description.trim() || undefined,
        domain: domain.trim() || undefined,
        datasetId: datasetId || undefined,
        datasetPath: !datasetId ? newDatasetPath.trim() : undefined,
        baseModel: baseModel.trim() || undefined,
        epochs: Number(epochs) || 3,
        learningRate: Number(learningRate) || 0.0002,
        loraRank: Number(loraRank) || 16,
      });
      setJobs((prev) => [res.job, ...prev]);
      setSelectedJobId(res.id);
      void loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!selectedJob || selectedJob.status !== "running") return;
    setBusy(true);
    try {
      await cancelAiTrainingJob(selectedJob.id);
      const job = await fetchAiTrainingJob(selectedJob.id);
      setJobs((prev) => prev.map((j) => (j.id === job.id ? job : j)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleAdapter = async (adapter: AiAdapter, enabled: boolean) => {
    try {
      const updated = await updateAiAdapter(adapter.id, { enabled });
      setAdapters((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        Train LoRA adapters with Unsloth QLoRA. Output is converted to GGUF for llama-server{" "}
        <code>--lora</code>. Enable an adapter below; it loads on the next server restart.
      </p>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
          {error}
        </p>
      )}

      <section className="flex flex-col gap-2 rounded-md border p-2">
        <h4 className="text-xs font-semibold">Build dataset from platform data</h4>
        <p className="text-[11px] text-muted-foreground">
          Generate a JSONL training set from data the platform already collected, then register
          it for training below.
        </p>
        <div className="grid gap-2">
          <div>
            <Label className="text-[11px]">Source</Label>
            <Select value={buildSource} onValueChange={(v) => setBuildSource(v ?? "")}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select a data source" />
              </SelectTrigger>
              <SelectContent>
                {sources.map((s) => (
                  <SelectItem key={s.source} value={s.source}>
                    {s.label} ({s.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {buildSource === "chats" && sourceChats.length > 0 && (
            <div className="flex flex-col gap-1">
              <Label className="text-[11px]">
                Chats{" "}
                <span className="text-muted-foreground">
                  ({selectedChatIds.length === 0 ? "all" : selectedChatIds.length} selected)
                </span>
              </Label>
              <div className="max-h-32 overflow-auto rounded-md border p-1">
                {sourceChats.map((c) => (
                  <label
                    key={c.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      className="h-3 w-3"
                      checked={selectedChatIds.includes(c.id)}
                      onChange={() => toggleChat(c.id)}
                    />
                    <span className="truncate">{c.title || "Untitled"}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {c.message_count} msg
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="w-fit text-xs"
              disabled={previewing || !buildSource}
              onClick={() => void handlePreview()}
            >
              {previewing ? "Loading…" : "Preview"}
            </Button>
            {preview && (
              <span className="text-[11px] text-muted-foreground">
                {preview.total} example{preview.total === 1 ? "" : "s"} available
              </span>
            )}
          </div>

          {preview && (
            <div className="max-h-56 overflow-auto rounded-md border bg-muted/30 p-2 text-[10px] leading-relaxed">
              {preview.examples.length === 0 && (
                <p className="text-muted-foreground">No examples for this source.</p>
              )}
              {preview.examples.map((ex, i) => (
                <div key={i} className="mb-2 border-b border-border/40 pb-1.5 last:border-0">
                  {(ex.messages ?? []).map((m, j) => (
                    <div key={j} className="whitespace-pre-wrap">
                      <span className="font-semibold">{m.role}:</span> {m.content}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[11px]">Dataset name</Label>
              <Input
                className="h-8 text-xs"
                value={buildName}
                onChange={(e) => setBuildName(e.target.value)}
                placeholder="intelligence-chats"
              />
            </div>
            <div>
              <Label className="text-[11px]">Domain (optional)</Label>
              <Input
                className="h-8 text-xs"
                value={buildDomain}
                onChange={(e) => setBuildDomain(e.target.value)}
                placeholder="trading / chat"
              />
            </div>
          </div>
          <Button
            size="sm"
            className="w-fit text-xs"
            disabled={building || !buildSource || !buildName.trim()}
            onClick={() => void handleBuildDataset()}
          >
            {building ? "Building…" : "Build dataset"}
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-2 rounded-md border p-2">
        <h4 className="text-xs font-semibold">New training job</h4>
        <div className="grid gap-2">
          <div>
            <Label className="text-[11px]">Adapter name</Label>
            <Input
              className="h-8 text-xs"
              value={adapterName}
              onChange={(e) => setAdapterName(e.target.value)}
              placeholder="my-playbook-lora"
            />
          </div>
          <div>
            <Label className="text-[11px]">Description</Label>
            <Textarea
              className="min-h-[52px] text-xs"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-[11px]">Domain</Label>
            <Input
              className="h-8 text-xs"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="trading / playbook"
            />
          </div>
          <div>
            <Label className="text-[11px]">Dataset</Label>
            <Select value={datasetId} onValueChange={(v) => setDatasetId(v ?? "")}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select registered dataset" />
              </SelectTrigger>
              <SelectContent>
                {datasets.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name} ({d.row_count} rows)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[11px]">Register dataset name</Label>
              <Input
                className="h-8 text-xs"
                value={newDatasetName}
                onChange={(e) => setNewDatasetName(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-[11px]">JSONL path</Label>
              <Input
                className="h-8 text-xs font-mono"
                value={newDatasetPath}
                onChange={(e) => setNewDatasetPath(e.target.value)}
                placeholder="C:\data\train.jsonl"
              />
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="w-fit text-xs"
            disabled={busy}
            onClick={() => void handleRegisterDataset()}
          >
            Register dataset
          </Button>
          <div>
            <Label className="text-[11px]">Base model (HF id)</Label>
            <Input
              className="h-8 text-xs font-mono"
              value={baseModel}
              onChange={(e) => setBaseModel(e.target.value)}
              placeholder={trainConfig?.trainBaseModel ?? "unsloth/gemma-3-4b-it"}
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-[11px]">Epochs</Label>
              <Input
                className="h-8 text-xs"
                value={epochs}
                onChange={(e) => setEpochs(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-[11px]">Learning rate</Label>
              <Input
                className="h-8 text-xs"
                value={learningRate}
                onChange={(e) => setLearningRate(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-[11px]">LoRA rank</Label>
              <Input
                className="h-8 text-xs"
                value={loraRank}
                onChange={(e) => setLoraRank(e.target.value)}
              />
            </div>
          </div>
          <Button
            size="sm"
            className="w-fit text-xs"
            disabled={busy || !!runningJob}
            onClick={() => void handleStartTraining()}
          >
            {runningJob ? "Training in progress…" : "Start training"}
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold">Jobs</h4>
        {jobs.length === 0 && (
          <p className="text-xs text-muted-foreground">No training jobs yet.</p>
        )}
        {jobs.slice(0, 20).map((job) => (
          <button
            key={job.id}
            type="button"
            className={`rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${
              selectedJobId === job.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"
            }`}
            onClick={() => setSelectedJobId(job.id)}
          >
            <div className="flex items-center gap-2">
              <Badge variant={statusVariant(job.status)} className="text-[10px]">
                {job.status}
              </Badge>
              <span className="font-medium">{jobAdapterName(job)}</span>
              <span className="ml-auto text-[10px] text-muted-foreground">
                {new Date(job.created_at).toLocaleString()}
              </span>
            </div>
            {(job.status === "running" || job.progress > 0) && (
              <div className="mt-1.5">
                <Progress value={Math.round(job.progress * 100)} className="gap-1">
                  <ProgressValue className="text-[10px]" />
                </Progress>
              </div>
            )}
          </button>
        ))}
      </section>

      {selectedJob && (
        <section className="flex flex-col gap-2 rounded-md border p-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold">Job detail</h4>
            {selectedJob.status === "running" && (
              <Button
                size="sm"
                variant="destructive"
                className="h-7 text-xs"
                disabled={busy}
                onClick={() => void handleCancel()}
              >
                Cancel
              </Button>
            )}
          </div>
          {selectedJob.error && (
            <p className="text-xs text-destructive">{selectedJob.error}</p>
          )}
          {producedAdapter && (
            <div className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5 text-xs">
              <span className="font-medium">{producedAdapter.name}</span>
              <span className="truncate font-mono text-[10px] text-muted-foreground">
                {producedAdapter.path}
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground">Enable</span>
                <Switch
                  checked={!!producedAdapter.enabled}
                  onCheckedChange={(v) => void toggleAdapter(producedAdapter, v)}
                />
              </div>
            </div>
          )}
          <pre className="max-h-48 overflow-auto rounded-md bg-muted/30 p-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap">
            {selectedJob.log || "(no logs yet)"}
          </pre>
        </section>
      )}
    </div>
  );
}
