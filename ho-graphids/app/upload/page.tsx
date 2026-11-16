"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  HardDrive,
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

// ---------- Types & mock data (replace with API calls) ----------
type Dataset = {
  id: string;
  name: string;
  description: string;
  flows: number;
  sizeMB: number;
  attackTypes: number;
  source: "built-in" | "uploaded";
  uploadedAt?: string;
};

// TODO: swap these for the 4 datasets you actually have (GET /api/datasets)
const BUILT_IN: Dataset[] = [
  {
    id: "nf-unsw-nb15-v2",
    name: "NF-UNSW-NB15-v2",
    description: "NetFlow v2 version of UNSW-NB15 with 9 attack families.",
    flows: 2_390_275,
    sizeMB: 420,
    attackTypes: 9,
    source: "built-in",
  },
  {
    id: "nf-cse-cic-ids2018-v2",
    name: "NF-CSE-CIC-IDS2018-v2",
    description: "NetFlow v2 version of CSE-CIC-IDS2018 with 14 attack types.",
    flows: 18_893_708,
    sizeMB: 3100,
    attackTypes: 14,
    source: "built-in",
  },
  {
    id: "nf-ton-iot-v2",
    name: "NF-ToN-IoT-v2",
    description: "NetFlow v2 version of ToN-IoT, IoT and IIoT traffic.",
    flows: 16_940_496,
    sizeMB: 2800,
    attackTypes: 10,
    source: "built-in",
  },
  {
    id: "nf-bot-iot-v2",
    name: "NF-BoT-IoT-v2",
    description: "NetFlow v2 version of BoT-IoT, botnet traffic.",
    flows: 37_763_497,
    sizeMB: 6200,
    attackTypes: 4,
    source: "built-in",
  },
];

const INITIAL_UPLOADED: Dataset[] = [
  {
    id: "um-campus-sample",
    name: "UM campus sample",
    description: "Local flows exported from the campus network.",
    flows: 154_220,
    sizeMB: 38,
    attackTypes: 0,
    source: "uploaded",
    uploadedAt: "10 Nov 2026",
  },
];

// Columns the backend needs to build the host graph and run the model.
const REQUIRED_COLUMNS = [
  "IPV4_SRC_ADDR",
  "IPV4_DST_ADDR",
  "PROTOCOL",
  "IN_BYTES",
  "OUT_BYTES",
  "IN_PKTS",
  "OUT_PKTS",
];
// Needed only for training/evaluation, so missing ones are a warning.
const LABEL_COLUMNS = ["Label", "Attack"];

type Validation = {
  columns: string[];
  missingRequired: string[];
  missingLabels: string[];
};

const fmt = (n: number) => n.toLocaleString("en-US");
const fmtSize = (mb: number) =>
  mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
const fmtBytes = (b: number) =>
  b >= 1024 ** 3
    ? `${(b / 1024 ** 3).toFixed(2)} GB`
    : `${(b / 1024 ** 2).toFixed(1)} MB`;

// Reads only the first 64 KB of the file to check the header row.
async function validateCsv(file: File): Promise<Validation> {
  const text = await file.slice(0, 64 * 1024).text();
  const header = text.split(/\r?\n/)[0] ?? "";
  const columns = header
    .split(",")
    .map((c) => c.trim().replace(/^"|"$/g, ""));
  return {
    columns,
    missingRequired: REQUIRED_COLUMNS.filter((c) => !columns.includes(c)),
    missingLabels: LABEL_COLUMNS.filter((c) => !columns.includes(c)),
  };
}

// TODO: replace with a real upload, e.g. XMLHttpRequest/fetch to your backend
// (POST /api/datasets/upload with FormData) and call onProgress from
// xhr.upload.onprogress. This simulates progress so the UI can be tested.
function uploadToBackend(
  _file: File,
  _name: string,
  onProgress: (pct: number) => void
): Promise<void> {
  return new Promise((resolve) => {
    let pct = 0;
    const timer = setInterval(() => {
      pct = Math.min(100, pct + 8 + Math.random() * 10);
      onProgress(pct);
      if (pct >= 100) {
        clearInterval(timer);
        resolve();
      }
    }, 150);
  });
}

