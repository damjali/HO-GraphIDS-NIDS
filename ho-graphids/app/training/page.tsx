"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { RunPanel } from "@/components/graphids/run-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRun } from "@/hooks/use-run";
import type { DatasetInfo } from "@/lib/graphids/types";

type Form = Record<string, string>;

const BASIC: { key: string; label: string; hint?: string }[] = [
  { key: "num_epochs", label: "Epochs", hint: "Training stops early if validation PR-AUC stops improving." },
  { key: "learning_rate", label: "Learning rate" },
  { key: "batch_size", label: "Batch size (edges)", hint: "Lower this if the machine runs out of memory." },
  { key: "patience", label: "Early-stopping patience" },
  { key: "fraction", label: "Fraction of rows", hint: "Empty = use every row. Sampling happens after the CSV is read." },
];

const ADVANCED: { key: string; label: string }[] = [
  { key: "num_layers", label: "Transformer layers (num_layers)" },
  { key: "edim_out", label: "Edge embedding size" },
  { key: "ae_embedding_dim", label: "Transformer embedding size" },
  { key: "dropout", label: "GNN dropout" },
  { key: "ae_dropout", label: "Transformer dropout" },
  { key: "weight_decay", label: "GNN weight decay" },
  { key: "ae_weight_decay", label: "Transformer weight decay" },
  { key: "mask_ratio", label: "Attention mask ratio" },
  { key: "window_size", label: "Window size" },
  { key: "ae_batch_size", label: "Transformer batch size" },
  { key: "fanout", label: "Neighbour fanout" },
  { key: "step_percent", label: "Window step" },
];

export default function TrainingPage() {
  return (
    <Suspense fallback={null}>
      <Training />
    </Suspense>
  );
}

