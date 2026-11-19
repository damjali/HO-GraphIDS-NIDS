import { findDataset } from "@/lib/graphids/config";
import { OVERRIDABLE, baseConfigFor } from "@/lib/graphids/yaml";

// Tuned default hyperparameters (from the GraphIDS repo's configs/*.yaml) so the
// training form can start from the same values as the paper's runs.
export async function GET(
  req: Request,
  ctx: { params: Promise<{ dataset: string }> }
) {
  new URL(req.url);
  const { dataset } = await ctx.params;
  const ds = findDataset(dataset);
  if (!ds) return Response.json({ error: "Unknown dataset" }, { status: 404 });
  try {
    return Response.json({
      dataset: ds,
      config: baseConfigFor(ds.pyName, ds.version),
      limits: OVERRIDABLE,
    });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