export default function UploadPage() {
  const inputRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<Dataset[]>(INITIAL_UPLOADED);

  const [file, setFile] = useState<File | null>(null);
  const [datasetName, setDatasetName] = useState("");
  const [validation, setValidation] = useState<Validation | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const allDatasets = [...BUILT_IN, ...uploaded];
  const selected = allDatasets.find((d) => d.id === selectedId) ?? null;

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
      await uploadToBackend(file, datasetName, setProgress);
      const newDataset: Dataset = {
        id: `local-${Date.now()}`,
        name: datasetName || file.name,
        description: "Uploaded local dataset.",
        flows: 0, // TODO: backend should return the real row count
        sizeMB: file.size / 1024 ** 2,
        attackTypes: 0,
        source: "uploaded",
        uploadedAt: new Date().toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        }),
      };
      setUploaded((prev) => [newDataset, ...prev]);
      setSelectedId(newDataset.id);
      clearFile();
      setTab("select");
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
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
                {BUILT_IN.map((d) => (
                  <DatasetCard
                    key={d.id}
                    dataset={d}
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
                  Local files you have uploaded to this workspace
                </CardDescription>
                <CardAction>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setTab("upload")}
                  >
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
                        <TableHead>Uploaded</TableHead>
                        <TableHead className="text-right">Flows</TableHead>
                        <TableHead className="text-right">Size</TableHead>
                        <TableHead className="text-right" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {uploaded.map((d) => (
                        <TableRow key={d.id}>
                          <TableCell className="font-medium">{d.name}</TableCell>
                          <TableCell>{d.uploadedAt}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {d.flows ? fmt(d.flows) : "Processing"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtSize(d.sizeMB)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant={d.id === selectedId ? "default" : "outline"}
                              onClick={() => setSelectedId(d.id)}
                            >
                              {d.id === selectedId ? "Selected" : "Select"}
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
                    ? `${selected.name} will be used for training and testing.`
                    : "No dataset selected yet."}
                </CardDescription>
              </CardHeader>
              <CardFooter className="gap-2">
                <Button asChild disabled={!selected}>
                  <Link
                    href={selected ? `/training?dataset=${selected.id}` : "#"}
                    aria-disabled={!selected}
                    className={!selected ? "pointer-events-none opacity-50" : ""}
                  >
                    Continue to training <ArrowRight />
                  </Link>
                </Button>
                <Button asChild variant="outline" disabled={!selected}>
                  <Link
                    href={selected ? `/explorer?dataset=${selected.id}` : "#"}
                    aria-disabled={!selected}
                    className={!selected ? "pointer-events-none opacity-50" : ""}
                  >
                    Explore data
                  </Link>
                </Button>
              </CardFooter>
            </Card>
          </TabsContent>

          {/* ---------------- UPLOAD TAB ---------------- */}
          <TabsContent value="upload">
            <Card>
              <CardHeader>
                <CardTitle>Upload a local dataset</CardTitle>
                <CardDescription>
                  CSV file of NetFlow records (same format as NF-UNSW-NB15-v2).
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                {/* Drop zone */}
                {!file && (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => inputRef.current?.click()}
                    onKeyDown={(e) =>
                      e.key === "Enter" && inputRef.current?.click()
                    }
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
                      dragging
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/50"
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
                        <p className="truncate text-sm font-medium">
                          {file.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {fmtBytes(file.size)}
                          {validation &&
                            ` · ${validation.columns.length} columns detected`}
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

                    {/* Validation result */}
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
                          All required NetFlow columns are present.
                          {validation.missingLabels.length > 0 &&
                            ` No ${validation.missingLabels.join(" / ")} column found, so this file can be used for testing but not for training or evaluation.`}
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
                          <span>Uploading…</span>
                          <span className="tabular-nums">
                            {Math.round(progress)}%
                          </span>
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
                    Optional (needed for training)
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {LABEL_COLUMNS.map((c) => (
                      <Badge key={c} variant="outline" className="font-mono">
                        {c}
                      </Badge>
                    ))}
                  </div>
                </div>
              </CardContent>
              <CardFooter className="gap-2">
                <Button onClick={handleUpload} disabled={!canUpload}>
                  <Upload /> {uploading ? "Uploading…" : "Upload dataset"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setTab("select")}
                  disabled={uploading}
                >
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
  selected,
  onSelect,
}: {
  dataset: Dataset;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Card
      className={`transition-colors ${
        selected ? "border-primary ring-1 ring-primary" : ""
      }`}
    >
      <CardHeader>
        <CardTitle>{dataset.name}</CardTitle>
        <CardDescription>{dataset.description}</CardDescription>
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
      <CardContent>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Flows</p>
            <p className="font-medium tabular-nums">{fmt(dataset.flows)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Size</p>
            <p className="font-medium tabular-nums">{fmtSize(dataset.sizeMB)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Attack types</p>
            <p className="font-medium tabular-nums">{dataset.attackTypes}</p>
          </div>
        </div>
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