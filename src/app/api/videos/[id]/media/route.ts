import fs from "node:fs";
import { NextResponse } from "next/server";
import { fail, requireAuth } from "@/lib/api";
import * as repo from "@/lib/repo";

const MIME: Record<string, string> = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm" };

/** Serve o video pelo ID interno: o caminho em disco nunca vai para o cliente. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await ctx.params;
  const video = repo.getVideo(id);
  if (!video || !fs.existsSync(video.path)) return fail("Arquivo indisponível.", 404);

  const stat = fs.statSync(video.path);
  const extension = video.originalName.slice(video.originalName.lastIndexOf(".")).toLowerCase();
  const contentType = MIME[extension] ?? "application/octet-stream";
  const range = request.headers.get("range");

  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start = match && match[1] ? Number(match[1]) : 0;
    const end = match && match[2] ? Number(match[2]) : Math.min(stat.size - 1, start + 2 * 1024 * 1024);
    if (start >= stat.size) return fail("Faixa inválida.", 416);

    const stream = fs.createReadStream(video.path, { start, end });
    return new NextResponse(stream as unknown as ReadableStream, {
      status: 206,
      headers: {
        "content-type": contentType,
        "content-length": String(end - start + 1),
        "content-range": `bytes ${start}-${end}/${stat.size}`,
        "accept-ranges": "bytes",
      },
    });
  }

  const stream = fs.createReadStream(video.path);
  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      "content-type": contentType,
      "content-length": String(stat.size),
      "accept-ranges": "bytes",
    },
  });
}