function Training() {
  const params = useSearchParams();
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [datasetId, setDatasetId] = useState<string | null>(params.get("dataset"));
  const [form, setForm] = useState<Form>({});
  const [seed, setSeed] = useState("24");
  const [ho, setHo] = useState(false);
  const [hops, setHops] = useState("2");
  const [hopMode, setHopMode] = useState("edge");
  const [advanced, setAdvanced] = useState(false);
  const [runId, setRunId] = useState<string | null>(params.get("run"));
  const [reload, setReload] = useState(0);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { run } = useRun(runId, reload);

  // Datasets, and pick up a run that is already going (e.g. after a page reload).
  useEffect(() => {
    fetch("/api/datasets")
      .then((r) => r.json())
      .then((b) => {
        const list: DatasetInfo[] = b.datasets;
        setDatasets(list);
        setDatasetId((cur) => cur ?? list.find((d) => d.enabled)?.id ?? null);
      });
    fetch("/api/runs")
      .then((r) => r.json())
      .then((b) => {
        const active = (b.runs as { id: string; status: string; mode: string }[]).find(
          (r) => r.status === "running" && r.mode === "train"
        );
        if (active) setRunId((cur) => cur ?? active.id);
      });
  }, []);

  // Start the form from the tuned hyperparameters of the chosen dataset.
  useEffect(() => {
    if (!datasetId) return;
    let cancelled = false;
    fetch(`/api/configs/${datasetId}`)
      .then((r) => r.json())
      .then((b) => {
        if (cancelled || !b.config) return;
        const f: Form = {};
        for (const [k, v] of Object.entries(b.config as Record<string, unknown>))
          f[k] = v === null ? "" : String(v);
        setForm(f);
        const nh = Number(f.num_hops);
        setHo(nh > 1);
        setHops(nh > 1 ? String(nh) : "2");
        setHopMode(f.hop_mode === "node" ? "node" : "edge");
      });
    return () => {
      cancelled = true;
    };
  }, [datasetId]);

  const dataset = datasets.find((d) => d.id === datasetId);
  const running = run?.status === "running";
  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function start() {
    if (!dataset) return;
    setStarting(true);
    setError(null);
    const overrides: Record<string, unknown> = {};
    for (const { key } of [...BASIC, ...ADVANCED]) {
      if (key === "fraction") overrides[key] = form[key] === "" ? null : Number(form[key]);
      else if (form[key] !== undefined && form[key] !== "") overrides[key] = Number(form[key]);
    }
    overrides.positional_encoding = form.positional_encoding ?? "None";
    try {
      const r = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "train",
          dataset: dataset.id,
          numHops: ho ? Number(hops) : 1,
          hopMode,
          seed: Number(seed),
          overrides,
        }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? "Could not start training");
      setRunId(b.run.id);
      setReload((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }

  async function cancel() {
    if (!runId) return;
    await fetch(`/api/runs/${runId}?action=cancel`, { method: "DELETE" });
    setReload((n) => n + 1);
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Train a model</h1>
        <p className="text-sm text-muted-foreground">
          Runs the GraphIDS Python code on this machine. Training uses the CPU, so a full
          100-epoch run can take a long time. Use Quick run to check that everything works.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>1. Dataset</CardTitle>
          <CardDescription>Training uses benign flows only (self-supervised).</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {datasets.map((d) => (
            <button
              key={d.id}
              type="button"
              disabled={!d.enabled || running}
              onClick={() => setDatasetId(d.id)}
              className={`flex flex-col gap-1 rounded-lg border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                d.id === datasetId ? "border-primary ring-2 ring-primary/30" : "hover:bg-muted"
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                {d.label}
                {d.source === "upload" && <Badge variant="outline">Uploaded</Badge>}
              </span>
              <span className="text-xs text-muted-foreground">
                {d.sizeBytes ? `${(d.sizeBytes / 1e6).toFixed(0)} MB · ` : ""}
                {d.version} columns
              </span>
              {!d.enabled && d.reason && (
                <span className="text-xs text-muted-foreground">{d.reason}</span>
              )}
            </button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Model</CardTitle>
          <CardDescription>
            HO-GraphIDS stacks more than one hop in the SAGELayer graph encoder
            (<code>num_hops</code>). The Transformer autoencoder is unchanged.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { v: false, name: "GraphIDS", sub: "num_hops = 1" },
              { v: true, name: "HO-GraphIDS", sub: "num_hops > 1" },
            ].map((o) => (
              <button
                key={o.name}
                type="button"
                disabled={running}
                onClick={() => setHo(o.v)}
                className={`flex flex-col gap-1 rounded-lg border p-3 text-left transition disabled:opacity-50 ${
                  ho === o.v ? "border-primary ring-2 ring-primary/30" : "hover:bg-muted"
                }`}
              >
                <span className="text-sm font-medium">{o.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{o.sub}</span>
              </button>
            ))}
          </div>
          {ho && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="hops">Hops (num_hops)</Label>
                <Input
                  id="hops"
                  type="number"
                  min={2}
                  max={6}
                  value={hops}
                  disabled={running}
                  onChange={(e) => setHops(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Each extra hop widens the neighbourhood and the sampled subgraph, so memory
                  and time grow quickly. Try 2 first.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Hop type (hop_mode)</Label>
                <Select
                  value={hopMode}
                  onValueChange={(v) => v != null && setHopMode(v)}
                  disabled={running}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="edge">Edge features (E-GraphSAGE)</SelectItem>
                    <SelectItem value="node">Neighbour embeddings (GraphSAGE)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {hopMode === "edge"
                    ? "Every hop re-aggregates the incoming edge features and carries the node embedding forward."
                    : "Later hops average the neighbours' node embeddings from the previous hop. Edge features enter only at hop 1."}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3. Settings</CardTitle>
          <CardDescription>
            Prefilled from the tuned config for this dataset in the GraphIDS repository.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {BASIC.map((f) => (
              <div key={f.key} className="flex flex-col gap-1.5">
                <Label htmlFor={f.key}>{f.label}</Label>
                <Input
                  id={f.key}
                  inputMode="decimal"
                  value={form[f.key] ?? ""}
                  disabled={running}
                  onChange={set(f.key)}
                />
                {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
              </div>
            ))}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="seed">Seed</Label>
              <Input
                id="seed"
                inputMode="numeric"
                value={seed}
                disabled={running}
                onChange={(e) => setSeed(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Fixes the train/validation/test split. The cached graph was built with seed 24.
              </p>
            </div>
          </div>

          <button
            type="button"
            className="w-fit text-sm text-muted-foreground underline"
            onClick={() => setAdvanced((a) => !a)}
          >
            {advanced ? "Hide" : "Show"} advanced settings
          </button>
          {advanced && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {ADVANCED.map((f) => (
                <div key={f.key} className="flex flex-col gap-1.5">
                  <Label htmlFor={f.key}>{f.label}</Label>
                  <Input
                    id={f.key}
                    inputMode="decimal"
                    value={form[f.key] ?? ""}
                    disabled={running}
                    onChange={set(f.key)}
                  />
                </div>
              ))}
              <div className="flex flex-col gap-1.5">
                <Label>Positional encoding</Label>
                <Select
                  value={form.positional_encoding ?? "None"}
                  onValueChange={(v) => v != null && setForm((f) => ({ ...f, positional_encoding: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="None">None</SelectItem>
                    <SelectItem value="learnable">Learnable</SelectItem>
                    <SelectItem value="sinusoidal">Sinusoidal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex flex-wrap items-center gap-2">
          <Button onClick={start} disabled={!dataset || running || starting}>
            {starting ? "Starting…" : running ? "Training in progress" : "Start training"}
          </Button>
          <Button
            variant="outline"
            disabled={running}
            onClick={() => setForm((f) => ({ ...f, num_epochs: "2", patience: "2" }))}
          >
            Quick run (2 epochs)
          </Button>
          {error && <span className="text-sm text-destructive">{error}</span>}
        </CardFooter>
      </Card>

      {run && (
        <>
          <RunPanel run={run} onCancel={cancel} />
          {run.status === "completed" && run.hasCheckpoint && (
            <div>
              <Button render={<Link href={`/testing?model=${run.id}`} />} nativeButton={false}>
                Test this model
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
