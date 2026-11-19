import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  BACKEND_DIR,
  DATA_DIR,
  GRAPHIDS_PYTHON,
  GRAPHIDS_ROOT,
  RUNS_DIR,
  csvFor,
  findDataset,
  getUpload,
  type DatasetInfo,
} from "./config";
import { checkSchemaMatch, edgeFeatureColumns, readCsvHeader } from "./schema";
import {
  applyOverrides,
  baseConfigFor,
  serializeConfig,
  type Config,
} from "./yaml";

// A run is a folder in ./runs/<id>/ holding meta.json, log.txt, config.yaml and,
// for training, model.ckpt + scaler.pkl. Python writes straight into log.txt
// (no pipes), so a run survives a restart of the Next.js server. Status is
// derived by parsing that log whenever somebody asks for it.

export type RunMode = "train" | "test";
export type RunStatus = "running" | "completed" | "failed" | "cancelled";

export type HistoryPoint = {
  epoch: number;
  trainLoss: number;
  valLoss: number;
  valPrAuc: number;
};

export type Metrics = {
  f1?: number;
  prAuc?: number;
  benign?: number;
  malicious?: number;
  predictionSeconds?: number;
  features?: number;
};

export type RunMeta = {
  id: string;
  mode: RunMode;
  status: RunStatus;
  dataset: Pick<DatasetInfo, "id" | "pyName" | "label" | "source" | "version">;
  modelType: "GraphIDS" | "HO-GraphIDS";
  numLayers: number; // Transformer depth
  numHops: number; // SAGELayer hops
  hopMode: "edge" | "node";
  seed: number;
  config: Config;
  featureColumns?: string[];
  // test runs
  modelRunId?: string;
  target?: "builtin" | "upload";
  uploadName?: string;
  // lifecycle
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  pid?: number;
  exitCode?: number | null;
  phase: string;
  progress: { epoch: number; epochs: number; pct: number };
  history: HistoryPoint[];
  metrics?: Metrics;
  hasCheckpoint?: boolean;
  hasResult?: boolean;
  error?: string;
  logOffset: number;
};

const ID_RE = /^(train|test)-\d{8}-\d{6}-[0-9a-f]{4}$/;
export const isRunId = (id: string) => ID_RE.test(id);

const runDir = (id: string) => path.join(RUNS_DIR, id);
const metaPath = (id: string) => path.join(runDir(id), "meta.json");
const logPath = (id: string) => path.join(runDir(id), "log.txt");
const configPath = (id: string) => path.join(runDir(id), "config.yaml");
const ckptPath = (id: string) => path.join(runDir(id), "model.ckpt");
const scalerPath = (id: string) => path.join(runDir(id), "scaler.pkl");
const resultPath = (id: string) => path.join(runDir(id), "result.json");

// ---------- meta.json (small, read/written synchronously) ----------
function readMeta(id: string): RunMeta | null {
  if (!isRunId(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath(id), "utf8")) as RunMeta;
  } catch {
    return null;
  }
}

