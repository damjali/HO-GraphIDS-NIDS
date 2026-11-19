import { listModels } from "@/lib/graphids/runs";

// Trained models: finished training runs that saved a checkpoint.
export async function GET(req: Request) {
  new URL(req.url);
  return Response.json({ models: listModels() });
}
