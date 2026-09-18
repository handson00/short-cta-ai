import { fail, json, requireAuth } from "@/lib/api";
import * as repo from "@/lib/repo";

/** Nova tentativa de um item com erro ou cancelado. */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await ctx.params;
  const video = repo.getVideo(id);
  if (!video) return fail("Vídeo não encontrado.", 404);
  const job = repo.createJob(id);
  return json({ ok: true, jobId: job.id });
}
