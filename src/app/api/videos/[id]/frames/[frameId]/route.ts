import fs from "node:fs";
import { NextResponse } from "next/server";
import { fail, requireAuth } from "@/lib/api";
import * as repo from "@/lib/repo";

/** Frames de evidencia, servidos pelo ID gravado no banco. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string; frameId: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id, frameId } = await ctx.params;
  const frame = repo.listFrames(id).find((f: any) => f.id === frameId);
  if (!frame || !fs.existsSync(frame.path)) return fail("Frame indisponível.", 404);
  const body = fs.readFileSync(frame.path);
  return new NextResponse(new Uint8Array(body), {
    headers: { "content-type": "image/png", "cache-control": "private, max-age=300" },
  });
}
