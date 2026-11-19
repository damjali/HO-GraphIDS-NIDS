import { cancelRun, deleteRun, getRunDetail, isRunId } from "@/lib/graphids/runs";

type Ctx = { params: Promise<{ id: string }> };

// Status, per-epoch history, last log lines and (for uploaded-data tests) the result.
export async function GET(req: Request, ctx: Ctx) {
  new URL(req.url);
  const { id } = await ctx.params;
  const run = isRunId(id) ? getRunDetail(id) : null;
  if (!run) return Response.json({ error: "Run not found" }, { status: 404 });
  return Response.json({ run });
}

// ?action=cancel stops a running job; otherwise the run (and its model) is deleted.
export async function DELETE(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!isRunId(id)) return Response.json({ error: "Run not found" }, { status: 404 });
  if (new URL(req.url).searchParams.get("action") === "cancel") {
    const run = cancelRun(id);
    return run
      ? Response.json({ run })
      : Response.json({ error: "Run not found" }, { status: 404 });
  }
  return deleteRun(id)
    ? Response.json({ ok: true })
    : Response.json({ error: "Run not found" }, { status: 404 });
}
