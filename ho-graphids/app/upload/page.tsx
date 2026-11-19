"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  HardDrive,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DatasetInfo } from "@/lib/graphids/types";

// What the server needs to build the host graph and run the model.
const REQUIRED_COLUMNS = ["IPV4_SRC_ADDR", "IPV4_DST_ADDR"];
// Needed only to train, or to measure accuracy when testing.
const LABEL_COLUMNS = ["Label", "Attack"];

type Validation = {
  columns: string[];
  missingRequired: string[];
  missingLabels: string[];
};

// Basic facts about a built-in dataset, from the explorer's cached summary.
type Summary = { flows: number; attackTypes: number };

const DESCRIPTIONS: Record<string, string> = {
  "nf-unsw-nb15-v2": "NetFlow v2 version of UNSW-NB15 with 9 attack families.",
  "nf-unsw-nb15-v3": "NetFlow v3 version of UNSW-NB15, with flow timestamps.",
  "nf-cse-cic-ids2018-v2": "NetFlow v2 version of CSE-CIC-IDS2018.",
  "nf-cse-cic-ids2018-v3": "NetFlow v3 version of CSE-CIC-IDS2018, with flow timestamps.",
};

const fmt = (n: number) => n.toLocaleString("en-US");
const fmtBytes = (b: number) =>
  b >= 1024 ** 3
    ? `${(b / 1024 ** 3).toFixed(2)} GB`
    : `${(b / 1024 ** 2).toFixed(1)} MB`;

// Reads only the first 64 KB of the file to check the header row.
async function validateCsv(file: File): Promise<Validation> {
  const text = (await file.slice(0, 64 * 1024).text()).replace(/^﻿/, "");
  const header = text.split(/\r?\n/)[0] ?? "";
  const columns = header.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  return {
    columns,
    missingRequired: REQUIRED_COLUMNS.filter((c) => !columns.includes(c)),
    missingLabels: LABEL_COLUMNS.filter((c) => !columns.includes(c)),
  };
}

// Sends the raw file as the request body (no multipart), so the server can stream
// it to disk. XMLHttpRequest is used because fetch cannot report upload progress.
function uploadToServer(
  file: File,
  name: string,
  onProgress: (pct: number) => void
): Promise<DatasetInfo> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/uploads?name=${encodeURIComponent(name)}`);
    xhr.setRequestHeader("content-type", "text/csv");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress((e.loaded / e.total) * 100);
    };
    xhr.onload = () => {
      let body: { upload?: DatasetInfo; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.upload) resolve(body.upload);
      else reject(new Error(body.error ?? `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(file);
  });
}

