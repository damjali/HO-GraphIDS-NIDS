"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { DatasetData, Flow } from "@/lib/datasets";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Network,
  Search,
  Table2,
  BarChart3,
  ZoomIn,
  ZoomOut,
  Maximize,
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

// Ids must match the keys in FILES (lib/datasets.ts).
const DATASETS = [
  { id: "nf-unsw-nb15-v2", name: "NF-UNSW-NB15-v2" },
  { id: "nf-cse-cic-ids2018-v2", name: "NF-CSE-CIC-IDS2018-v2" },
  { id: "nf-unsw-nb15-v3", name: "NF-UNSW-NB15-v3" },
  { id: "nf-cse-cic-ids2018-v3", name: "NF-CSE-CIC-IDS2018-v3" },
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

  const [data, setData] = useState<DatasetData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load the selected dataset from the server (streams the CSV in /data).
  useEffect(() => {
    let cancelled = false; // ignore stale responses if the user switches dataset
    setData(null);
    setError(null);
    fetch(`/api/datasets/${dataset.id}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Failed to load dataset");
        return body as DatasetData;
      })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [dataset.id]);

  // Sample of rows for the table and graph. Totals/stats come from the full file.
  const flows: Flow[] = useMemo(() => data?.flows ?? [], [data]);

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

  function resetPage(setter: (v: string) => void) {
    return (v: string | null) => {
      if (v == null) return;
      setter(v);
      setPage(1);
    };
  }

  function changeDataset(id: string | null) {
    if (id == null) return;
    router.replace(`${pathname}?dataset=${id}`);
    setPage(1);
  }

  if (error) return <p className="p-6 text-destructive">{error}</p>;
  if (!data)
    return (
      <p className="p-6 text-muted-foreground">
        Loading {dataset.name}… the first load scans the whole CSV and can take a while.
      </p>
    );

  const { total, benign: benignCount, attack: attackCount, classes: classData, featureStats } = data;
  const attackTypes = classData.filter((c) => c.name !== "Benign");

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
            <Button
              nativeButton={false}
              render={<Link href={`/training?dataset=${dataset.id}`} />}
            >
              Train
            </Button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card>
            <CardHeader>
              <CardDescription>Flows</CardDescription>
              <CardTitle className="text-2xl tabular-nums">
                {fmt(total)}
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
              {((benignCount / total) * 100).toFixed(1)}%
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
              {((attackCount / total) * 100).toFixed(1)}%
            </CardFooter>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Attack types</CardDescription>
              <CardTitle className="text-2xl tabular-nums">
                {attackTypes.length}
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
                  {fmt(filtered.length)} of {fmt(flows.length)} sampled flows match
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
                      {attackTypes.map(({ name: a }) => (
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
                      {((benignCount / total) * 100).toFixed(1)}%
                    </span>
                  </div>
                  <Progress value={(benignCount / total) * 100} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-sm">
                    <span>Attack</span>
                    <span className="tabular-nums">
                      {((attackCount / total) * 100).toFixed(1)}%
                    </span>
                  </div>
                  <Progress value={(attackCount / total) * 100} />
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
                <GraphPreview datasetId={dataset.id} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ---------- Graph preview (plain SVG, built from ALL flows on the server) ----------
type GraphResponse = {
  nodes: { ip: string; benign: number; attack: number }[];
  edges: { s: string; d: string; benign: number; attack: number }[];
  matchedEdges: number;
  totalEdges: number;
};

function GraphPreview({ datasetId }: { datasetId: string }) {
  const [mode, setMode] = useState("all");
  const [limit, setLimit] = useState("60");
  const [ip, setIp] = useState("");
  const [debouncedIp, setDebouncedIp] = useState("");
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Wait for the user to stop typing before querying.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedIp(ip.trim()), 300);
    return () => clearTimeout(t);
  }, [ip]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ mode, limit, ip: debouncedIp });
    fetch(`/api/datasets/${datasetId}/graph?${qs}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Failed to load graph");
        return body as GraphResponse;
      })
      .then((g) => {
        if (!cancelled) setGraph(g);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [datasetId, mode, limit, debouncedIp]);

  // Circular layout. Attack hosts are grouped together so they are easy to spot.
  const { pos, maxCount } = useMemo(() => {
    const nodes = [...(graph?.nodes ?? [])].sort(
      (a, b) => Number(b.attack > 0) - Number(a.attack > 0) || a.ip.localeCompare(b.ip)
    );
    const cx = 400;
    const cy = 260;
    const r = 190;
    const pos = new Map(
      nodes.map((n, i) => {
        const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2 - Math.PI / 2;
        return [
          n.ip,
          { ...n, x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), angle },
        ] as const;
      })
    );
    const maxCount = Math.max(1, ...(graph?.edges ?? []).map((e) => e.benign + e.attack));
    return { pos, maxCount };
  }, [graph]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <Select
          value={mode}
          onValueChange={(v) => v != null && setMode(v)}
        >
          <SelectTrigger className="md:w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Benign + attack</SelectItem>
            <SelectItem value="benign">Benign only</SelectItem>
            <SelectItem value="attack">Attack only</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Filter by IP address (e.g. 175.45.176.1)…"
            value={ip}
            onChange={(e) => setIp(e.target.value)}
          />
        </div>
        <Select value={limit} onValueChange={(v) => v != null && setLimit(v)}>
          <SelectTrigger className="md:w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="30">Max 30 edges</SelectItem>
            <SelectItem value="60">Max 60 edges</SelectItem>
            <SelectItem value="120">Max 120 edges</SelectItem>
            <SelectItem value="all">All edges (up to 5,000)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <p className="py-10 text-center text-destructive">{error}</p>
      ) : !graph ? (
        <p className="py-10 text-center text-muted-foreground">Loading graph…</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Showing {fmt(graph.edges.length)} of {fmt(graph.matchedEdges)} matching host
            pairs ({fmt(graph.totalEdges)} in the whole dataset) across{" "}
            {fmt(graph.nodes.length)} hosts. Built from every flow in the file.
            {loading && " Updating…"}
          </p>
          {graph.edges.length === 0 ? (
            <p className="py-10 text-center text-muted-foreground">
              No host pairs match these filters.
            </p>
          ) : (
            <GraphCanvas
              pos={pos}
              edges={graph.edges}
              maxCount={maxCount}
              loading={loading}
            />
          )}
        </>
      )}
    </div>
  );
}

