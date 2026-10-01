import { json, requireAuth } from "@/lib/api";
import * as repo from "@/lib/repo";
import { rankHashtags } from "@/lib/pipeline/hashtagRank";

export const dynamic = "force-dynamic";

/** Comentários já capturados para este vídeo. Leitura, exige sessão. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await params;
  const hashtags = repo.getVideoHashtags(id);

  // O CTA pela mesma regra da Fila: editado, senão escolhido, senão recomendado.
  const selection = repo.getSelection(id);
  const analysis = repo.latestSceneAnalysis(id);
  const cta =
    selection.editedText ??
    repo.listSuggestions(id).find((s) => s.id === selection.chosenCtaId)?.text ??
    analysis?.recommended?.text ??
    null;
  const transcript = repo.getTranscript(id);

  return json({
    comments: repo.getComments(id),
    capturedAt: repo.getCommentsCapturedAt(id),
    hashtags,
    // Sem IA: as duas mais relevantes entre as capturadas pela extensão.
    recommendedHashtags: rankHashtags(hashtags, {
      cta,
      plot: analysis?.plot ?? null,
      transcript: transcript?.hasSpeech ? transcript.text || transcript.segments.map((s) => s.text).join(" ") : null,
    }),
  });
}
