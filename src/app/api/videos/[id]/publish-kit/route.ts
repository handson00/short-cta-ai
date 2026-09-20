import { fail, handleError, json, requireAuth } from "@/lib/api";
import * as repo from "@/lib/repo";
import { extrairSinais } from "@/lib/pipeline/commentInsights";
import { aiProvider } from "@/lib/providers/ai";

export const dynamic = "force-dynamic";

/** Legenda e hashtags. Funciona com ou sem comentários capturados. */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!repo.getVideo(id)) return fail("Vídeo não encontrado.", 404);

  try {
    const comments = repo.getComments(id);
    const insights = comments.length ? extrairSinais(comments) : null;
    const analysis = repo.latestSceneAnalysis(id);
    const visual = repo.getVisualAnalysis(id);
    const existente = repo.effectiveExistingCta(visual)?.text ?? null;

    if (!analysis && !insights) {
      return fail("Sem análise de cena e sem comentários: não há do que escrever a legenda.", 409);
    }

    const kit = await aiProvider({ videoId: id }).generatePublishKit(insights, analysis, existente);
    repo.savePublishKit(id, kit);
    return json({ ok: true, kit });
  } catch (err) {
    return handleError(err);
  }
}

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await ctx.params;
  return json({ kit: repo.getPublishKit(id) });
}