// ---------- Interactive canvas: zoom, pan, hover and click to highlight ----------
type PosNode = {
  ip: string;
  benign: number;
  attack: number;
  x: number;
  y: number;
  angle: number;
};
type GraphEdge = GraphResponse["edges"][number];

const VIEW_W = 800;
const VIEW_H = 520;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 40;

function GraphCanvas({
  pos,
  edges,
  maxCount,
  loading,
}: {
  pos: Map<string, PosNode>;
  edges: GraphEdge[];
  maxCount: number;
  loading: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const drag = useRef<{ moved: number } | null>(null);

  // New data: go back to the default view.
  useEffect(() => {
    setView({ x: 0, y: 0, k: 1 });
    setSelected(null);
    setHovered(null);
  }, [edges]);

  // Zoom around a point given in SVG coordinates, keeping that point fixed.
  function zoomAt(sx: number, sy: number, factor: number) {
    setView((v) => {
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * factor));
      const r = k / v.k;
      return { k, x: sx - (sx - v.x) * r, y: sy - (sy - v.y) * r };
    });
  }

  // Wheel needs a non-passive listener so we can stop the page from scrolling.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const sx = ((e.clientX - rect.left) / rect.width) * VIEW_W;
      const sy = ((e.clientY - rect.top) / rect.height) * VIEW_H;
      zoomAt(sx, sy, Math.exp(-e.deltaY * 0.0015));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    drag.current = { moved: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!drag.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = (e.movementX / rect.width) * VIEW_W;
    const dy = (e.movementY / rect.height) * VIEW_H;
    drag.current.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  }
  function onPointerUp() {
    // A press that barely moved is a click on the background: clear the selection.
    if (drag.current && drag.current.moved < 4) setSelected(null);
    drag.current = null;
  }

  function zoomCenter(factor: number) {
    zoomAt(VIEW_W / 2, VIEW_H / 2, factor);
  }

  const active = selected ?? hovered;

  // Hosts directly connected to the active one.
  const neighbours = useMemo(() => {
    const set = new Set<string>();
    if (!active) return set;
    set.add(active);
    for (const e of edges) {
      if (e.s === active) set.add(e.d);
      if (e.d === active) set.add(e.s);
    }
    return set;
  }, [active, edges]);

  const selectedNode = selected ? pos.get(selected) : undefined;
  const selectedEdges = useMemo(
    () =>
      selected
        ? edges
            .filter((e) => e.s === selected || e.d === selected)
            .sort((a, b) => b.benign + b.attack - (a.benign + a.attack))
        : [],
    [selected, edges]
  );

  const k = view.k;
  const manyNodes = pos.size > 60;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-[800/520] w-full overflow-hidden rounded-md border bg-background">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className={`h-full w-full cursor-grab touch-none select-none active:cursor-grabbing ${
            loading ? "opacity-60" : ""
          }`}
          role="img"
          aria-label="Host communication graph"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <g transform={`translate(${view.x} ${view.y}) scale(${k})`}>
            {edges.map((e) => {
              const a = pos.get(e.s);
              const b = pos.get(e.d);
              if (!a || !b) return null;
              const count = e.benign + e.attack;
              const related = !active || e.s === active || e.d === active;
              return (
                <line
                  key={`${e.s}>${e.d}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  vectorEffect="non-scaling-stroke"
                  strokeWidth={0.6 + (Math.log1p(count) / Math.log1p(maxCount)) * 3.5}
                  className={e.attack > 0 ? "stroke-destructive" : "stroke-muted-foreground"}
                  strokeOpacity={related ? (e.attack > 0 ? 0.7 : 0.4) : 0.05}
                >
                  <title>
                    {e.s} → {e.d}: {fmt(e.benign)} benign, {fmt(e.attack)} attack flows
                  </title>
                </line>
              );
            })}
            {[...pos.values()].map((n) => {
              const dim = active != null && !neighbours.has(n.ip);
              const cos = Math.cos(n.angle);
              const sin = Math.sin(n.angle);
              // Constant on-screen size no matter the zoom level.
              const r = 6 / Math.sqrt(k);
              const showLabel =
                n.ip === active ||
                (active != null && neighbours.has(n.ip)) ||
                (!manyNodes && !dim) ||
                k >= 3;
              return (
                <g
                  key={n.ip}
                  opacity={dim ? 0.15 : 1}
                  className="cursor-pointer"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected((s) => (s === n.ip ? null : n.ip));
                  }}
                  onPointerEnter={() => setHovered(n.ip)}
                  onPointerLeave={() => setHovered(null)}
                >
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={n.ip === selected ? r * 1.5 : r}
                    className={n.attack > 0 ? "fill-destructive" : "fill-primary"}
                  >
                    <title>
                      {n.ip}: {fmt(n.benign)} benign, {fmt(n.attack)} attack flows
                    </title>
                  </circle>
                  {showLabel && (
                    <text
                      x={n.x + (cos * 12) / k}
                      y={n.y + (sin * 12) / k + 3 / k}
                      textAnchor={cos > 0.2 ? "start" : cos < -0.2 ? "end" : "middle"}
                      style={{ fontSize: 9 / k }}
                      className="pointer-events-none fill-foreground"
                    >
                      {n.ip}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        <div className="absolute right-2 top-2 flex flex-col gap-1">
          <Button size="icon-sm" variant="outline" aria-label="Zoom in" onClick={() => zoomCenter(1.5)}>
            <ZoomIn />
          </Button>
          <Button size="icon-sm" variant="outline" aria-label="Zoom out" onClick={() => zoomCenter(1 / 1.5)}>
            <ZoomOut />
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="Reset view"
            onClick={() => setView({ x: 0, y: 0, k: 1 })}
          >
            <Maximize />
          </Button>
        </div>
        <span className="absolute bottom-2 left-2 rounded bg-background/80 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
          {Math.round(k * 100)}%
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        Scroll to zoom, drag to pan, hover a host to highlight its connections, click
        a host to pin it.
      </p>

      {selectedNode && (
        <div className="rounded-md border p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono">{selectedNode.ip}</span>
            <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
              Clear
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {fmt(selectedNode.benign)} benign and {fmt(selectedNode.attack)} attack flows
            across {fmt(selectedEdges.length)} connections shown
          </p>
          <ul className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto font-mono text-xs">
            {selectedEdges.map((e) => (
              <li key={`${e.s}>${e.d}`} className="flex justify-between gap-2">
                <span>
                  {e.s} → {e.d}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {fmt(e.benign)} benign
                  {e.attack > 0 && (
                    <span className="text-destructive"> · {fmt(e.attack)} attack</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
