import { FILES, queryGraph, type GraphMode } from "@/lib/datasets";

const MAX_ALL_EDGES = 5000;

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  if (!Object.hasOwn(FILES, id)) {
    return Response.json({ error: "Dataset not available" }, { status: 404 });
  }

  const sp = new URL(req.url).searchParams;
  const modeParam = sp.get("mode");
  const mode: GraphMode =
    modeParam === "benign" || modeParam === "attack" ? modeParam : "all";
  const ip = (sp.get("ip") ?? "").slice(0, 64);
  // "all" returns every matching edge, capped so the SVG stays renderable.
  const limitParam = sp.get("limit");
  const limit =
    limitParam === "all"
      ? MAX_ALL_EDGES
      : Math.min(200, Math.max(10, Number(limitParam) || 60));

  try {
    return Response.json(await queryGraph(id, { mode, ip, limit }));
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
