import fs from "node:fs";
import path from "node:path";

// The GraphIDS / HO-GraphIDS Python project lives inside this repository, in
// backend/graphids (model, training code, configs, tests). Set GRAPHIDS_ROOT only to
// run a different copy.
export const GRAPHIDS_ROOT =
  process.env.GRAPHIDS_ROOT ?? path.join(process.cwd(), "backend", "graphids");

// The Python interpreter is NOT stored in git. By default the UI looks for a
// virtualenv created inside the project (uv sync in backend/graphids). On a
// machine where the environment is elsewhere, set GRAPHIDS_PYTHON in .env.local.
export const GRAPHIDS_PYTHON =
  process.env.GRAPHIDS_PYTHON ??
  (process.platform === "win32"
    ? path.join(GRAPHIDS_ROOT, ".venv", "Scripts", "python.exe")
    : path.join(GRAPHIDS_ROOT, ".venv", "bin", "python"));

// main.py expects <data_dir>/<name>/<name>.csv. We point it at this project's
// own data folder, so the CSVs are not duplicated.
export const DATA_DIR =
  process.env.GRAPHIDS_DATA_DIR ?? path.join(process.cwd(), "data");

export const RUNS_DIR = path.join(process.cwd(), "runs");
export const BACKEND_DIR = path.join(process.cwd(), "backend");

export type DatasetInfo = {
  id: string; // what the UI and API use
  pyName: string; // what the Python code calls it (folder + csv name)
  label: string;
  source: "builtin" | "upload";
  enabled: boolean;
  reason?: string; // why it is disabled
  version: "v2" | "v3";
  sizeBytes?: number;
  labeled?: boolean;
};

const CSE_REASON =
  "The Python loader reads the whole CSV into RAM, and this machine has about 7 GB. Run the UNSW datasets first.";

export const BUILT_IN: DatasetInfo[] = [
  {
    id: "nf-unsw-nb15-v2",
    pyName: "NF-UNSW-NB15-v2",
    label: "NF-UNSW-NB15-v2",
    source: "builtin",
    enabled: true,
    version: "v2",
  },
  {
    id: "nf-unsw-nb15-v3",
    pyName: "NF-UNSW-NB15-v3",
    label: "NF-UNSW-NB15-v3",
    source: "builtin",
    enabled: true,
    version: "v3",
  },
  {
    id: "nf-cse-cic-ids2018-v2",
    pyName: "NF-CSE-CIC-IDS2018-v2",
    label: "NF-CSE-CIC-IDS2018-v2",
    source: "builtin",
    enabled: false,
    reason: CSE_REASON,
    version: "v2",
  },
  {
    id: "nf-cse-cic-ids2018-v3",
    pyName: "NF-CSE-CIC-IDS2018-v3",
    label: "NF-CSE-CIC-IDS2018-v3",
    source: "builtin",
    enabled: false,
    reason:
      CSE_REASON +
      " Also, the file is named NF-CICIDS2018-v3.csv but the Python loader expects NF-CSE-CIC-IDS2018-v3.csv.",
    version: "v3",
  },
];

export function csvFor(pyName: string) {
  return path.join(DATA_DIR, pyName, `${pyName}.csv`);
}

// ---------- Uploaded datasets: data/UPLOAD-<slug>-<v2|v3>/ ----------
export const UPLOAD_PREFIX = "UPLOAD-";
export const UPLOAD_META = ".upload.json";

export type UploadMeta = {
  name: string; // folder / python dataset name
  originalName: string;
  sizeBytes: number;
  version: "v2" | "v3";
  labeled: boolean; // has Label and Attack columns
  columns: string[];
  createdAt: string;
};

export function listUploads(): UploadMeta[] {
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(DATA_DIR);
  } catch {
    return [];
  }
  const out: UploadMeta[] = [];
  for (const dir of entries) {
    if (!dir.startsWith(UPLOAD_PREFIX)) continue;
    try {
      const m = JSON.parse(
        fs.readFileSync(path.join(DATA_DIR, dir, UPLOAD_META), "utf8")
      ) as UploadMeta;
      if (fs.existsSync(csvFor(m.name))) out.push(m);
    } catch {
      // not a finished upload
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getUpload(name: string): UploadMeta | null {
  if (!name.startsWith(UPLOAD_PREFIX) || /[\\/]/.test(name)) return null;
  return listUploads().find((u) => u.name === name) ?? null;
}

export function uploadToDataset(u: UploadMeta): DatasetInfo {
  return {
    id: u.name,
    pyName: u.name,
    label: u.originalName,
    source: "upload",
    enabled: u.labeled,
    reason: u.labeled
      ? undefined
      : "Training needs Label and Attack columns. This upload can still be used for testing.",
    version: u.version,
    sizeBytes: u.sizeBytes,
    labeled: u.labeled,
  };
}

// Built-in datasets (with size info when the CSV exists) followed by uploads.
export function listDatasets(): DatasetInfo[] {
  const builtIn = BUILT_IN.map((d) => {
    try {
      return { ...d, sizeBytes: fs.statSync(csvFor(d.pyName)).size };
    } catch {
      return d;
    }
  });
  return [...builtIn, ...listUploads().map(uploadToDataset)];
}

export function findDataset(id: string): DatasetInfo | null {
  const b = BUILT_IN.find((d) => d.id === id);
  if (b) return b;
  const u = getUpload(id);
  return u ? uploadToDataset(u) : null;
}
