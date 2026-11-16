import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

// Allow-list: the id from the URL is only a key, never part of a file path.
export const FILES: Record<string, string> = {
  "nf-unsw-nb15-v2": "NF-UNSW-NB15-v2/NF-UNSW-NB15-v2.csv",
  "nf-cse-cic-ids2018-v2": "NF-CSE-CIC-IDS2018-v2/NF-CSE-CIC-IDS2018-v2.csv",
  "nf-unsw-nb15-v3": "NF-UNSW-NB15-v3/NF-UNSW-NB15-v3.csv",
  "nf-cse-cic-ids2018-v3": "NF-CSE-CIC-IDS2018-v3/NF-CICIDS2018-v3.csv",
};

const STAT_COLS = [
  "IN_BYTES",
  "OUT_BYTES",
  "IN_PKTS",
  "OUT_PKTS",
  "FLOW_DURATION_MILLISECONDS",
  "L7_PROTO",
];
const SAMPLE_SIZE = 2000;
// Safety cap on how many host-to-host edges are kept (and cached) per dataset.
const MAX_EDGES = 200_000;
// While scanning, the in-memory host-pair table is kept below this many entries.
const EDGE_MAP_LIMIT = 1_000_000;
const PROTO: Record<string, "TCP" | "UDP" | "ICMP"> = {
  "6": "TCP",
  "17": "UDP",
  "1": "ICMP",
};

export type Flow = {
  id: number;
  src: string;
  srcPort: number;
  dst: string;
  dstPort: number;
  protocol: "TCP" | "UDP" | "ICMP";
  inBytes: number;
  outBytes: number;
  inPkts: number;
  outPkts: number;
  durationMs: number;
  attack: string;
};

export type DatasetData = {
  total: number;
  benign: number;
  attack: number;
  classes: { name: string; count: number }[];
  featureStats: {
    label: string;
    min: number;
    mean: number;
    std: number;
    max: number;
    missingPct: number;
  }[];
  flows: Flow[];
};

// One directed host pair, aggregated over ALL flows in the file.
// s = source IP, d = destination IP, n = total flows, a = attack flows.
export type Edge = { s: string; d: string; n: number; a: number };

type ScanResult = { data: DatasetData; edges: Edge[] };

// Keep every attack edge first (up to half the cap), then the busiest others.
function pruneEdges(all: Edge[]): Edge[] {
  if (all.length <= MAX_EDGES) return all;
  const attack = all
    .filter((e) => e.a > 0)
    .sort((x, y) => y.a - x.a)
    .slice(0, MAX_EDGES / 2);
  const kept = new Set(attack);
  const rest = all
    .filter((e) => !kept.has(e))
    .sort((x, y) => y.n - x.n)
    .slice(0, MAX_EDGES - attack.length);
  return [...attack, ...rest];
}

