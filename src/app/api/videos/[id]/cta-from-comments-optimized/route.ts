import { fail, handleError, json, requireAuth } from "@/lib/api";
import * as repo from "@/lib/repo";
import { extrairSinais } from "@/lib/pipeline/commentInsights";
import { aiProvider } from "@/lib/providers/ai";

export const dynamic = "force-dynamic";

/**
 * Reanálisa e gera ganchos otimizados a partir dos comentários capturados.
 * Detecta estratégias de engajamento e aplica técnicas de copywriting específicas.
 */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!repo.getVideo(id)) return fail("Vídeo não encontrado.", 404);

  // Carregar comentários capturados
  const comments = repo.getComments(id);
  if (comments.length === 0) {
    return fail("Nenhum comentário capturado para este vídeo. Execute a captura primeiro.", 409);
  }

  // Analisar sinais dos comentários
  const insights = extrairSinais(comments);
  if (!insights.temSinal) {
    return fail(insights.motivoSemSinal || "Comentários insuficientes para gerar CTA.", 422, {
      insights,
    });
  }

  try {
    // Carregar análise de cena se existir
    const scene = repo.latestSceneAnalysis(id);

    // Gerar CTAs OTIMIZADOS (com estratégias)
    const provider = aiProvider({ videoId: id });
    const result = await provider.generateCtasFromCommentsOptimized(insights, scene, 3);

    // Salvar resultado com origem 'comments-optimized'
    repo.replaceCommentSuggestions(
      id,
      result.suggestions.map((s) => ({
        text: s.text,
        style: s.style,
        reason: s.signal || s.technique || null,
      })),
    );

    return json({
      ok: true,
      suggestions: result.suggestions,
      recommendedIndex: result.recommendedIndex,
      strategyExplained: result.strategyExplained,
      insights: {
        estrategiaPrincipal: insights.estrategiaPrincipal,
        estrategias: insights.estrategias,
        totalComentarios: insights.total,
        totalRespostas: insights.totalRespostas,
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
