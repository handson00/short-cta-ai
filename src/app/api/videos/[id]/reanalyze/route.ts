import { fail, json, requireAuth } from "@/lib/api";
import * as repo from "@/lib/repo";

/** Analisar novamente refaz extracao e interpretacao do video. */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!repo.getVideo(id)) return fail("Vídeo não encontrado.", 404);
  const job = repo.createJob(id, { reuseScene: false });
  return json({ ok: true, jobId: job.id });
}
