import fs from "node:fs";
import path from "node:path";
import { db } from "./db";
import * as repo from "./repo";
import { rankHashtags } from "./pipeline/hashtagRank";
import { buscarEnvio } from "./agendador";

/**
 * Uma exportação pronta, com tudo que é preciso para publicar.
 *
 * Saiu da rota `/api/exports` para ser a fonte única: a página lista com isto
 * e o envio ao Agendador IG monta o post com isto. Duas montagens divergiriam —
 * o CTA tem regra de prioridade, e o post sairia com outro texto que o da tela.
 *
 * Só entram os jobs `completed`: é "o que está pronto".
 */

const SELECT_EXPORTS = `SELECT j.id, j.video_id, j.output_path, j.completed_at, v.original_name, v.duration_seconds,
       v.original_url, v.platform, v.tiktok_username, v.archived_at
  FROM editor_jobs j JOIN videos v ON v.id = j.video_id
  WHERE j.status = 'completed' AND j.output_path IS NOT NULL`;

interface ExportRow {
  id: string;
  video_id: string;
  output_path: string;
  completed_at: string | null;
  original_name: string;
  duration_seconds: number | null;
  original_url: string | null;
  platform: string | null;
  tiktok_username: string | null;
  archived_at: string | null;
}

function montar(r: ExportRow, startedAt: string | null) {
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
  const captions = repo.getCaptions(r.video_id);
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
    thisSession: Boolean(startedAt && r.completed_at && r.completed_at >= startedAt),
    cta,
    /** Kit de publicação, quando foi gerado para o vídeo. */
    description: kit?.description ?? null,
    /** As capturadas pela extensão que o ranking recomendou, e as do kit. */
    hashtags: recommended,
    kitHashtags: kit?.hashtags ?? [],
    /** Sugeridas pela IA na própria página, com o motivo de cada uma. */
    aiHashtags: captured?.ia ?? [],
    /** Hashtags em japonês sugeridas pela IA. */
    aiHashtagsJa: captured?.iaJa ?? [],
    /** Legenda principal, em português, gerada nesta página. */
    ptCaption: captions.pt,
    /** Legenda em japonês, quando gerada. */
    jpCaption: captions.ja,
    transcript: transcript?.hasSpeech ? transcript.text : null,
    sceneSummary: analysis?.sceneSummary ?? null,
    plot: analysis?.plot ?? null,
    workTitle: work?.status === "identified" && work.title ? work.title : null,
    originalUrl: r.original_url,
    sourceLabel: r.tiktok_username ? `@${r.tiktok_username}` : null,
    /** O vídeo saiu da Fila e está guardado só aqui, no histórico (§47). */
    archivedAt: r.archived_at,
    /** Recibo do último envio ao Agendador IG, se houve. */
    agendador: buscarEnvio(r.id),
  };
}

export type ExportData = ReturnType<typeof montar>;

export function listExports(startedAt: string | null): ExportData[] {
  const rows = db().prepare(`${SELECT_EXPORTS} ORDER BY j.completed_at DESC LIMIT 300`).all() as ExportRow[];
  return rows.map((r) => montar(r, startedAt));
}

export function getExport(jobId: string): ExportData | null {
  const row = db().prepare(`${SELECT_EXPORTS} AND j.id = ?`).get(jobId) as ExportRow | undefined;
  return row ? montar(row, null) : null;
}
