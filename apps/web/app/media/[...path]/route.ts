import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Downloaded creative media lives in the worker's MEDIA_DIR (default apps/worker/data/media). */
const MEDIA_ROOT = path.resolve(/*turbopackIgnore: true*/ process.env.MEDIA_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "../worker/data/media"));

const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".m4v": "video/x-m4v",
};

const stream = (file: string, opts?: { start: number; end: number }) => Readable.toWeb(createReadStream(file, opts)) as ReadableStream;

/** Serves creative media behind the login, with Range support so videos can seek. */
export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const s = await getSession();
  if (!s || s.stage !== "full") return new Response("Unauthorized", { status: 401 });

  const { path: parts } = await params;
  // Segments arrive already URL-decoded.
  const file = path.resolve(MEDIA_ROOT, ...parts);
  // Path traversal guard: the resolved file must stay inside MEDIA_ROOT.
  if (!file.startsWith(MEDIA_ROOT + path.sep)) return new Response("Not found", { status: 404 });

  let size: number;
  let mtime: Date;
  try {
    const st = await stat(file);
    if (!st.isFile()) return new Response("Not found", { status: 404 });
    size = st.size;
    mtime = st.mtime;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers({
    "Content-Type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=86400",
    "Last-Modified": mtime.toUTCString(),
    "X-Content-Type-Options": "nosniff",
  });

  const range = req.headers.get("range");
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    let start = m && m[1] ? Number(m[1]) : NaN;
    let end = m && m[2] ? Number(m[2]) : size - 1;
    if (m && !m[1] && m[2]) {
      // suffix range: last N bytes
      start = Math.max(0, size - Number(m[2]));
      end = size - 1;
    }
    end = Math.min(end, size - 1);
    if (!m || !Number.isFinite(start) || start > end || start >= size) {
      headers.set("Content-Range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    if (req.method === "HEAD") return new Response(null, { status: 206, headers });
    return new Response(stream(file, { start, end }), { status: 206, headers });
  }

  headers.set("Content-Length", String(size));
  if (req.method === "HEAD") return new Response(null, { headers });
  return new Response(stream(file), { headers });
}

export const HEAD = GET;
