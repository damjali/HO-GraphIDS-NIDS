"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { RunPanel, fmtNum } from "@/components/graphids/run-panel";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRun } from "@/hooks/use-run";
import type { DatasetInfo, ModelInfo, RunMeta } from "@/lib/graphids/types";

type RunRow = Omit<RunMeta, "history" | "config">;

export default function TestingPage() {
  return (
    <Suspense fallback={null}>
      <Testing />
    </Suspense>
  );
}

function modelLabel(m: ModelInfo) {
  const f1 = m.metrics?.f1 !== undefined ? ` · F1 ${m.metrics.f1.toFixed(3)}` : "";
  const kind = m.modelType === "HO-GraphIDS" ? `HO-GraphIDS ${m.numHops} hops (${m.hopMode})` : "GraphIDS";
  return `${kind} · ${m.dataset.label}${f1} · ${new Date(m.createdAt).toLocaleString()}`;
}

function Testing() {
  const params = useSearchParams();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [uploads, setUploads] = useState<DatasetInfo[]>([]);
  const [history, setHistory] = useState<RunRow[]>([]);
  const [modelId, setModelId] = useState<string | null>(params.get("model"));
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [tab, setTab] = useState("builtin");
  const [runId, setRunId] = useState<string | null>(params.get("run"));
  const [reload, setReload] = useState(0);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const { run } = useRun(runId, reload);

  const loadLists = () =>
    Promise.all([
      fetch("/api/models").then((r) => r.json()),
      fetch("/api/uploads").then((r) => r.json()),
      fetch("/api/runs").then((r) => r.json()),
    ]).then(([m, u, r]) => {
      const list: ModelInfo[] = m.models;
      setModels(list);
      setModelId((cur) => cur ?? list[0]?.id ?? null);
      setUploads(u.uploads);
      setHistory((r.runs as RunRow[]).filter((x) => x.mode === "test"));
      const active = (r.runs as RunRow[]).find((x) => x.status === "running" && x.mode === "test");
      if (active) setRunId((cur) => cur ?? active.id);
      setLoaded(true);
    });

  useEffect(() => {
    loadLists();
  }, []);

  // Refresh the history list whenever a run finishes.
  const runStatus = run?.status;
  useEffect(() => {
    if (runStatus && runStatus !== "running") loadLists();
  }, [runStatus]);

  const model = models.find((m) => m.id === modelId);
  const running = run?.status === "running";

  async function start() {
    if (!model) return;
    setStarting(true);
    setError(null);
    try {
      const r = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "test",
          modelRunId: model.id,
          target: tab === "upload" ? "upload" : "builtin",
          uploadName: tab === "upload" ? uploadId : undefined,
        }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? "Could not start the test");
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

  const canStart =
    !!model && !running && !starting && (tab === "builtin" || (!!uploadId && model.canScoreUploads));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Test a model</h1>
        <p className="text-sm text-muted-foreground">
          Re-use a model you trained before. Test it on its own held-out split, or score a CSV
          you uploaded.
        </p>
      </div>

      {loaded && models.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No trained models yet</CardTitle>
            <CardDescription>Train a model first, then come back to test it.</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button nativeButton={false} render={<Link href="/training" />}>
              Go to training
            </Button>
          </CardFooter>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>1. Model</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Select
              value={modelId ?? undefined}
              onValueChange={(v) => v != null && setModelId(v)}
              disabled={running}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a trained model" />
              </SelectTrigger>
              <SelectContent>
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {modelLabel(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {model && (
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">{model.dataset.label}</Badge>
                <Badge variant="outline">num_hops {model.numHops}</Badge>
                {model.numHops > 1 && <Badge variant="outline">hop_mode {model.hopMode}</Badge>}
                <Badge variant="outline">seed {model.seed}</Badge>
                {model.metrics?.prAuc !== undefined && (
                  <Badge variant="outline">PR-AUC {fmtNum(model.metrics.prAuc, 3)}</Badge>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {models.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>2. What to test on</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs value={tab} onValueChange={setTab} className="gap-4">
              <TabsList>
                <TabsTrigger value="builtin">Its own test split</TabsTrigger>
                <TabsTrigger value="upload">Uploaded CSV</TabsTrigger>
              </TabsList>
              <TabsContent value="builtin">
                <p className="text-sm text-muted-foreground">
                  Evaluates the model on the 10% of {model?.dataset.label ?? "the dataset"} that
                  was held out when it was trained. It uses the same seed, so the split is the
                  same one. Gives macro F1 and PR-AUC.
                </p>
              </TabsContent>
              <TabsContent value="upload" className="flex flex-col gap-3">
                {uploads.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nothing uploaded yet.{" "}
                    <Link href="/upload" className="underline">
                      Upload a CSV
                    </Link>
                    .
                  </p>
                ) : (
                  <Select
                    value={uploadId ?? undefined}
                    onValueChange={(v) => v != null && setUploadId(v)}
                    disabled={running}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose an uploaded file" />
                    </SelectTrigger>
                    <SelectContent>
                      {uploads.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.label} · {u.version} · {u.labeled ? "labeled" : "unlabeled"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <p className="text-xs text-muted-foreground">
                  The file must contain every feature column the model was trained on. Every flow
                  gets an anomaly score and is flagged if it is above the model&apos;s threshold.
                  If the file has a Label column you also get F1 and PR-AUC.
                </p>
                {model && !model.canScoreUploads && (
                  <p className="text-sm text-destructive">
                    This model has no saved scaler, so it cannot score new data. Retrain it.
                  </p>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
          <CardFooter className="flex flex-wrap items-center gap-2">
            <Button onClick={start} disabled={!canStart}>
              {starting ? "Starting…" : running ? "Test in progress" : "Run test"}
            </Button>
            {error && <span className="text-sm text-destructive">{error}</span>}
          </CardFooter>
        </Card>
      )}

      {run && <RunPanel run={run} onCancel={cancel} />}

      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Previous tests</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Tested on</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">F1</TableHead>
                  <TableHead className="text-right">PR-AUC</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.slice(0, 10).map((h) => (
                  <TableRow key={h.id}>
                    <TableCell>{new Date(h.createdAt).toLocaleString()}</TableCell>
                    <TableCell>
                      {h.modelType === "HO-GraphIDS" ? `HO-GraphIDS ${h.numHops} hops (${h.hopMode})` : "GraphIDS"} ·{" "}
                      {h.dataset.label}
                    </TableCell>
                    <TableCell>{h.target === "upload" ? h.uploadName : "Own test split"}</TableCell>
                    <TableCell>{h.status}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(h.metrics?.f1)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtNum(h.metrics?.prAuc)}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setRunId(h.id)}>
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