function writeMeta(meta: RunMeta) {
  const tmp = `${metaPath(meta.id)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(meta));
  fs.renameSync(tmp, metaPath(meta.id));
}

// ---------- log parsing ----------
const num = (s: string) => Number(s);

function parseLine(meta: RunMeta, line: string) {
  const l = line.trim();
  if (!l) return;

  // Output of backend/score_flows.py
  const prog = l.match(/^PROGRESS:\s*(.+?)\|(\d+)$/);
  if (prog) {
    meta.phase = prog[1];
    meta.progress.pct = Number(prog[2]);
    return;
  }

  if (/Processing dataset/.test(l)) meta.phase = "Preparing data (first run builds the graph cache)";
  else if (/Loading model from checkpoint/.test(l)) meta.phase = "Loading checkpoint";
  else if (/Starting training/.test(l)) meta.phase = "Training";
  else if (/Evaluating on test set/.test(l)) {
    meta.phase = "Evaluating on the test split";
    meta.progress.pct = 100;
  } else if (/Early stopping/.test(l)) meta.phase = "Early stopping";

  let m: RegExpMatchArray | null;
  meta.metrics ??= {};
  if ((m = l.match(/Number of features:\s*(\d+)/))) meta.metrics.features = num(m[1]);
  if ((m = l.match(/Detected Benign:\s*(\d+)/))) meta.metrics.benign = num(m[1]);
  if ((m = l.match(/Detected Malicious:\s*(\d+)/))) meta.metrics.malicious = num(m[1]);
  if ((m = l.match(/Test macro F1-score:\s*([\d.]+)/))) meta.metrics.f1 = num(m[1]);
  if ((m = l.match(/Test PR-AUC\/AP:\s*([\d.]+)/))) meta.metrics.prAuc = num(m[1]);
  if ((m = l.match(/Test prediction time:\s*([\d.]+)/))) meta.metrics.predictionSeconds = num(m[1]);

  // tqdm line: "Epochs:  12%|███ | 12/100 [01:02<..., train_loss=…, val_loss=…, val_pr_auc=…]"
  if (/Epochs/.test(l) && (m = l.match(/(\d+)\/(\d+)\s*\[/))) {
    meta.progress.epoch = num(m[1]);
    meta.progress.epochs = num(m[2]);
    meta.progress.pct = Math.min(100, (num(m[1]) / Math.max(1, num(m[2]))) * 100);
    const tl = l.match(/train_loss=([^,\]\s]+)/);
    const vl = l.match(/val_loss=([^,\]\s]+)/);
    const va = l.match(/val_pr_auc=([^,\]\s]+)/);
    if (tl && vl && va) {
      const p = { trainLoss: num(tl[1]), valLoss: num(vl[1]), valPrAuc: num(va[1]) };
      const last = meta.history[meta.history.length - 1];
      if (
        !last ||
        last.trainLoss !== p.trainLoss ||
        last.valLoss !== p.valLoss ||
        last.valPrAuc !== p.valPrAuc
      ) {
        meta.history.push({ epoch: meta.history.length + 1, ...p });
      }
    }
  }
}

// tqdm redraws with "\r" and never ends the line, so we split on both and only
// consume up to the last separator (the tail may be a half-written line).
function parseNewLog(meta: RunMeta, final: boolean) {
  let size = 0;
  try {
    size = fs.statSync(logPath(meta.id)).size;
  } catch {
    return;
  }
  if (size <= meta.logOffset) return;
  const fd = fs.openSync(logPath(meta.id), "r");
  try {
    const buf = Buffer.alloc(size - meta.logOffset);
    fs.readSync(fd, buf, 0, buf.length, meta.logOffset);
    let end = buf.length;
    if (!final) {
      end = Math.max(buf.lastIndexOf(0x0a), buf.lastIndexOf(0x0d)) + 1;
      if (end <= 0) return;
    }
    for (const line of buf.toString("utf8", 0, end).split(/[\r\n]+/)) parseLine(meta, line);
    meta.logOffset += end;
  } finally {
    fs.closeSync(fd);
  }
}

function lastErrorLine(id: string): string | undefined {
  try {
    const text = readLogTail(id, 60).join("\n");
    const lines = text.split("\n").filter((l) => /(Error|Exception|Killed|MemoryError)/.test(l));
    return lines[lines.length - 1]?.slice(0, 400);
  } catch {
    return undefined;
  }
}

export function readLogTail(id: string, maxLines = 40): string[] {
  if (!isRunId(id)) return [];
  try {
    const size = fs.statSync(logPath(id)).size;
    const len = Math.min(size, 16 * 1024);
    const fd = fs.openSync(logPath(id), "r");
    try {
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      const lines = buf.toString("utf8").split(/[\r\n]+/).filter(Boolean);
      // Collapse the many tqdm redraws of the same bar into the latest one.
      const out: string[] = [];
      for (const l of lines) {
        if (/^Epochs:/.test(l) && /^Epochs:/.test(out[out.length - 1] ?? "")) out[out.length - 1] = l;
        else out.push(l);
      }
      return out.slice(-maxLines);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return [];
  }
}

// ---------- lifecycle ----------
function pidAlive(pid: number | undefined) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function copyScalerAfterTraining(meta: RunMeta) {
  const f = meta.config.fraction;
  const cacheName =
    typeof f === "number" ? `${meta.dataset.pyName}_${String(f).replace(".", "_")}` : meta.dataset.pyName;
  const src = path.join(DATA_DIR, "pyg_graph_data", cacheName, "scaler.pkl");
  if (fs.existsSync(src)) fs.copyFileSync(src, scalerPath(meta.id));
}

function finalize(meta: RunMeta) {
  parseNewLog(meta, true);
  const exited = meta.exitCode !== undefined && meta.exitCode !== null;
  const metricsOk = meta.metrics?.f1 !== undefined;
  const scoreOk = meta.target === "upload" && fs.existsSync(resultPath(meta.id));
  // exitCode is unknown if the server restarted while Python was running; the
  // presence of the final results then decides.
  const ok = (exited ? meta.exitCode === 0 : true) && (scoreOk || (meta.target !== "upload" && metricsOk));

  if (ok) {
    meta.status = "completed";
    meta.phase = "Done";
    meta.progress.pct = 100;
    if (meta.mode === "train") {
      meta.hasCheckpoint = fs.existsSync(ckptPath(meta.id));
      try {
        copyScalerAfterTraining(meta);
      } catch {
        /* the scaler is only needed for uploaded-data testing */
      }
    }
    meta.hasResult = scoreOk;
    if (scoreOk) {
      try {
        const r = JSON.parse(fs.readFileSync(resultPath(meta.id), "utf8"));
        meta.metrics = {
          f1: r.metrics?.f1 ?? undefined,
          prAuc: r.metrics?.prAuc ?? undefined,
          benign: r.predictedBenign,
          malicious: r.predictedMalicious,
          predictionSeconds: r.seconds,
        };
      } catch {
        /* the full result is still served from result.json */
      }
    }
  } else {
    meta.status = "failed";
    meta.phase = "Failed";
    meta.error = lastErrorLine(meta.id) ?? `Python exited with code ${meta.exitCode ?? "unknown"}`;
  }
  meta.finishedAt = new Date().toISOString();
}

export function refreshRun(id: string): RunMeta | null {
  const meta = readMeta(id);
  if (!meta) return null;
  if (meta.status !== "running") return meta;
  parseNewLog(meta, false);
  if (!pidAlive(meta.pid)) finalize(meta);
  writeMeta(meta);
  return meta;
}

export function listRuns(): RunMeta[] {
  let ids: string[] = [];
  try {
    ids = fs.readdirSync(RUNS_DIR).filter(isRunId);
  } catch {
    return [];
  }
  return ids
    .map((id) => refreshRun(id))
    .filter((m): m is RunMeta => m !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function activeRun(): RunMeta | null {
  return listRuns().find((r) => r.status === "running") ?? null;
}

export function getRunDetail(id: string) {
  const meta = refreshRun(id);
  if (!meta) return null;
  let result: unknown = undefined;
  if (meta.hasResult) {
    try {
      result = JSON.parse(fs.readFileSync(resultPath(id), "utf8"));
    } catch {
      /* ignore */
    }
  }
  return { ...meta, logTail: readLogTail(id), result };
}

export function cancelRun(id: string): RunMeta | null {
  const meta = refreshRun(id);
  if (!meta || meta.status !== "running") return meta;
  if (meta.pid) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(meta.pid), "/T", "/F"], { windowsHide: true });
    } else {
      try {
        process.kill(-meta.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
  }
  const cur = readMeta(id) ?? meta;
  cur.status = "cancelled";
  cur.phase = "Cancelled";
  cur.finishedAt = new Date().toISOString();
  writeMeta(cur);
  return cur;
}

export function deleteRun(id: string): boolean {
  if (!isRunId(id) || !readMeta(id)) return false;
  cancelRun(id);
  fs.rmSync(runDir(id), { recursive: true, force: true });
  return true;
}

// ---------- starting runs ----------
export class RunError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

function newId(mode: RunMode) {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `${mode}-${stamp}-${crypto.randomBytes(2).toString("hex")}`;
}

function assertReady() {
  if (!fs.existsSync(GRAPHIDS_PYTHON))
    throw new RunError(`Python not found at ${GRAPHIDS_PYTHON}. Set GRAPHIDS_PYTHON.`, 500);
  if (!fs.existsSync(path.join(GRAPHIDS_ROOT, "main.py")))
    throw new RunError(`GraphIDS not found at ${GRAPHIDS_ROOT}. Set GRAPHIDS_ROOT.`, 500);
  const busy = activeRun();
  if (busy)
    throw new RunError(`Another run is in progress (${busy.id}). Wait for it or cancel it first.`, 409);
}

function launch(meta: RunMeta, args: string[]) {
  const fd = fs.openSync(logPath(meta.id), "a");
  const child = spawn(GRAPHIDS_PYTHON, args, {
    cwd: GRAPHIDS_ROOT,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      PYTHONIOENCODING: "utf-8",
      WANDB_MODE: "offline",
      WANDB_SILENT: "true",
    },
    stdio: ["ignore", fd, fd],
    detached: true,
    windowsHide: true,
  });
  fs.closeSync(fd);
  meta.pid = child.pid;
  meta.startedAt = new Date().toISOString();
  writeMeta(meta);

  child.on("error", (err) => {
    const m = readMeta(meta.id);
    if (!m || m.status !== "running") return;
    m.status = "failed";
    m.phase = "Failed";
    m.error = `Could not start Python: ${err.message}`;
    m.finishedAt = new Date().toISOString();
    writeMeta(m);
  });
  child.on("exit", (code) => {
    const m = readMeta(meta.id);
    if (!m || m.status !== "running") return;
    m.exitCode = code;
    writeMeta(m);
    refreshRun(meta.id);
  });
  child.unref();
}

function baseMeta(
  id: string,
  mode: RunMode,
  ds: DatasetInfo,
  config: Config,
  seed: number
): RunMeta {
  const numLayers = typeof config.num_layers === "number" ? config.num_layers : 1;
  const numHops = typeof config.num_hops === "number" ? config.num_hops : 1;
  const hopMode = config.hop_mode === "node" ? "node" : "edge";
  return {
    id,
    mode,
    status: "running",
    dataset: {
      id: ds.id,
      pyName: ds.pyName,
      label: ds.label,
      source: ds.source,
      version: ds.version,
    },
    modelType: numHops > 1 ? "HO-GraphIDS" : "GraphIDS",
    numLayers,
    numHops,
    hopMode,
    seed,
    config,
    createdAt: new Date().toISOString(),
    phase: "Starting",
    progress: {
      epoch: 0,
      epochs: typeof config.num_epochs === "number" ? config.num_epochs : 0,
      pct: 0,
    },
    history: [],
    logOffset: 0,
  };
}

export type TrainInput = {
  dataset: string;
  numHops?: number;
  hopMode?: string;
  overrides?: Record<string, unknown>;
  seed?: number;
};

export async function startTrain(input: TrainInput): Promise<RunMeta> {
  const ds = findDataset(input.dataset);
  if (!ds) throw new RunError("Unknown dataset");
  if (!ds.enabled) throw new RunError(ds.reason ?? "This dataset is not available for training");
  const csv = csvFor(ds.pyName);
  if (!fs.existsSync(csv)) throw new RunError(`CSV not found: ${csv}`);
  assertReady();

  const seed = Number.isInteger(input.seed) ? (input.seed as number) : 24;
  const overrides = { ...(input.overrides ?? {}) };
  if (input.numHops !== undefined) overrides.num_hops = input.numHops;
  if (input.hopMode !== undefined) overrides.hop_mode = input.hopMode;
  const { config, error } = applyOverrides(baseConfigFor(ds.pyName, ds.version), overrides);
  if (error) throw new RunError(error);

  const header = await readCsvHeader(csv);
  if (!header.includes("Label") || !header.includes("Attack"))
    throw new RunError("Training needs Label and Attack columns in the CSV");

  const id = newId("train");
  fs.mkdirSync(runDir(id), { recursive: true });
  fs.writeFileSync(configPath(id), serializeConfig(config));
  const meta = baseMeta(id, "train", ds, config, seed);
  meta.featureColumns = edgeFeatureColumns(header, ds.pyName);
  writeMeta(meta);

  launch(meta, [
    "main.py",
    "--data_dir",
    DATA_DIR,
    "--config",
    configPath(id),
    "--checkpoint",
    ckptPath(id),
    "--seed",
    String(seed),
  ]);
  return readMeta(id)!;
}

export type TestInput = {
  modelRunId: string;
  target: "builtin" | "upload";
  uploadName?: string;
};

export async function startTest(input: TestInput): Promise<RunMeta> {
  const model = refreshRun(input.modelRunId);
  if (!model || model.mode !== "train" || model.status !== "completed" || !model.hasCheckpoint)
    throw new RunError("Pick a finished training run that has a saved model");
  const ds = findDataset(model.dataset.id);
  if (!ds) throw new RunError("The dataset this model was trained on no longer exists");
  assertReady();

  const id = newId("test");
  const config = model.config;

  if (input.target === "builtin") {
    if (!fs.existsSync(csvFor(ds.pyName))) throw new RunError(`CSV not found: ${csvFor(ds.pyName)}`);
    fs.mkdirSync(runDir(id), { recursive: true });
    fs.copyFileSync(configPath(model.id), configPath(id));
    const meta = baseMeta(id, "test", ds, config, model.seed);
    meta.modelRunId = model.id;
    meta.target = "builtin";
    meta.phase = "Loading checkpoint";
    writeMeta(meta);
    launch(meta, [
      "main.py",
      "--data_dir",
      DATA_DIR,
      "--config",
      configPath(id),
      "--checkpoint",
      ckptPath(model.id),
      "--test",
      "--seed",
      String(model.seed),
    ]);
    return readMeta(id)!;
  }

  // Uploaded CSV, scored by backend/score_flows.py
  const up = input.uploadName ? getUpload(input.uploadName) : null;
  if (!up) throw new RunError("Unknown upload");
  if (!fs.existsSync(scalerPath(model.id)))
    throw new RunError("This model has no saved scaler, so it cannot score new data. Retrain it.");
  const header = await readCsvHeader(csvFor(up.name));
  const check = checkSchemaMatch(header, model.featureColumns ?? []);
  if (!check.ok)
    throw new RunError(
      `This CSV does not match the model's columns. Missing: ${check.missing.slice(0, 6).join(", ")}${check.missing.length > 6 ? ", …" : ""}`
    );

  fs.mkdirSync(runDir(id), { recursive: true });
  fs.copyFileSync(configPath(model.id), configPath(id));
  const meta = baseMeta(id, "test", ds, config, model.seed);
  meta.modelRunId = model.id;
  meta.target = "upload";
  meta.uploadName = up.name;
  meta.phase = "Starting";
  writeMeta(meta);
  launch(meta, [
    path.join(BACKEND_DIR, "score_flows.py"),
    "--root",
    GRAPHIDS_ROOT,
    "--checkpoint",
    ckptPath(model.id),
    "--config",
    configPath(id),
    "--scaler",
    scalerPath(model.id),
    "--csv",
    csvFor(up.name),
    "--out",
    resultPath(id),
    "--top",
    "50",
  ]);
  return readMeta(id)!;
}

export function listModels() {
  return listRuns()
    .filter((r) => r.mode === "train" && r.status === "completed" && r.hasCheckpoint)
    .map((r) => ({
      id: r.id,
      dataset: r.dataset,
      modelType: r.modelType,
      numLayers: r.numLayers,
      numHops: r.numHops,
      hopMode: r.hopMode,
      seed: r.seed,
      metrics: r.metrics,
      canScoreUploads: fs.existsSync(scalerPath(r.id)),
      createdAt: r.createdAt,
      finishedAt: r.finishedAt,
    }));
}
