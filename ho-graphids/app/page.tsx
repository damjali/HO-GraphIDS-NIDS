"use client";

import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Brain,
  Database,
  Network,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";

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

// ---- Mock data: replace with API calls to your backend ----
const stats = {
  totalFlows: 1_245_380,
  benign: 1_182_904,
  anomalous: 62_476,
  modelVersion: "v1.3",
  lastTrained: "2 Nov 2026, 21:14",
  liveStatus: "running" as "running" | "stopped",
  datasets: 4,
};

const trend = [
  { time: "10:00", benign: 820, anomaly: 14 },
  { time: "10:05", benign: 910, anomaly: 22 },
  { time: "10:10", benign: 870, anomaly: 65 },
  { time: "10:15", benign: 940, anomaly: 41 },
  { time: "10:20", benign: 890, anomaly: 18 },
  { time: "10:25", benign: 1020, anomaly: 77 },
  { time: "10:30", benign: 980, anomaly: 30 },
];

const chartConfig = {
  benign: { label: "Benign", color: "var(--chart-2)" },
  anomaly: { label: "Anomaly", color: "var(--chart-5)" },
} satisfies ChartConfig;

const metrics = [
  { label: "Accuracy", value: 98.2 },
  { label: "Precision", value: 96.7 },
  { label: "Recall", value: 95.4 },
  { label: "F1 score", value: 96.0 },
];

const recentAlerts = [
  { time: "16:41:08", src: "10.0.3.21:51322", dst: "172.16.0.5:445", proto: "TCP", score: 0.98, type: "Exploits" },
  { time: "16:41:05", src: "10.0.7.14:40211", dst: "172.16.0.9:22", proto: "TCP", score: 0.93, type: "Brute Force" },
  { time: "16:40:57", src: "10.0.2.88:53", dst: "172.16.0.2:53", proto: "UDP", score: 0.89, type: "DoS" },
  { time: "16:40:44", src: "10.0.5.10:60122", dst: "172.16.0.5:80", proto: "TCP", score: 0.86, type: "Reconnaissance" },
  { time: "16:40:31", src: "10.0.1.33:44871", dst: "172.16.0.7:3389", proto: "TCP", score: 0.81, type: "Backdoor" },
];

const fmt = (n: number) => n.toLocaleString("en-US");

export default function Home() {
  const anomalyPct = (stats.anomalous / stats.totalFlows) * 100;
  const benignPct = 100 - anomalyPct;
  const live = stats.liveStatus === "running";

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
            <Button asChild variant="outline" size="sm">
              <Link href="/upload">
                <Upload /> Upload data
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/training">
                <Brain /> Train model
              </Link>
            </Button>
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader>
              <CardDescription>Total flows</CardDescription>
              <CardTitle className="text-2xl tabular-nums">
                {fmt(stats.totalFlows)}
              </CardTitle>
              <CardAction>
                <Database className="size-4 text-muted-foreground" />
              </CardAction>
            </CardHeader>
            <CardFooter className="text-xs text-muted-foreground">
              Across {stats.datasets} datasets
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardDescription>Benign flows</CardDescription>
              <CardTitle className="text-2xl tabular-nums">
                {fmt(stats.benign)}
              </CardTitle>
              <CardAction>
                <ShieldCheck className="size-4 text-muted-foreground" />
              </CardAction>
            </CardHeader>
            <CardFooter className="text-xs text-muted-foreground">
              {benignPct.toFixed(1)}% of all flows
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardDescription>Anomalous flows</CardDescription>
              <CardTitle className="text-2xl tabular-nums">
                {fmt(stats.anomalous)}
              </CardTitle>
              <CardAction>
                <AlertTriangle className="size-4 text-destructive" />
              </CardAction>
            </CardHeader>
            <CardFooter className="text-xs text-muted-foreground">
              {anomalyPct.toFixed(1)}% of all flows
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardDescription>Live monitor</CardDescription>
              <CardTitle className="text-2xl">
                {live ? "Running" : "Stopped"}
              </CardTitle>
              <CardAction>
                <Badge variant={live ? "default" : "secondary"}>
                  <Activity className="size-3" />
                  {stats.modelVersion}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardFooter className="text-xs text-muted-foreground">
              Last trained {stats.lastTrained}
            </CardFooter>
          </Card>
        </div>

        {/* Chart + model metrics */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Flow activity</CardTitle>
              <CardDescription>
                Benign vs anomalous flows, last 30 minutes
              </CardDescription>
              <CardAction>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/live">Open live monitor</Link>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <ChartContainer config={chartConfig} className="h-[260px] w-full">
                <AreaChart data={trend} margin={{ left: 12, right: 12 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="time"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area
                    dataKey="benign"
                    type="monotone"
                    fill="var(--color-benign)"
                    fillOpacity={0.25}
                    stroke="var(--color-benign)"
                  />
                  <Area
                    dataKey="anomaly"
                    type="monotone"
                    fill="var(--color-anomaly)"
                    fillOpacity={0.35}
                    stroke="var(--color-anomaly)"
                  />
                </AreaChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Active model</CardTitle>
              <CardDescription>
                HO-GraphIDS {stats.modelVersion} · test set
              </CardDescription>
              <CardAction>
                <Network className="size-4 text-muted-foreground" />
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {metrics.map((m) => (
                <div key={m.label} className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-sm">
                    <span>{m.label}</span>
                    <span className="font-medium tabular-nums">
                      {m.value.toFixed(1)}%
                    </span>
                  </div>
                  <Progress value={m.value} />
                </div>
              ))}
            </CardContent>
            <CardFooter>
              <Button asChild variant="outline" size="sm" className="w-full">
                <Link href="/evaluation">View full evaluation</Link>
              </Button>
            </CardFooter>
          </Card>
        </div>

        {/* Recent alerts */}
        <Card>
          <CardHeader>
            <CardTitle>Recent alerts</CardTitle>
            <CardDescription>Latest flows flagged as anomalous</CardDescription>
            <CardAction>
              <Button asChild variant="outline" size="sm">
                <Link href="/flows">View all flows</Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead>Protocol</TableHead>
                  <TableHead>Attack type</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentAlerts.map((a) => (
                  <TableRow key={`${a.time}-${a.src}`}>
                    <TableCell className="font-mono text-xs">{a.time}</TableCell>
                    <TableCell className="font-mono text-xs">{a.src}</TableCell>
                    <TableCell className="font-mono text-xs">{a.dst}</TableCell>
                    <TableCell>{a.proto}</TableCell>
                    <TableCell>
                      <Badge variant="destructive">{a.type}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {a.score.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}