"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Network,
  Search,
  Table2,
  BarChart3,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

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
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
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

// ---------- Mock dataset (replace with API: GET /api/datasets/:id/flows) ----------
const DATASETS = [
  { id: "nf-unsw-nb15-v2", name: "NF-UNSW-NB15-v2" },
  { id: "nf-cse-cic-ids2018-v2", name: "NF-CSE-CIC-IDS2018-v2" },
  { id: "nf-ton-iot-v2", name: "NF-ToN-IoT-v2" },
  { id: "nf-bot-iot-v2", name: "NF-BoT-IoT-v2" },
  { id: "um-campus-sample", name: "UM campus sample" },
];

type Flow = {
  id: number;
  src: string;
  srcPort: number;
  dst: string;
  dstPort: number;
  protocol: "TCP" | "UDP" | "ICMP";
  l7Proto: number | null;
  inBytes: number;
  outBytes: number;
  inPkts: number;
  outPkts: number;
  durationMs: number;
  attack: string;
};

const ATTACKS = [
  "Exploits",
  "Fuzzers",
  "Generic",
  "Reconnaissance",
  "DoS",
  "Backdoor",
  "Shellcode",
  "Analysis",
  "Worms",
];

// Small deterministic PRNG so the mock data is stable between renders.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeFlows(n: number): Flow[] {
  const rnd = mulberry32(42);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
  const clients = Array.from({ length: 18 }, (_, i) => `10.0.${(i % 6) + 1}.${10 + i}`);
  const servers = Array.from({ length: 6 }, (_, i) => `172.16.0.${i + 2}`);
  return Array.from({ length: n }, (_, i) => {
    const isAttack = rnd() < 0.16;
    const r = rnd();
    const protocol: Flow["protocol"] = r < 0.72 ? "TCP" : r < 0.95 ? "UDP" : "ICMP";
    const scale = isAttack ? 6 : 1;
    const inPkts = Math.max(1, Math.round(rnd() * 40 * scale));
    const outPkts = Math.max(1, Math.round(rnd() * 30 * scale));
    return {
      id: i + 1,
      src: pick(clients),
      srcPort: 1024 + Math.floor(rnd() * 60000),
      dst: pick(servers),
      dstPort: pick([22, 53, 80, 443, 445, 3389, 8080]),
      protocol,
      l7Proto: rnd() < 0.04 ? null : pick([0, 5, 7, 91, 92, 120, 131, 178]),
      inBytes: inPkts * (60 + Math.floor(rnd() * 900)),
      outBytes: outPkts * (60 + Math.floor(rnd() * 900)),
      inPkts,
      outPkts,
      durationMs: Math.floor(rnd() * 4000 * (isAttack ? 3 : 1)),
      attack: isAttack ? pick(ATTACKS) : "Benign",
    };
  });
}

const FLOWS = makeFlows(300);

const NUMERIC_COLUMNS: { key: keyof Flow; label: string }[] = [
  { key: "inBytes", label: "IN_BYTES" },
  { key: "outBytes", label: "OUT_BYTES" },
  { key: "inPkts", label: "IN_PKTS" },
  { key: "outPkts", label: "OUT_PKTS" },
  { key: "durationMs", label: "FLOW_DURATION_MILLISECONDS" },
  { key: "l7Proto", label: "L7_PROTO" },
];

const PAGE_SIZE = 10;
const fmt = (n: number) => n.toLocaleString("en-US");

const barConfig = {
  count: { label: "Flows", color: "var(--chart-1)" },
} satisfies ChartConfig;

// ---------- Page ----------
export default function ExplorerPage() {
  // useSearchParams needs a Suspense boundary in the Next.js app router.
  return (
    <Suspense fallback={null}>
      <Explorer />
    </Suspense>
  );
}

