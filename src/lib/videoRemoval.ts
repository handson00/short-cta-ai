import fs from "node:fs";
import path from "node:path";
import { db } from "./db";
import * as repo from "./repo";
import { cancelEditorJob } from "./editor/exportQueue";

/**
 * Tirar da Fila e tirar do histórico de Exportações são coisas diferentes
 * (HISTORICO §47): a Fila é onde se trabalha; o histórico é o arquivo do que
 * ficou pronto, e o usuário volta a ele para pegar informação do vídeo.
 */

/** Exportações ainda não terminadas deste vídeo. */
function exportacoesAbertas(videoId: string): string[] {
  return (
    db()
      .prepare("SELECT id FROM editor_jobs WHERE video_id = ? AND status IN ('pending', 'processing')")
      .all(videoId) as Array<{ id: string }>
  ).map((r) => r.id);
}

/**
 * "Excluir" na Fila. Com exportação no histórico, o vídeo é arquivado (some da
 * Fila e do Editor, fica no histórico); sem, é apagado como sempre foi.
 */
export function tirarDaFila(videoId: string): "apagado" | "arquivado" | null {
  if (!repo.getVideo(videoId)) return null;
  // Para o que estiver trabalhando no vídeo antes de os arquivos sumirem.
  repo.requestCancel(videoId);
  for (const jobId of exportacoesAbertas(videoId)) cancelEditorJob(jobId);
  return repo.removeFromQueue(videoId);
}

export interface RemocaoDoHistorico {
  /** O MP4 foi apagado da pasta de saída (só quando pedido). */
  arquivoApagado: boolean;
  /** O vídeo arquivado perdeu a última exportação e saiu de vez. */
  videoApagado: boolean;
}

/**
 * "Remover do histórico" na página de Exportações.
 *
 * O MP4 na pasta de saída só é apagado se o usuário pedir: é o arquivo pronto
 * para publicar, e a pasta é dele (pode estar num HD externo, organizada à mão).
 *
 * Se o vídeo já tinha saído da Fila e esta era a última exportação dele, nada
 * mais o mostra — ele sai de vez, com os dados.
 */
export function removerDoHistorico(jobId: string, opts: { apagarArquivo: boolean }): RemocaoDoHistorico | null {
  const job = db()
    .prepare("SELECT id, video_id, output_path FROM editor_jobs WHERE id = ? AND status = 'completed'")
    .get(jobId) as { id: string; video_id: string; output_path: string | null } | undefined;
  if (!job) return null;

  let arquivoApagado = false;
  // Só o arquivo que a própria exportação gravou, e só se ainda for um MP4:
  // o caminho vem do banco, mas apagar é irreversível.
  if (opts.apagarArquivo && job.output_path && path.extname(job.output_path).toLowerCase() === ".mp4") {
    if (fs.existsSync(job.output_path)) {
      // Se falhar (arquivo aberto num player), o erro sobe e nada é removido:
      // o usuário pediu para apagar e precisa saber que não apagou.
      fs.rmSync(job.output_path);
      arquivoApagado = true;
    }
  }

  db().prepare("DELETE FROM editor_jobs WHERE id = ?").run(jobId);

  const video = repo.getVideo(job.video_id);
  let videoApagado = false;
  if (video?.archivedAt && !repo.hasCompletedExport(video.id)) {
    repo.deleteVideo(video.id);
    videoApagado = true;
  }
  return { arquivoApagado, videoApagado };
}
