import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  DATA_DIR,
  UPLOAD_META,
  UPLOAD_PREFIX,
  csvFor,
  getUpload,
  listUploads,
  uploadToDataset,
  type UploadMeta,
} from "@/lib/graphids/config";
import { readCsvHeader } from "@/lib/graphids/schema";

export async function GET(req: Request) {
  new URL(req.url);
  return Response.json({ uploads: listUploads().map(uploadToDataset) });
}

// The browser sends the raw file as the request body (not multipart), so it can be
// streamed straight to disk without loading hundreds of MB into memory.
//   POST /api/uploads?name=my-flows.csv   body: <csv bytes>
export async function POST(req: Request) {
  const original = (new URL(req.url).searchParams.get("name") ?? "upload.csv").slice(0, 120);
  if (!req.body) return Response.json({ error: "Empty body" }, { status: 400 });

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = path.join(DATA_DIR, `.upload-${crypto.randomBytes(4).toString("hex")}.tmp`);
  try {
    await pipeline(
      Readable.fromWeb(req.body as unknown as import("node:stream/web").ReadableStream),
      fs.createWriteStream(tmp)
    );

    const header = await readCsvHeader(tmp);
    const missing = ["IPV4_SRC_ADDR", "IPV4_DST_ADDR"].filter((c) => !header.includes(c));
    if (missing.length) {
      fs.rmSync(tmp, { force: true });
      return Response.json(
        { error: `This is not a NetFlow CSV. Missing columns: ${missing.join(", ")}` },
        { status: 422 }
      );
    }

    // The Python loader treats any name containing "v3" as the v3 schema, so the
    // version is decided by the columns and the slug is not allowed to say "v3".
    const version = header.includes("FLOW_START_MILLISECONDS") ? "v3" : "v2";
    const slug =
      original
        .replace(/\.csv$/i, "")
        .replace(/[^A-Za-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .replace(/v3/gi, "v-3")
        .slice(0, 40) || "data";
    const name = `${UPLOAD_PREFIX}${slug}-${crypto.randomBytes(2).toString("hex")}-${version}`;

    fs.mkdirSync(path.dirname(csvFor(name)), { recursive: true });
    fs.renameSync(tmp, csvFor(name));
    const meta: UploadMeta = {
      name,
      originalName: original,
      sizeBytes: fs.statSync(csvFor(name)).size,
      version,
      labeled: header.includes("Label") && header.includes("Attack"),
      columns: header,
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(path.dirname(csvFor(name)), UPLOAD_META), JSON.stringify(meta));
    return Response.json({ upload: uploadToDataset(meta) }, { status: 201 });
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

// DELETE /api/uploads?name=UPLOAD-...  removes the uploaded dataset folder.
export async function DELETE(req: Request) {
  const name = new URL(req.url).searchParams.get("name") ?? "";
  const up = getUpload(name);
  if (!up) return Response.json({ error: "Upload not found" }, { status: 404 });
  fs.rmSync(path.dirname(csvFor(up.name)), { recursive: true, force: true });
  // Also drop its graph cache, if training ever built one.
  fs.rmSync(path.join(DATA_DIR, "pyg_graph_data", up.name), { recursive: true, force: true });
  return Response.json({ ok: true });
}
