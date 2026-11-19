import fs from "node:fs";

// Same rule as GraphIDS utils/dataloaders.py (_process): every column except
// the IP addresses (and, for v3, the two timestamps) is an edge feature.
export function edgeFeatureColumns(header: string[], datasetName: string): string[] {
  const drop = new Set(["IPV4_SRC_ADDR", "IPV4_DST_ADDR", "Attack", "Label"]);
  if (datasetName.includes("v3")) {
    drop.add("FLOW_END_MILLISECONDS");
    drop.add("FLOW_START_MILLISECONDS");
  }
  return header.filter((c) => !drop.has(c));
}

// Reads only the first line of a (possibly huge) CSV.
export async function readCsvHeader(file: string): Promise<string[]> {
  const fh = await fs.promises.open(file, "r");
  try {
    const buf = Buffer.alloc(64 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const text = buf.toString("utf8", 0, bytesRead).replace(/^﻿/, "");
    const line = text.split(/\r?\n/, 1)[0];
    return line.split(",").map((c) => c.trim());
  } finally {
    await fh.close();
  }
}

export function checkSchemaMatch(
  uploadHeader: string[],
  modelFeatures: string[]
): { ok: boolean; missing: string[] } {
  const have = new Set(uploadHeader);
  const missing = modelFeatures.filter((c) => !have.has(c));
  return { ok: missing.length === 0 && have.has("IPV4_SRC_ADDR") && have.has("IPV4_DST_ADDR"), missing };
}
