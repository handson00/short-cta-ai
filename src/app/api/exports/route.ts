import fs from "node:fs";
import path from "node:path";
import { json, requireAuth } from "@/lib/api";
import { db } from "@/lib/db";
import * as repo from "@/lib/repo";
import { rankHashtags } from "@/lib/pipeline/hashtagRank";
import { outputDir } from "@/lib/editor/outputDir";

export const dynamic = "force-dynamic";

/**
 * Os vídeos já exportados, com tudo que é preciso para publicar.
 *
 * Só entram os jobs `completed`: a página é "o que está pronto". O arquivo que
 * não está mais no disco NÃO é escondido: vem marcado (`fileMissing`), porque
 * sumir da lista faria parecer que a exportação nunca aconteceu — e quem
 * exportou 10 e vê 8 não teria como saber o que houve com os outros dois.
 */
export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  const startedAt =
    (globalThis as { __appStartedAt?: string }).__appStartedAt ?? null;

  const rows = db()
    .prepare(
      `SELECT j.id, j.video_id, j.output_path, j.completed_at, v.original_name, v.duration_seconds,
              v.original_url, v.platform, v.tiktok_username
       FROM editor_jobs j JOIN videos v ON v.id = j.video_id
       WHERE j.status = 'completed' AND j.output_path IS NOT NULL
       ORDER BY j.completed_at DESC LIMIT 300`,
    )
    .all() as Array<{
    id: string;
    video_id: string;
    output_path: string;
    completed_at: string | null;
    original_name: string;
    duration_seconds: number | null;
    original_url: string | null;
    platform: string | null;
    tiktok_username: string | null;
  }>;

  const exports = rows.map((r) => {
    let bytes: number | null = null;
    try {
      bytes = fs.statSync(r.output_path).size;
    } catch {
      bytes = null; // apagado, movido ou em disco desconectado
    }

    // O texto que foi para o vídeo: o próprio do editor, senão o CTA da Fila
    // (editado → escolhido → recomendado). A mesma regra da exportação.
    const selection = repo.getSelection(r.video_id);
    const suggestions = repo.listSuggestions(r.video_id);
    const analysis = repo.latestSceneAnalysis(r.video_id);
    const override = (
      db()
        .prepare("SELECT text FROM editor_video_texts WHERE video_id = ?")
        .get(r.video_id) as { text: string } | undefined
    )?.text;
    // Mesma fonte que `/api/editor/library` usa para montar o vídeo: a
    // sugestão marcada como recomendada, não `scene_analyses.recommended_text`.
    // As duas divergem (uma análise salva pode não ter a recomendação
    // gravada), e aqui o que vale é o texto que FOI para o vídeo.
    const ctaDaFila =
      selection.editedText ??
      suggestions.find((s) => s.id === selection.chosenCtaId)?.text ??
      suggestions.find((s) => s.isRecommended)?.text ??
      null;
    const cta = override ?? ctaDaFila;

    const transcript = repo.getTranscript(r.video_id);
    const captured = repo.getVideoHashtags(r.video_id);
    const kit = repo.getPublishKit(r.video_id);
    const work = repo.getWork(r.video_id);

    const recommended = rankHashtags(captured, {
      cta,
      plot: analysis?.plot ?? null,
      transcript: transcript?.hasSpeech ? transcript.text : null,
    }).map((h) => h.tag);

    return {
      jobId: r.id,
      videoId: r.video_id,
      videoName: r.original_name,
      fileName: path.basename(r.output_path),
      outputPath: r.output_path,
      bytes,
      /** O arquivo não está mais no caminho gravado: apagado, movido ou disco fora. */
      fileMissing: bytes === null,
      durationSeconds: r.duration_seconds,
      completedAt: r.completed_at,
      /** Saiu depois que este servidor subiu: é desta sessão de trabalho. */
      thisSession: Boolean(
        startedAt && r.completed_at && r.completed_at >= startedAt,
      ),
      cta,
      /** Kit de publicação, quando foi gerado para o vídeo. */
      description: kit?.description ?? null,
      /** As capturadas pela extensão que o ranking recomendou, e as do kit. */
      hashtags: recommended,
      kitHashtags: kit?.hashtags ?? [],
      /** Sugeridas pela IA na própria página, com o motivo de cada uma. */
      aiHashtags: captured?.ia ?? [],
      /** Legenda em japonês, quando gerada. */
      jpCaption: repo.getJapaneseCaption(r.video_id)?.text ?? null,
      transcript: transcript?.hasSpeech ? transcript.text : null,
      sceneSummary: analysis?.sceneSummary ?? null,
      plot: analysis?.plot ?? null,
      workTitle:
        work?.status === "identified" && work.title ? work.title : null,
      originalUrl: r.original_url,
      sourceLabel: r.tiktok_username ? `@${r.tiktok_username}` : null,
    };
  });

  return json({ exports, outputDir: outputDir(), sessionStartedAt: startedAt });
}
