import fs from "node:fs";
import path from "node:path";
import { GRAPHIDS_ROOT } from "./config";

// The GraphIDS configs are a flat "key:\n  value: X" format (wandb style), so a
// tiny parser is enough and avoids adding a YAML dependency.
export type ConfigValue = number | string | null;
export type Config = Record<string, ConfigValue>;

function parseValue(raw: string): ConfigValue {
  const v = raw.trim();
  if (v === "null" || v === "~" || v === "") return null;
  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(v)) return Number(v);
  return v.replace(/^["']|["']$/g, "");
}

export function parseConfig(text: string): Config {
  const cfg: Config = {};
  const re = /^([A-Za-z_]\w*):[ \t]*\r?\n[ \t]+value:[ \t]*(.*?)[ \t]*\r?$/gm;
  for (const m of text.matchAll(re)) cfg[m[1]] = parseValue(m[2]);
  return cfg;
}

function formatValue(v: ConfigValue): string {
  if (v === null) return "null";
  if (typeof v === "string") return v;
  if (Number.isInteger(v)) return String(v);
  const s = String(v);
  // PyYAML only reads floats with a dot, e.g. 1.0e-07, not 1e-07.
  const m = s.match(/^(-?\d+)(e[-+]?\d+)$/i);
  return m ? `${m[1]}.0${m[2]}` : s;
}

export function serializeConfig(cfg: Config): string {
  return (
    Object.entries(cfg)
      .map(([k, v]) => `${k}:\n  value: ${formatValue(v)}\n`)
      .join("") || ""
  );
}

// Tuned defaults for a built-in dataset (e.g. "NF-UNSW-NB15-v2"). Uploads use
// the UNSW config of the same schema version as their template.
export function baseConfigFor(pyName: string, version: "v2" | "v3"): Config {
  const own = path.join(GRAPHIDS_ROOT, "configs", `${pyName}.yaml`);
  const fallback = path.join(GRAPHIDS_ROOT, "configs", `NF-UNSW-NB15-${version}.yaml`);
  const file = fs.existsSync(own) ? own : fallback;
  const cfg = parseConfig(fs.readFileSync(file, "utf8"));
  cfg.dataset = pyName;
  // The tuned YAMLs predate multi-hop; these are the GraphIDS defaults.
  cfg.num_hops ??= 1;
  cfg.hop_mode ??= "edge";
  return cfg;
}

// Settings the UI is allowed to change, with their limits. Anything else is
// ignored so a request cannot inject arbitrary config.
type Rule = { type: "int" | "float" | "choice"; min?: number; max?: number; choices?: string[] };
export const OVERRIDABLE: Record<string, Rule> = {
  num_epochs: { type: "int", min: 1, max: 1000 },
  learning_rate: { type: "float", min: 1e-8, max: 1 },
  weight_decay: { type: "float", min: 0, max: 10 },
  ae_weight_decay: { type: "float", min: 0, max: 10 },
  edim_out: { type: "int", min: 4, max: 512 },
  batch_size: { type: "int", min: 64, max: 1_000_000 },
  fanout: { type: "int", min: -1, max: 1_000_000 },
  num_layers: { type: "int", min: 1, max: 8 }, // Transformer depth
  num_hops: { type: "int", min: 1, max: 6 }, // SAGELayer hops (HO-GraphIDS when > 1)
  hop_mode: { type: "choice", choices: ["edge", "node"] },
  mask_ratio: { type: "float", min: 0, max: 1 },
  patience: { type: "int", min: 1, max: 1000 },
  ae_batch_size: { type: "int", min: 1, max: 4096 },
  window_size: { type: "int", min: 2, max: 4096 },
  step_percent: { type: "float", min: 0.01, max: 1 },
  ae_embedding_dim: { type: "int", min: 4, max: 512 },
  ae_dropout: { type: "float", min: 0, max: 0.95 },
  dropout: { type: "float", min: 0, max: 0.95 },
  fraction: { type: "float", min: 0.001, max: 0.999 },
  positional_encoding: { type: "choice", choices: ["None", "learnable", "sinusoidal"] },
};

export function applyOverrides(
  base: Config,
  overrides: Record<string, unknown> | undefined
): { config: Config; error?: string } {
  const config = { ...base };
  for (const [key, raw] of Object.entries(overrides ?? {})) {
    const rule = OVERRIDABLE[key];
    if (!rule) continue;
    if (raw === null || raw === "" || raw === undefined) {
      if (key === "fraction") config[key] = null; // fraction=null means "use all rows"
      continue;
    }
    if (rule.type === "choice") {
      if (typeof raw !== "string" || !rule.choices!.includes(raw))
        return { config, error: `${key} must be one of ${rule.choices!.join(", ")}` };
      config[key] = raw;
      continue;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || (rule.type === "int" && !Number.isInteger(n)))
      return { config, error: `${key} must be a ${rule.type === "int" ? "whole " : ""}number` };
    if ((rule.min !== undefined && n < rule.min) || (rule.max !== undefined && n > rule.max))
      return { config, error: `${key} must be between ${rule.min} and ${rule.max}` };
    config[key] = n;
  }
  return { config };
}
