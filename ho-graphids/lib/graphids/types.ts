// Client-safe types for what the /api/runs, /api/models and /api/datasets routes return.
import type { DatasetInfo } from "./config";
import type { RunMeta } from "./runs";

export type { DatasetInfo, RunMeta };

export type ScoreResult = {
  flows: number;
  scoredFlows: number;
  threshold: number | null;
  predictedBenign: number;
  predictedMalicious: number;
  labeled: boolean;
  errorStats: {
    min: number | null;
    median: number | null;
    mean: number | null;
    p99: number | null;
    max: number | null;
  };
  seconds: number;
  metrics?: {
    tp: number;
    fp: number;
    tn: number;
    fn: number;
    f1: number | null;
    prAuc: number | null;
  };
  top: Record<string, string | number | boolean | null>[];
  topHosts: { ip: string; flaggedFlows: number }[];
};

export type RunDetail = RunMeta & { logTail: string[]; result?: ScoreResult };

export type ModelInfo = {
  id: string;
  dataset: RunMeta["dataset"];
  modelType: RunMeta["modelType"];
  numLayers: number;
  numHops: number;
  hopMode: "edge" | "node";
  seed: number;
  metrics?: RunMeta["metrics"];
  canScoreUploads: boolean;
  createdAt: string;
  finishedAt?: string;
};