async function compute(id: string): Promise<ScanResult> {
  // Stream one line at a time so multi-GB files never sit in memory.
  const rl = readline.createInterface({
    input: fs.createReadStream(csvPath(id)),
    crlfDelay: Infinity,
  });

  let idx: Record<string, number> | null = null; // column name -> position
  let total = 0;
  const classCounts = new Map<string, number>();
  const stats = Object.fromEntries(
    STAT_COLS.map((c) => [
      c,
      { n: 0, mean: 0, m2: 0, min: Infinity, max: -Infinity, missing: 0 },
    ])
  );
  const sample: Flow[] = [];

  // Host pairs are keyed by interned integer ids (small and fast). IPs are
  // copied into fresh flat strings once, so we don't keep every CSV line alive.
  const ipIds = new Map<string, number>();
  const ipList: string[] = [];
  const intern = (ip: string) => {
    let i = ipIds.get(ip);
    if (i === undefined) {
      const flat = Buffer.from(ip).toString();
      i = ipList.length;
      ipList.push(flat);
      ipIds.set(flat, i);
    }
    return i;
  };
  type PairCount = { s: number; d: number; n: number; a: number };
  const edgeMap = new Map<number, PairCount>();
  let prunedBelow = 0; // benign-only pairs with <= this many flows may have been dropped

  // Memory guard for datasets with millions of host pairs (lossy counting):
  // drop the rarest benign-only pairs. Pairs with any attack flow are never dropped,
  // so attack counts stay exact; only rare benign pairs can be undercounted.
  const shrinkEdgeMap = () => {
    while (edgeMap.size > EDGE_MAP_LIMIT * 0.6) {
      prunedBelow++;
      let benignLeft = false;
      for (const [k, e] of edgeMap) {
        if (e.a > 0) continue;
        if (e.n <= prunedBelow) edgeMap.delete(k);
        else benignLeft = true;
      }
      if (!benignLeft) break; // only attack pairs remain; nothing more to drop
    }
  };

  const toFlow = (c: string[], i: Record<string, number>, n: number): Flow => ({
    id: n,
    src: c[i.IPV4_SRC_ADDR],
    srcPort: Number(c[i.L4_SRC_PORT]),
    dst: c[i.IPV4_DST_ADDR],
    dstPort: Number(c[i.L4_DST_PORT]),
    protocol: PROTO[c[i.PROTOCOL]] ?? "TCP",
    inBytes: Number(c[i.IN_BYTES]),
    outBytes: Number(c[i.OUT_BYTES]),
    inPkts: Number(c[i.IN_PKTS]),
    outPkts: Number(c[i.OUT_PKTS]),
    durationMs: Number(c[i.FLOW_DURATION_MILLISECONDS]),
    attack: c[i.Attack],
  });

  for await (const line of rl) {
    if (!idx) {
      // Header row. Look columns up by name so v2 and v3 layouts both work.
      idx = Object.fromEntries(
        line.replace(/^﻿/, "").split(",").map((h, k) => [h.trim(), k])
      );
      continue;
    }
    if (!line) continue;
    const c = line.split(",");
    total++;

    const attack = c[idx.Attack];
    classCounts.set(attack, (classCounts.get(attack) ?? 0) + 1);

    // Aggregate the host graph over every flow.
    const si = intern(c[idx.IPV4_SRC_ADDR]);
    const di = intern(c[idx.IPV4_DST_ADDR]);
    const key = si * 67108864 + di; // 2^26: supports up to 67M distinct hosts
    let edge = edgeMap.get(key);
    if (!edge) {
      edge = { s: si, d: di, n: 0, a: 0 };
      edgeMap.set(key, edge);
      if (edgeMap.size > EDGE_MAP_LIMIT) shrinkEdgeMap();
    }
    edge.n++;
    if (attack !== "Benign") edge.a++;

    for (const col of STAT_COLS) {
      const s = stats[col];
      const v = parseFloat(c[idx[col]]);
      if (Number.isNaN(v)) {
        s.missing++;
        continue;
      }
      // Welford's online mean/variance: one pass, no stored values.
      s.n++;
      const d = v - s.mean;
      s.mean += d / s.n;
      s.m2 += d * (v - s.mean);
      if (v < s.min) s.min = v;
      if (v > s.max) s.max = v;
    }

    // Reservoir sampling: each row has an equal chance of ending up in the sample.
    if (sample.length < SAMPLE_SIZE) {
      sample.push(toFlow(c, idx, total));
    } else {
      const j = Math.floor(Math.random() * total);
      if (j < SAMPLE_SIZE) sample[j] = toFlow(c, idx, total);
    }
  }

  const classes = [...classCounts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  const benign = classCounts.get("Benign") ?? 0;

  const data: DatasetData = {
    total,
    benign,
    attack: total - benign,
    classes,
    featureStats: STAT_COLS.map((label) => {
      const s = stats[label];
      return {
        label,
        min: s.n ? s.min : 0,
        max: s.n ? s.max : 0,
        mean: s.mean,
        std: s.n ? Math.sqrt(s.m2 / s.n) : 0,
        missingPct: total ? (s.missing / total) * 100 : 0,
      };
    }),
    flows: sample.sort((a, b) => a.id - b.id),
  };
  const edges = pruneEdges(
    [...edgeMap.values()].map((e) => ({ s: ipList[e.s], d: ipList[e.d], n: e.n, a: e.a }))
  );
  return { data, edges };
}

// ---------- Disk cache ----------
// Two files next to each CSV:
//   .explorer-cache.json  summary, stats and the sample
//   .explorer-graph.json  host-to-host edges aggregated over all flows
// Both store the CSV's size, so a changed CSV invalidates them.
// They live in <project>/cache/datasets/ (not in /data, which is gitignored),
// so they can be committed and reused on another computer.
// mtime is deliberately not checked: it differs between machines.
type CacheKind = "summary" | "graph";
type CacheFile<T> = { size: number; data: T };

const CACHE_DIR = path.join(process.cwd(), "cache", "datasets");
const csvPath = (id: string) => path.join(process.cwd(), "data", FILES[id]);
const cachePath = (id: string, kind: CacheKind) =>
  path.join(CACHE_DIR, `${id}.${kind}.json`);

async function readDisk<T>(id: string, kind: CacheKind): Promise<T | null> {
  try {
    const c = JSON.parse(
      await fs.promises.readFile(cachePath(id, kind), "utf8")
    ) as CacheFile<T>;
    // If the CSV is not on this machine, trust the cache (that is the point of
    // committing it). If the CSV is here, it must still be the same size.
    const stat = await fs.promises.stat(csvPath(id)).catch(() => null);
    if (!stat || stat.size === c.size) return c.data;
  } catch {
    // missing or corrupt cache file: fall through and recompute
  }
  return null;
}

async function writeDisk<T>(id: string, kind: CacheKind, data: T) {
  try {
    const stat = await fs.promises.stat(csvPath(id));
    const body: CacheFile<T> = { size: stat.size, data };
    await fs.promises.mkdir(CACHE_DIR, { recursive: true });
    // Temp file then rename: a crash never leaves a half-written cache.
    const tmp = `${cachePath(id, kind)}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(body));
    await fs.promises.rename(tmp, cachePath(id, kind));
  } catch (e) {
    console.warn(`Could not write ${kind} cache for ${id}:`, e);
  }
}

// ---------- Memory cache (in front of the disk cache) ----------
// Promises are cached so concurrent requests share one scan.
// globalThis keeps them alive across dev hot reloads.
const g = globalThis as unknown as {
  __ds?: {
    summary: Map<string, Promise<DatasetData>>;
    edges: Map<string, Promise<Edge[]>>;
    scans: Map<string, Promise<ScanResult>>;
  };
};
const mem = (g.__ds ??= { summary: new Map(), edges: new Map(), scans: new Map() });

// One scan produces both the summary and the edges, and saves both to disk.
function scan(id: string): Promise<ScanResult> {
  let p = mem.scans.get(id);
  if (!p) {
    p = compute(id).then(async (r) => {
      await Promise.all([
        writeDisk(id, "summary", r.data),
        writeDisk(id, "graph", r.edges),
      ]);
      return r;
    });
    mem.scans.set(id, p);
    const clear = () => mem.scans.delete(id);
    p.then(clear, clear);
  }
  return p;
}

function memoize<T>(map: Map<string, Promise<T>>, id: string, make: () => Promise<T>) {
  let p = map.get(id);
  if (!p) {
    p = make();
    // Don't cache failures, so a retry can succeed.
    p.catch(() => map.delete(id));
    map.set(id, p);
  }
  return p;
}

export function loadDataset(id: string): Promise<DatasetData> {
  return memoize(mem.summary, id, async () => {
    return (await readDisk<DatasetData>(id, "summary")) ?? (await scan(id)).data;
  });
}

function loadEdges(id: string): Promise<Edge[]> {
  return memoize(mem.edges, id, async () => {
    return (await readDisk<Edge[]>(id, "graph")) ?? (await scan(id)).edges;
  });
}

// ---------- Graph query ----------
export type GraphMode = "all" | "benign" | "attack";

export type GraphData = {
  nodes: { ip: string; benign: number; attack: number }[];
  edges: { s: string; d: string; benign: number; attack: number }[];
  matchedEdges: number; // edges matching the filters before the limit is applied
  totalEdges: number; // all host pairs in the dataset
};

export async function queryGraph(
  id: string,
  opts: { mode: GraphMode; ip: string; limit: number }
): Promise<GraphData> {
  const all = await loadEdges(id);
  const q = opts.ip.trim();
  const matches = q ? all.filter((e) => e.s.includes(q) || e.d.includes(q)) : all;

  const attackEdges = matches.filter((e) => e.a > 0).sort((x, y) => y.a - x.a);
  const benignEdges = matches
    .filter((e) => e.n - e.a > 0)
    .sort((x, y) => y.n - y.a - (x.n - x.a));

  let picked: Edge[];
  let matched: number;
  if (opts.mode === "attack") {
    picked = attackEdges.slice(0, opts.limit);
    matched = attackEdges.length;
  } else if (opts.mode === "benign") {
    picked = benignEdges.slice(0, opts.limit);
    matched = benignEdges.length;
  } else {
    // Show both: half the budget for attack edges, the rest for benign ones,
    // so attack traffic is never crowded out by the much larger benign set.
    const a = attackEdges.slice(0, Math.ceil(opts.limit / 2));
    const seen = new Set(a);
    const b: Edge[] = [];
    for (const e of benignEdges) {
      if (a.length + b.length >= opts.limit) break;
      if (!seen.has(e)) b.push(e);
    }
    picked = [...a, ...b];
    matched = matches.length;
  }

  const edges = picked.map((e) => ({
    s: e.s,
    d: e.d,
    benign: opts.mode === "attack" ? 0 : e.n - e.a,
    attack: opts.mode === "benign" ? 0 : e.a,
  }));

  const nodeMap = new Map<string, { ip: string; benign: number; attack: number }>();
  for (const e of edges) {
    for (const ip of [e.s, e.d]) {
      const n = nodeMap.get(ip) ?? { ip, benign: 0, attack: 0 };
      n.benign += e.benign;
      n.attack += e.attack;
      nodeMap.set(ip, n);
    }
  }

  return {
    nodes: [...nodeMap.values()],
    edges,
    matchedEdges: matched,
    totalEdges: all.length,
  };
}
