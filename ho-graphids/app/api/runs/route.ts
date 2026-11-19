import { RunError, listRuns, startTest, startTrain } from "@/lib/graphids/runs";

export async function GET(req: Request) {
  new URL(req.url);
  const runs = listRuns().map((r) => ({ ...r, history: undefined, config: undefined }));
  return Response.json({ runs });
}

// Body:
//  { mode: "train", dataset, numHops?, hopMode?, overrides?, seed? }
//  { mode: "test", modelRunId, target: "builtin" | "upload", uploadName? }
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }
  try {
    if (body.mode === "train") {
      const run = await startTrain({
        dataset: String(body.dataset ?? ""),
        numHops: body.numHops === undefined ? undefined : Number(body.numHops),
        hopMode: typeof body.hopMode === "string" ? body.hopMode : undefined,
        overrides: (body.overrides as Record<string, unknown>) ?? {},
        seed: body.seed === undefined ? undefined : Number(body.seed),
      });
      return Response.json({ run }, { status: 201 });
    }
    if (body.mode === "test") {
      const target = body.target === "upload" ? "upload" : "builtin";
      const run = await startTest({
        modelRunId: String(body.modelRunId ?? ""),
        target,
        uploadName: typeof body.uploadName === "string" ? body.uploadName : undefined,
      });
      return Response.json({ run }, { status: 201 });
    }
    return Response.json({ error: 'mode must be "train" or "test"' }, { status: 400 });
  } catch (e) {
    if (e instanceof RunError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
