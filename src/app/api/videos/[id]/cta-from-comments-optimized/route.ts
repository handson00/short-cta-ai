import { notFound } from "next/navigation";
import { repo } from "@/lib/repo";
import { provider } from "@/lib/providers";
import { extrairSinais } from "@/lib/pipeline/commentInsights";

export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params;

    // Encontrar video
    const video = await repo.getVideoWithCta(id);
    if (!video) return notFound();

    // Carregar comentarios capturados
    const comments = await repo.getComments(id);
    if (!comments || comments.length === 0) {
      return Response.json({
        error: "Nenhum comentário capturado para este vídeo. Execute a captura primeiro.",
      }, { status: 400 });
    }

    // Analisar sinais dos comentarios
    const insights = extrairSinais(comments);
    if (!insights.temSinal) {
      return Response.json({
        error: insights.motivoSemSinal || "Comentários insuficientes para gerar CTA.",
      }, { status: 400 });
    }

    // Carregar analise de cena se existir
    const scene = video.sceneAnalysis ? JSON.parse(video.sceneAnalysis as string) : null;

    // Gerar CTAs OTIMIZADOS (com estratégias)
    const result = await provider.ai.generateCtasFromCommentsOptimized(insights, scene, 3);

    // Salvar resultado com origem 'comments-optimized'
    const ctas = result.suggestions.map((s) => ({
      text: s.text,
      origin: "comments-optimized" as const,
      type: "smi" as const,
      style: s.style,
      signal: s.signal,
      technique: s.technique,
      strategy: s.style,
    }));

    await repo.replaceCtas(id, ctas);

    return Response.json({
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
    console.error("[cta-from-comments-optimized]", err);
    const msg = err instanceof Error ? err.message : "Erro interno";
    return Response.json({ error: msg }, { status: 500 });
  }
}
