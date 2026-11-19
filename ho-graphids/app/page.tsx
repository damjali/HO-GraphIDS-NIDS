"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  Brain,
  Cpu,
  Database,
  FlaskConical,
  Network,
  Upload,
} from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DatasetInfo, ModelInfo, RunDetail, RunMeta } from "@/lib/graphids/types";

type RunRow = Omit<RunMeta, "history" | "config">;

const chartConfig = {
  trainLoss: { label: "Train loss", color: "var(--chart-1)" },
  valLoss: { label: "Validation loss", color: "var(--chart-2)" },
} satisfies ChartConfig;

const pct = (v: number | undefined) => (v === undefined ? 0 : v * 100);
const kind = (r: { modelType: string; numHops: number; hopMode: string }) =>
  r.modelType === "HO-GraphIDS" ? `HO-GraphIDS ${r.numHops} hops (${r.hopMode})` : "GraphIDS";

export default function Home() {
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [latest, setLatest] = useState<RunDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [d, m, r] = await Promise.all([
        fetch("/api/datasets").then((x) => x.json()),
        fetch("/api/models").then((x) => x.json()),
        fetch("/api/runs").then((x) => x.json()),
      ]);
      if (cancelled) return;
      setDatasets(d.datasets);
      setModels(m.models);
      setRuns(r.runs);
      const last = (m.models as ModelInfo[])[0];
      if (last) {
        const detail = await fetch(`/api/runs/${last.id}`).then((x) => x.json());
        if (!cancelled) setLatest(detail.run);
      }
    };
    load().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const running = runs.find((r) => r.status === "running");
  const lastModel = models[0];
  const m = lastModel?.metrics;

  return (
    <div className="min-h-screen w-full bg-zinc-50 font-sans dark:bg-black">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 md:p-6">
        {/* Page header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
            <p className="text-sm text-muted-foreground">
              HO-GraphIDS: graph-based network intrusion detection on NetFlow data
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/upload" />}>
              <Upload /> Upload data
            </Button>
            <Button size="sm" nativeButton={false} render={<Link href="/training" />}>
              <Brain /> Train model
            </Button>
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader>
              <CardDescription>Datasets</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{datasets.length}</CardTitle>
              <CardAction>
                <Database className="size-4 text-muted-foreground" />
              </CardAction>
            </CardHeader>
            <CardFooter className="text-xs text-muted-foreground">
              {datasets.filter((d) => d.source === "upload").length} uploaded ·{" "}
              {datasets.filter((d) => d.enabled).length} ready for training
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardDescription>Trained models</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{models.length}</CardTitle>
              <CardAction>
                <Cpu className="size-4 text-muted-foreground" />
              </CardAction>
            </CardHeader>
            <CardFooter className="text-xs text-muted-foreground">
              {models.filter((x) => x.modelType === "HO-GraphIDS").length} HO-GraphIDS ·{" "}
              {models.filter((x) => x.modelType === "GraphIDS").length} GraphIDS
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardDescription>Latest model, macro F1</CardDescription>
              <CardTitle className="text-2xl tabular-nums">
                {m?.f1 !== undefined ? m.f1.toFixed(3) : "–"}
              </CardTitle>
              <CardAction>
                <FlaskConical className="size-4 text-muted-foreground" />
              </CardAction>
            </CardHeader>
            <CardFooter className="text-xs text-muted-foreground">
              {lastModel ? `${kind(lastModel)} on ${lastModel.dataset.label}` : "No trained model yet"}
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardDescription>Current job</CardDescription>
              <CardTitle className="text-2xl">{running ? "Running" : "Idle"}</CardTitle>
              <CardAction>
                <Badge variant={running ? "default" : "secondary"}>
                  <Activity className="size-3" />
                  {running ? running.mode : "none"}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardFooter className="text-xs text-muted-foreground">
              {running ? `${running.phase} · ${running.dataset.label}` : `${runs.length} runs so far`}
            </CardFooter>
          </Card>
        </div>

        {/* Chart + model metrics */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Latest training</CardTitle>
              <CardDescription>
                {latest
                  ? `Loss per epoch · ${kind(latest)} on ${latest.dataset.label}`
                  : "Train a model to see its loss curve here."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {latest && latest.history.length > 0 ? (
                <ChartContainer config={chartConfig} className="h-[260px] w-full">
                  <LineChart data={latest.history} margin={{ left: 12, right: 12 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="epoch" tickLine={false} axisLine={false} tickMargin={8} />
                    <YAxis tickLine={false} axisLine={false} width={48} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line dataKey="trainLoss" stroke="var(--color-trainLoss)" dot={false} />
                    <Line dataKey="valLoss" stroke="var(--color-valLoss)" dot={false} />
                  </LineChart>
                </ChartContainer>
              ) : (
                <p className="py-16 text-center text-sm text-muted-foreground">
                  No training history yet.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Latest model</CardTitle>
              <CardDescription>
                {lastModel ? `${kind(lastModel)} · held-out test split` : "Nothing trained yet"}
              </CardDescription>
              <CardAction>
                <Network className="size-4 text-muted-foreground" />
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {[
                { label: "Macro F1", value: pct(m?.f1) },
                { label: "PR-AUC", value: pct(m?.prAuc) },
              ].map((x) => (
                <div key={x.label} className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-sm">
                    <span>{x.label}</span>
                    <span className="font-medium tabular-nums">{x.value.toFixed(1)}%</span>
                  </div>
                  <Progress value={x.value} />
                </div>
              ))}
            </CardContent>
            <CardFooter>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                nativeButton={false}
                render={<Link href={lastModel ? `/testing?model=${lastModel.id}` : "/testing"} />}
              >
                Test this model
              </Button>
            </CardFooter>
          </Card>
        </div>

        {/* Recent runs */}
        <Card>
          <CardHeader>
            <CardTitle>Recent runs</CardTitle>
            <CardDescription>Training and testing jobs, newest first</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {runs.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No runs yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Dataset</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">F1</TableHead>
                    <TableHead className="text-right">PR-AUC</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.slice(0, 8).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{new Date(r.createdAt).toLocaleString()}</TableCell>
                      <TableCell className="capitalize">{r.mode}</TableCell>
                      <TableCell>{kind(r)}</TableCell>
                      <TableCell>{r.dataset.label}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            r.status === "failed"
                              ? "destructive"
                              : r.status === "running"
                                ? "default"
                                : "secondary"
                          }
                        >
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.metrics?.f1 !== undefined ? r.metrics.f1.toFixed(4) : "–"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.metrics?.prAuc !== undefined ? r.metrics.prAuc.toFixed(4) : "–"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          nativeButton={false}
                          render={
                            <Link
                              href={r.mode === "train" ? `/training?run=${r.id}` : `/testing?run=${r.id}`}
                            />
                          }
                        >
                          Open
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
