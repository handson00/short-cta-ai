import fs from "node:fs";
import { NextResponse } from "next/server";
import { fail, requireAuth } from "@/lib/api";
import * as repo from "@/lib/repo";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await ctx.params;
  const video = repo.getVideo(id);
  if (!video?.thumbnailPath || !fs.existsSync(video.thumbnailPath)) return fail("Sem miniatura.", 404);
  const body = fs.readFileSync(video.thumbnailPath);
  return new NextResponse(new Uint8Array(body), {
    headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=300" },
  });
}
