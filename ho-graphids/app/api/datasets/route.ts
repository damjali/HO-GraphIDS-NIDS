import { listDatasets } from "@/lib/graphids/config";

// All datasets the UI can train/test with: the built-in ones (some disabled,
// with a reason) plus whatever has been uploaded.
export async function GET(req: Request) {
  new URL(req.url); // reading the request keeps this handler dynamic (never prerendered)
  return Response.json({ datasets: listDatasets() });
}
