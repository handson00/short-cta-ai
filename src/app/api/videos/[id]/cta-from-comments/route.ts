import { fail, handleError, json, requireAuth } from "@/lib/api";
import * as repo from "@/lib/repo";
import { extrairSinais } from "@/lib/pipeline/commentInsights";
import { aiProvider } from "@/lib/providers/ai";

export const dynamic = "force-dynamic";

/**
 * Gera ganchos a partir da reacao do publico, nao da descricao da cena.
 *
 * Roda direto, sem passar pela fila: e uma unica chamada ao modelo, sem
 * FFmpeg nem OCR pela frente, e o usuario esta olhando para a tela esperando.
 */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!repo.getVideo(id)) return fail("Vídeo não encontrado.", 404);

  const comments = repo.getComments(id);
  if (comments.length === 0) {
    return fail("Nenhum comentário capturado para este vídeo. Capture os comentários primeiro.", 409);
  }

  const insights = extrairSinais(comments);
  // Sem sinal, a ferramenta diz que não dá em vez de devolver um gancho bonito
  // apoiado em nada - é o mesmo princípio do campo de CTA que fica vazio.
  if (!insights.temSinal) {
    return fail(insights.motivoSemSinal ?? "Os comentários não trazem sinal aproveitável.", 422, {
      insights,
    });
  }

  try {
    const analysis = repo.latestSceneAnalysis(id);
    const provider = aiProvider({ videoId: id });
    const resultado = await provider.generateCtasFromComments(insights, analysis, 5);

    repo.replaceCommentSuggestions(
      id,
      resultado.suggestions.map((s: any) => ({ text: s.text, style: s.style , reason: s.signal || null })),
    );

    return json({
      ok: true,
      audienceRead: resultado.audienceRead,
      recommendedIndex: resultado.recommendedIndex,
      suggestions: resultado.suggestions,
      insights,
    });
  } catch (err) {
    return handleError(err);
  }
}