export default function UploadPage() {
  const inputRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState("select");
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [summaries, setSummaries] = useState<Record<string, Summary>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [datasetName, setDatasetName] = useState("");
  const [validation, setValidation] = useState<Validation | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const builtIn = datasets.filter((d) => d.source === "builtin");
  const uploaded = datasets.filter((d) => d.source === "upload");
  const selected = datasets.find((d) => d.id === selectedId) ?? null;

  const refresh = useCallback(async () => {
    const r = await fetch("/api/datasets");
    const b = await r.json();
    setDatasets(b.datasets as DatasetInfo[]);
  }, []);

  useEffect(() => {
    fetch("/api/datasets")
      .then((r) => r.json())
      .then((b) => setDatasets(b.datasets as DatasetInfo[]))
      .catch(() => {});
  }, []);

  // Flow and attack-type counts come from the explorer's cached summaries, so this
  // is instant for datasets that were scanned before.
  useEffect(() => {
    for (const d of builtIn) {
      if (summaries[d.id]) continue;
      fetch(`/api/datasets/${d.id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((s) => {
          if (!s) return;
          setSummaries((prev) => ({
            ...prev,
            [d.id]: {
              flows: s.total,
              attackTypes: s.classes.filter((c: { name: string }) => c.name !== "Benign").length,
            },
          }));
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasets]);

  async function handleFile(f: File | undefined | null) {
    if (!f) return;
    setError(null);
    setValidation(null);
    setProgress(0);
    if (!f.name.toLowerCase().endsWith(".csv")) {
      setFile(null);
      setError("Only .csv files are supported for now.");
      return;
    }
    setFile(f);
    setDatasetName(f.name.replace(/\.csv$/i, ""));
    try {
      setValidation(await validateCsv(f));
    } catch {
      setError("Could not read the file. Try selecting it again.");
    }
  }

  function clearFile() {
    setFile(null);
    setValidation(null);
    setProgress(0);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleUpload() {
    if (!file || !validation || validation.missingRequired.length > 0) return;
    setUploading(true);
    setError(null);
    try {
      const created = await uploadToServer(file, `${datasetName.trim() || file.name}.csv`, setProgress);
      await refresh();
      setSelectedId(created.id);
      clearFile();
      setTab("select");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function removeUpload(id: string) {
    await fetch(`/api/uploads?name=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (selectedId === id) setSelectedId(null);
    await refresh();
  }

  const canUpload =
    !!file &&
    !!validation &&
    validation.missingRequired.length === 0 &&
    datasetName.trim().length > 0 &&
    !uploading;

  return (
    <div className="min-h-screen w-full bg-zinc-50 font-sans dark:bg-black">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Data</h1>
          <p className="text-sm text-muted-foreground">
            Pick a ready-made NetFlow dataset or upload your own CSV.
          </p>
        </div>

        <Tabs value={tab} onValueChange={setTab} className="gap-4">
          <TabsList>
            <TabsTrigger value="select">
              <Database className="size-4" /> Select dataset
            </TabsTrigger>
            <TabsTrigger value="upload">
              <Upload className="size-4" /> Upload new
            </TabsTrigger>
          </TabsList>

          {/* ---------------- SELECT TAB ---------------- */}
          <TabsContent value="select" className="flex flex-col gap-6">
            <div>
              <h2 className="mb-3 text-sm font-medium text-muted-foreground">
                Built-in datasets
              </h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {builtIn.map((d) => (
                  <DatasetCard
                    key={d.id}
                    dataset={d}
                    summary={summaries[d.id]}
                    selected={d.id === selectedId}
                    onSelect={() => setSelectedId(d.id)}
                  />
                ))}
              </div>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Your uploaded datasets</CardTitle>
                <CardDescription>
                  Files you have uploaded to this workspace. They are stored in the
                  project&apos;s data folder.
                </CardDescription>
                <CardAction>
                  <Button variant="outline" size="sm" onClick={() => setTab("upload")}>
                    <Upload /> Upload new
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                {uploaded.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    Nothing uploaded yet.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Columns</TableHead>
                        <TableHead>Labels</TableHead>
                        <TableHead className="text-right">Size</TableHead>
                        <TableHead className="text-right" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {uploaded.map((d) => (
                        <TableRow key={d.id}>
                          <TableCell className="font-medium">{d.label}</TableCell>
                          <TableCell>{d.version}</TableCell>
                          <TableCell>
                            {d.labeled ? (
                              <Badge variant="secondary">Labeled</Badge>
                            ) : (
                              <Badge variant="outline">Unlabeled</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {d.sizeBytes ? fmtBytes(d.sizeBytes) : "–"}
                          </TableCell>
                          <TableCell className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant={d.id === selectedId ? "default" : "outline"}
                              onClick={() => setSelectedId(d.id)}
                            >
                              {d.id === selectedId ? "Selected" : "Select"}
                            </Button>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Delete ${d.label}`}
                              onClick={() => removeUpload(d.id)}
                            >
                              <Trash2 />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Selection summary */}
            <Card>
              <CardHeader>
                <CardTitle>Selected dataset</CardTitle>
                <CardDescription>
                  {selected
                    ? selected.enabled
                      ? `${selected.label} is ready to use.`
                      : (selected.reason ?? "This dataset cannot be trained on.")
                    : "No dataset selected yet."}
                </CardDescription>
              </CardHeader>
              <CardFooter className="flex flex-wrap gap-2">
                <Button
                  nativeButton={false}
                  disabled={!selected || !selected.enabled}
                  render={<Link href={selected ? `/training?dataset=${selected.id}` : "#"} />}
                >
                  Continue to training <ArrowRight />
                </Button>
                {selected?.source === "upload" && (
                  <Button
                    variant="outline"
                    nativeButton={false}
                    render={<Link href="/testing" />}
                  >
                    Test with a trained model
                  </Button>
                )}
                {selected?.source === "builtin" && (
                  <Button
                    variant="outline"
                    nativeButton={false}
                    render={<Link href={`/explorer?dataset=${selected.id}`} />}
                  >
                    Explore data
                  </Button>
                )}
              </CardFooter>
            </Card>
          </TabsContent>

          {/* ---------------- UPLOAD TAB ---------------- */}
          <TabsContent value="upload">
            <Card>
              <CardHeader>
                <CardTitle>Upload a local dataset</CardTitle>
                <CardDescription>
                  CSV file of NetFlow records in the NF-UNSW-NB15 v2 or v3 column format.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                {/* Drop zone */}
                {!file && (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => inputRef.current?.click()}
                    onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragging(false);
                      handleFile(e.dataTransfer.files?.[0]);
                    }}
                    className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
                      dragging ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <Upload className="size-8 text-muted-foreground" />
                    <p className="text-sm font-medium">
                      Drag and drop a CSV file here, or click to browse
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Only .csv files. The header row is checked before upload.
                    </p>
                  </div>
                )}
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => handleFile(e.target.files?.[0])}
                />

                {error && (
                  <Alert variant="destructive">
                    <AlertCircle className="size-4" />
                    <AlertTitle>Problem with the file</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                {/* Selected file */}
                {file && (
                  <div className="flex flex-col gap-5">
                    <div className="flex items-center gap-3 rounded-lg border p-3">
                      <FileSpreadsheet className="size-8 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{file.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {fmtBytes(file.size)}
                          {validation && ` · ${validation.columns.length} columns detected`}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={clearFile}
                        disabled={uploading}
                        aria-label="Remove file"
                      >
                        <X />
                      </Button>
                    </div>

                    {validation && validation.missingRequired.length > 0 && (
                      <Alert variant="destructive">
                        <AlertCircle className="size-4" />
                        <AlertTitle>Missing required columns</AlertTitle>
                        <AlertDescription>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {validation.missingRequired.map((c) => (
                              <Badge key={c} variant="destructive">
                                {c}
                              </Badge>
                            ))}
                          </div>
                        </AlertDescription>
                      </Alert>
                    )}

                    {validation && validation.missingRequired.length === 0 && (
                      <Alert>
                        <CheckCircle2 className="size-4" />
                        <AlertTitle>Format looks good</AlertTitle>
                        <AlertDescription>
                          The IP address columns are present.
                          {validation.missingLabels.length > 0
                            ? ` No ${validation.missingLabels.join(" / ")} column found, so this file can be used for testing a trained model but not for training. Its columns must match the model's dataset (checked when you start a test).`
                            : " Labeled files can be used for training, and testing reports accuracy against the labels."}
                        </AlertDescription>
                      </Alert>
                    )}

                    <div className="grid max-w-md gap-2">
                      <Label htmlFor="dataset-name">Dataset name</Label>
                      <Input
                        id="dataset-name"
                        value={datasetName}
                        onChange={(e) => setDatasetName(e.target.value)}
                        disabled={uploading}
                        placeholder="e.g. UM campus Nov 2026"
                      />
                    </div>

                    {uploading && (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex justify-between text-sm">
                          <span>{progress >= 100 ? "Checking the file…" : "Uploading…"}</span>
                          <span className="tabular-nums">{Math.round(progress)}%</span>
                        </div>
                        <Progress value={progress} />
                      </div>
                    )}
                  </div>
                )}

                {/* Expected columns reference */}
                <div className="rounded-lg bg-muted/50 p-4">
                  <p className="mb-2 text-sm font-medium">Required columns</p>
                  <div className="flex flex-wrap gap-1">
                    {REQUIRED_COLUMNS.map((c) => (
                      <Badge key={c} variant="secondary" className="font-mono">
                        {c}
                      </Badge>
                    ))}
                  </div>
                  <p className="mb-2 mt-3 text-sm font-medium">
                    Needed for training, and for accuracy figures when testing
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {LABEL_COLUMNS.map((c) => (
                      <Badge key={c} variant="outline" className="font-mono">
                        {c}
                      </Badge>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Files that contain <code>FLOW_START_MILLISECONDS</code> are treated as the
                    v3 format, the others as v2. A model can only score files that have all
                    the feature columns it was trained on.
                  </p>
                </div>
              </CardContent>
              <CardFooter className="gap-2">
                <Button onClick={handleUpload} disabled={!canUpload}>
                  <Upload /> {uploading ? "Uploading…" : "Upload dataset"}
                </Button>
                <Button variant="outline" onClick={() => setTab("select")} disabled={uploading}>
                  Cancel
                </Button>
              </CardFooter>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ---------- Dataset card ----------
function DatasetCard({
  dataset,
  summary,
  selected,
  onSelect,
}: {
  dataset: DatasetInfo;
  summary?: Summary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Card className={`transition-colors ${selected ? "border-primary ring-1 ring-primary" : ""}`}>
      <CardHeader>
        <CardTitle>{dataset.label}</CardTitle>
        <CardDescription>{DESCRIPTIONS[dataset.id] ?? ""}</CardDescription>
        <CardAction>
          {selected ? (
            <Badge>
              <CheckCircle2 className="size-3" /> Selected
            </Badge>
          ) : (
            <HardDrive className="size-4 text-muted-foreground" />
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Flows</p>
            <p className="font-medium tabular-nums">{summary ? fmt(summary.flows) : "–"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Size</p>
            <p className="font-medium tabular-nums">
              {dataset.sizeBytes ? fmtBytes(dataset.sizeBytes) : "Not on disk"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Attack types</p>
            <p className="font-medium tabular-nums">{summary ? summary.attackTypes : "–"}</p>
          </div>
        </div>
        {!dataset.enabled && dataset.reason && (
          <p className="text-xs text-muted-foreground">Training unavailable: {dataset.reason}</p>
        )}
      </CardContent>
      <CardFooter>
        <Button
          variant={selected ? "default" : "outline"}
          size="sm"
          className="w-full"
          onClick={onSelect}
        >
          {selected ? "Selected" : "Use this dataset"}
        </Button>
      </CardFooter>
    </Card>
  );
}