function Explorer() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const datasetId = params.get("dataset") ?? DATASETS[0].id;
  const dataset = DATASETS.find((d) => d.id === datasetId) ?? DATASETS[0];

  const [search, setSearch] = useState("");
  const [labelFilter, setLabelFilter] = useState("all");
  const [attackFilter, setAttackFilter] = useState("all");
  const [protoFilter, setProtoFilter] = useState("all");
  const [page, setPage] = useState(1);

  // TODO: these should come from the backend for the selected dataset.
  const flows = FLOWS;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return flows.filter((f) => {
      if (labelFilter === "benign" && f.attack !== "Benign") return false;
      if (labelFilter === "attack" && f.attack === "Benign") return false;
      if (attackFilter !== "all" && f.attack !== attackFilter) return false;
      if (protoFilter !== "all" && f.protocol !== protoFilter) return false;
      if (q && !`${f.src} ${f.dst} ${f.dstPort} ${f.srcPort}`.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [flows, search, labelFilter, attackFilter, protoFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const rows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Summary numbers
  const attackCount = flows.filter((f) => f.attack !== "Benign").length;
  const benignCount = flows.length - attackCount;

  const classData = useMemo(() => {
    const counts = new Map<string, number>();
    flows.forEach((f) => counts.set(f.attack, (counts.get(f.attack) ?? 0) + 1));
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [flows]);

  const featureStats = useMemo(
    () =>
      NUMERIC_COLUMNS.map(({ key, label }) => {
        const vals = flows
          .map((f) => f[key])
          .filter((v): v is number => typeof v === "number");
        const missing = flows.length - vals.length;
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const std = Math.sqrt(
          vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length
        );
        return {
          label,
          min: Math.min(...vals),
          mean,
          std,
          max: Math.max(...vals),
          missingPct: (missing / flows.length) * 100,
        };
      }),
    [flows]
  );

  function resetPage<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(1);
    };
  }

  function changeDataset(id: string) {
    router.replace(`${pathname}?dataset=${id}`);
    setPage(1);
  }

  return (
    <div className="min-h-screen w-full bg-zinc-50 font-sans dark:bg-black">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 md:p-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Dataset explorer
            </h1>
            <p className="text-sm text-muted-foreground">
              Inspect flows, class balance and feature statistics before training.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={dataset.id} onValueChange={changeDataset}>
              <SelectTrigger className="w-[230px]">
                <SelectValue placeholder="Select dataset" />
              </SelectTrigger>
              <SelectContent>
                {DATASETS.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button asChild>
              <Link href={`/training?dataset=${dataset.id}`}>Train</Link>
            </Button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card>
            <CardHeader>
              <CardDescription>Flows (sample)</CardDescription>
              <CardTitle className="text-2xl tabular-nums">
                {fmt(flows.length)}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Benign</CardDescription>
              <CardTitle className="text-2xl tabular-nums">
                {fmt(benignCount)}
              </CardTitle>
            </CardHeader>
            <CardFooter className="text-xs text-muted-foreground">
              {((benignCount / flows.length) * 100).toFixed(1)}%
            </CardFooter>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Attack</CardDescription>
              <CardTitle className="text-2xl tabular-nums">
                {fmt(attackCount)}
              </CardTitle>
            </CardHeader>
            <CardFooter className="text-xs text-muted-foreground">
              {((attackCount / flows.length) * 100).toFixed(1)}%
            </CardFooter>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Attack types</CardDescription>
              <CardTitle className="text-2xl tabular-nums">
                {classData.length - 1}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Tabs defaultValue="table" className="gap-4">
          <TabsList>
            <TabsTrigger value="table">
              <Table2 className="size-4" /> Flows
            </TabsTrigger>
            <TabsTrigger value="stats">
              <BarChart3 className="size-4" /> Statistics
            </TabsTrigger>
            <TabsTrigger value="graph">
              <Network className="size-4" /> Graph preview
            </TabsTrigger>
          </TabsList>

          {/* ---------- Flows table ---------- */}
          <TabsContent value="table">
            <Card>
              <CardHeader>
                <CardTitle>Flow records</CardTitle>
                <CardDescription>
                  {fmt(filtered.length)} of {fmt(flows.length)} flows match
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-2 md:flex-row">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                    <Input
                      className="pl-8"
                      placeholder="Search IP address or port…"
                      value={search}
                      onChange={(e) => resetPage(setSearch)(e.target.value)}
                    />
                  </div>
                  <Select value={labelFilter} onValueChange={resetPage(setLabelFilter)}>
                    <SelectTrigger className="md:w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All labels</SelectItem>
                      <SelectItem value="benign">Benign</SelectItem>
                      <SelectItem value="attack">Attack</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={attackFilter} onValueChange={resetPage(setAttackFilter)}>
                    <SelectTrigger className="md:w-[170px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All attack types</SelectItem>
                      {ATTACKS.map((a) => (
                        <SelectItem key={a} value={a}>
                          {a}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={protoFilter} onValueChange={resetPage(setProtoFilter)}>
                    <SelectTrigger className="md:w-[130px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All protocols</SelectItem>
                      <SelectItem value="TCP">TCP</SelectItem>
                      <SelectItem value="UDP">UDP</SelectItem>
                      <SelectItem value="ICMP">ICMP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Destination</TableHead>
                        <TableHead>Proto</TableHead>
                        <TableHead className="text-right">In bytes</TableHead>
                        <TableHead className="text-right">Out bytes</TableHead>
                        <TableHead className="text-right">Packets</TableHead>
                        <TableHead className="text-right">Duration (ms)</TableHead>
                        <TableHead>Label</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={9}
                            className="py-8 text-center text-muted-foreground"
                          >
                            No flows match these filters.
                          </TableCell>
                        </TableRow>
                      ) : (
                        rows.map((f) => (
                          <TableRow key={f.id}>
                            <TableCell className="text-muted-foreground">
                              {f.id}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {f.src}:{f.srcPort}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {f.dst}:{f.dstPort}
                            </TableCell>
                            <TableCell>{f.protocol}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {fmt(f.inBytes)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {fmt(f.outBytes)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {f.inPkts + f.outPkts}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {fmt(f.durationMs)}
                            </TableCell>
                            <TableCell>
                              {f.attack === "Benign" ? (
                                <Badge variant="secondary">Benign</Badge>
                              ) : (
                                <Badge variant="destructive">{f.attack}</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
              <CardFooter className="justify-between">
                <p className="text-sm text-muted-foreground">
                  Page {safePage} of {totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={safePage <= 1}
                    onClick={() => setPage(safePage - 1)}
                  >
                    <ChevronLeft /> Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage(safePage + 1)}
                  >
                    Next <ChevronRight />
                  </Button>
                </div>
              </CardFooter>
            </Card>
          </TabsContent>

          {/* ---------- Statistics ---------- */}
          <TabsContent value="stats" className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Class distribution</CardTitle>
                <CardDescription>
                  Flows per class. Intrusion datasets are usually heavily imbalanced.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer
                  config={barConfig}
                  className="h-[320px] w-full"
                >
                  <BarChart
                    data={classData}
                    layout="vertical"
                    margin={{ left: 24, right: 12 }}
                  >
                    <CartesianGrid horizontal={false} />
                    <YAxis
                      dataKey="name"
                      type="category"
                      tickLine={false}
                      axisLine={false}
                      width={110}
                    />
                    <XAxis type="number" hide />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="count" fill="var(--color-count)" radius={4} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Benign vs attack</CardTitle>
                <CardDescription>Binary label balance</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-sm">
                    <span>Benign</span>
                    <span className="tabular-nums">
                      {((benignCount / flows.length) * 100).toFixed(1)}%
                    </span>
                  </div>
                  <Progress value={(benignCount / flows.length) * 100} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-sm">
                    <span>Attack</span>
                    <span className="tabular-nums">
                      {((attackCount / flows.length) * 100).toFixed(1)}%
                    </span>
                  </div>
                  <Progress value={(attackCount / flows.length) * 100} />
                </div>
                <p className="text-xs text-muted-foreground">
                  A skewed split means accuracy alone is misleading. Use
                  precision, recall and F1 when you evaluate the model.
                </p>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Feature statistics</CardTitle>
                <CardDescription>
                  Summary of numeric NetFlow features and missing values
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Feature</TableHead>
                      <TableHead className="text-right">Min</TableHead>
                      <TableHead className="text-right">Mean</TableHead>
                      <TableHead className="text-right">Std</TableHead>
                      <TableHead className="text-right">Max</TableHead>
                      <TableHead className="text-right">Missing</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {featureStats.map((s) => (
                      <TableRow key={s.label}>
                        <TableCell className="font-mono text-xs">
                          {s.label}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmt(s.min)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {s.mean.toFixed(1)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {s.std.toFixed(1)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmt(s.max)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {s.missingPct.toFixed(1)}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------- Graph preview ---------- */}
          <TabsContent value="graph">
            <Card>
              <CardHeader>
                <CardTitle>Host graph preview</CardTitle>
                <CardDescription>
                  Each node is an IP address and each edge is one or more flows
                  between two hosts. This is the structure HO-GraphIDS learns from.
                </CardDescription>
                <CardAction>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <span className="size-2.5 rounded-full bg-primary" /> Benign only
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="size-2.5 rounded-full bg-destructive" /> Involved in attack
                    </span>
                  </div>
                </CardAction>
              </CardHeader>
              <CardContent>
                <GraphPreview flows={flows} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ---------- Graph preview (plain SVG, no extra libraries) ----------
function GraphPreview({ flows }: { flows: Flow[] }) {
  const { nodes, edges } = useMemo(() => {
    // Take the 14 busiest hosts so the picture stays readable.
    const degree = new Map<string, number>();
    flows.forEach((f) => {
      degree.set(f.src, (degree.get(f.src) ?? 0) + 1);
      degree.set(f.dst, (degree.get(f.dst) ?? 0) + 1);
    });
    const top = [...degree.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 14)
      .map(([ip]) => ip);
    const set = new Set(top);

    const edgeMap = new Map<string, { a: string; b: string; count: number; attacks: number }>();
    const attackHosts = new Set<string>();
    flows.forEach((f) => {
      if (!set.has(f.src) || !set.has(f.dst)) return;
      const key = `${f.src}>${f.dst}`;
      const e = edgeMap.get(key) ?? { a: f.src, b: f.dst, count: 0, attacks: 0 };
      e.count += 1;
      if (f.attack !== "Benign") {
        e.attacks += 1;
        attackHosts.add(f.src);
        attackHosts.add(f.dst);
      }
      edgeMap.set(key, e);
    });

    // Circular layout: clients on the left arc, servers on the right arc.
    const cx = 300;
    const cy = 200;
    const r = 160;
    const positioned = top.map((ip, i) => {
      const angle = (i / top.length) * Math.PI * 2 - Math.PI / 2;
      return {
        ip,
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
        attack: attackHosts.has(ip),
      };
    });
    return { nodes: positioned, edges: [...edgeMap.values()] };
  }, [flows]);

  const pos = new Map(nodes.map((n) => [n.ip, n]));
  const maxCount = Math.max(1, ...edges.map((e) => e.count));

  return (
    <svg
      viewBox="0 0 600 400"
      className="h-auto w-full max-h-[480px]"
      role="img"
      aria-label="Host communication graph"
    >
      {edges.map((e) => {
        const a = pos.get(e.a)!;
        const b = pos.get(e.b)!;
        return (
          <line
            key={`${e.a}>${e.b}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            strokeWidth={0.6 + (e.count / maxCount) * 3}
            className={e.attacks > 0 ? "stroke-destructive" : "stroke-muted-foreground"}
            strokeOpacity={e.attacks > 0 ? 0.55 : 0.25}
          />
        );
      })}
      {nodes.map((n) => (
        <g key={n.ip}>
          <circle
            cx={n.x}
            cy={n.y}
            r={9}
            className={n.attack ? "fill-destructive" : "fill-primary"}
          />
          <text
            x={n.x}
            y={n.y + (n.y > 200 ? 24 : -16)}
            textAnchor="middle"
            className="fill-muted-foreground text-[10px]"
          >
            {n.ip}
          </text>
        </g>
      ))}
    </svg>
  );
}