import { FILES, loadDataset } from "@/lib/datasets";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  if (!Object.hasOwn(FILES, id)) {
    return Response.json({ error: "Dataset not available" }, { status: 404 });
  }
  try {
    return Response.json(await loadDataset(id));
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
