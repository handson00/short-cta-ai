import { fail, json, requireAuth } from "@/lib/api";
import * as repo from "@/lib/repo";

/** Regenerar CTAs reaproveita a analise de cena ja salva. */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!repo.getVideo(id)) return fail("Vídeo não encontrado.", 404);
  if (!repo.latestSceneAnalysis(id)) {
    return fail("Ainda não há análise de cena salva. Use Analisar novamente.", 409);
  }
  const job = repo.createJob(id, { reuseScene: true });
  return json({ ok: true, jobId: job.id });
}
