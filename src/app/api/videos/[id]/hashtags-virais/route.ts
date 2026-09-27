import { fail, handleError, json, requireAuth } from "@/lib/api";
import * as repo from "@/lib/repo";
import { extrairSinais } from "@/lib/pipeline/commentInsights";
import { aiProvider } from "@/lib/providers/ai";

export const dynamic = "force-dynamic";

/**
 * Gera hashtags com alto potencial viral usando IA, baseadas nos comentários
 * e hashtags já capturados do vídeo. Roda direto (sem fila) porque é uma
 * única chamada ao modelo e o usuário está olhando para a tela.
 */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!repo.getVideo(id)) return fail("Vídeo não encontrado.", 404);

  const comments = repo.getComments(id);
  const hashtagsCapturadas = repo.getVideoHashtags(id);

  if (comments.length === 0 && !hashtagsCapturadas) {
    return fail("Nenhum comentário ou hashtag capturado para este vídeo.", 409);
  }

  try {
    const insights = comments.length > 0 ? extrairSinais(comments) : null;
    const analysis = repo.latestSceneAnalysis(id);
    const provider = aiProvider({ videoId: id });

    // Coleta todas as hashtags disponíveis como contexto para a IA
    const contextoHashtags = {
      doVideo: hashtagsCapturadas?.doVideo ?? [],
      nosComentarios: hashtagsCapturadas?.nosComentarios ?? [],
      todas: hashtagsCapturadas?.todas ?? [],
    };

    const resultado = await provider.generateViralHashtags(
      insights,
      analysis,
      contextoHashtags,
      15,
    );

    return json({
      ok: true,
      hashtags: resultado.hashtags,
      reasoning: resultado.reasoning ?? null,
    });
  } catch (err) {
    return handleError(err);
  }
}