"use client";

import { Line, LineChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
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
import type { RunDetail, ScoreResult } from "@/lib/graphids/types";

export const fmtInt = (n: number | null | undefined) =>
  n == null ? "–" : n.toLocaleString("en-US");
export const fmtNum = (n: number | null | undefined, d = 4) =>
  n == null || Number.isNaN(n) ? "–" : n.toFixed(d);

const lossConfig = {
  trainLoss: { label: "Train loss", color: "var(--chart-1)" },
  valLoss: { label: "Validation loss", color: "var(--chart-2)" },
} satisfies ChartConfig;
const aucConfig = {
  valPrAuc: { label: "Validation PR-AUC", color: "var(--chart-3)" },
} satisfies ChartConfig;

function StatusBadge({ status }: { status: RunDetail["status"] }) {
  if (status === "running") return <Badge>Running</Badge>;
  if (status === "completed") return <Badge variant="secondary">Completed</Badge>;
  if (status === "cancelled") return <Badge variant="outline">Cancelled</Badge>;
  return <Badge variant="destructive">Failed</Badge>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

export function RunPanel({
  run,
  onCancel,
}: {
  run: RunDetail;
  onCancel?: () => void;
}) {
  const m = run.metrics;
  const isTrain = run.mode === "train";
  const pct = Math.round(run.progress.pct);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {isTrain ? "Training" : "Testing"} · {run.dataset.label}
            <StatusBadge status={run.status} />
            <Badge variant="outline">
              {run.modelType}
              {run.modelType === "HO-GraphIDS" ? ` · ${run.numHops} hops, ${run.hopMode}` : ""}
            </Badge>
          </CardTitle>
          <CardDescription className="font-mono text-xs">{run.id}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>
              {run.phase}
              {isTrain && run.progress.epochs > 0 && run.status === "running" && (
                <span className="text-muted-foreground">
                  {" "}
                  · epoch {run.progress.epoch}/{run.progress.epochs}
                </span>
              )}
            </span>
            {run.status === "running" && onCancel && (
              <Button size="sm" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
          <Progress value={run.status === "running" && pct === 0 ? null : pct} />
          {run.status === "failed" && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {run.error ?? "The run failed. See the log below."}
            </p>
          )}
        </CardContent>
      </Card>

      {m && (m.f1 !== undefined || m.prAuc !== undefined) && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Macro F1" value={fmtNum(m.f1)} />
          <Stat label="PR-AUC" value={fmtNum(m.prAuc)} />
          <Stat label="Detected benign" value={fmtInt(m.benign)} />
          <Stat label="Detected malicious" value={fmtInt(m.malicious)} />
        </div>
      )}

      {isTrain && run.history.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Loss per epoch</CardTitle>
            </CardHeader>
            <CardContent>
              <ChartContainer config={lossConfig} className="h-[220px] w-full">
                <LineChart data={run.history} margin={{ left: 4, right: 8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="epoch" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} width={48} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line dataKey="trainLoss" stroke="var(--color-trainLoss)" dot={false} />
                  <Line dataKey="valLoss" stroke="var(--color-valLoss)" dot={false} />
                </LineChart>
              </ChartContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Validation PR-AUC</CardTitle>
              <CardDescription>The model with the best value is kept.</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={aucConfig} className="h-[220px] w-full">
                <LineChart data={run.history} margin={{ left: 4, right: 8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="epoch" tickLine={false} axisLine={false} />
                  <YAxis domain={[0, 1]} tickLine={false} axisLine={false} width={40} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line dataKey="valPrAuc" stroke="var(--color-valPrAuc)" dot={false} />
                </LineChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {run.result && <ScoreResultView result={run.result} />}

      <details className="rounded-md border">
        <summary className="cursor-pointer px-3 py-2 text-sm text-muted-foreground">
          Log
        </summary>
        <pre className="max-h-64 overflow-auto border-t p-3 text-xs">
          {run.logTail.length ? run.logTail.join("\n") : "No output yet."}
        </pre>
      </details>
    </div>
  );
}

export function ScoreResultView({ result: r }: { result: ScoreResult }) {
  const flaggedPct = r.scoredFlows ? (r.predictedMalicious / r.scoredFlows) * 100 : 0;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Flows scored" value={fmtInt(r.scoredFlows)} />
        <Stat label="Flagged malicious" value={fmtInt(r.predictedMalicious)} />
        <Stat label="Flagged share" value={`${flaggedPct.toFixed(2)}%`} />
        <Stat label="Threshold" value={fmtNum(r.threshold, 5)} />
      </div>

      {r.metrics && (
        <Card>
          <CardHeader>
            <CardTitle>Against the labels in your file</CardTitle>
            <CardDescription>
              Macro F1 {fmtNum(r.metrics.f1)} · PR-AUC {fmtNum(r.metrics.prAuc)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead />
                  <TableHead className="text-right">Predicted benign</TableHead>
                  <TableHead className="text-right">Predicted malicious</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>Actually benign</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtInt(r.metrics.tn)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtInt(r.metrics.fp)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Actually malicious</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtInt(r.metrics.fn)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtInt(r.metrics.tp)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {r.topHosts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Hosts involved in the most flagged flows</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>IP address</TableHead>
                  <TableHead className="text-right">Flagged flows</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.topHosts.map((h) => (
                  <TableRow key={h.ip}>
                    <TableCell className="font-mono text-xs">{h.ip}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtInt(h.flaggedFlows)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Most anomalous flows</CardTitle>
          <CardDescription>
            Highest reconstruction error first. A flow above the threshold is flagged.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>CSV row</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead className="text-right">Error</TableHead>
                <TableHead>Result</TableHead>
                {r.labeled && <TableHead>Actual</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.top.map((f) => (
                <TableRow key={String(f.row)}>
                  <TableCell className="text-muted-foreground">{String(f.row)}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {String(f.IPV4_SRC_ADDR)}:{String(f.L4_SRC_PORT)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {String(f.IPV4_DST_ADDR)}:{String(f.L4_DST_PORT)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtNum(f.error as number, 5)}
                  </TableCell>
                  <TableCell>
                    {f.flagged ? (
                      <Badge variant="destructive">Malicious</Badge>
                    ) : (
                      <Badge variant="secondary">Benign</Badge>
                    )}
                  </TableCell>
                  {r.labeled && (
                    <TableCell>{f.Attack ? String(f.Attack) : f.label ? "Attack" : "Benign"}</TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
