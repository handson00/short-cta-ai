import fs from "node:fs";
import path from "node:path";
import { getVideo } from "../repo";
import {
  cancelAllPendingEditorJobs,
  cancelPendingEditorJob,
  claimNextEditorJob,
  createEditorJob,
  getEditorTemplate,
  getVideoCrop,
  getVideoEffects,
  getVideoTemplateIds,
  listProcessingEditorJobIds,
  requeueInterruptedEditorJobs,
  updateEditorJobProgress,
  updateEditorJobStatus,
} from "../editorRepo";
import type { EditorJob } from "../types";
import { resolveEncoder, type EncoderMode } from "./encoder";
import { cancelExport, renderVideo, ExportError } from "./export";
import { outputDir } from "./outputDir";

/**
 * Fila de exportacao do editor (spec §54-§57, §112, §113, §129).
 *
 * Roda sempre dentro do processo do servidor, mesmo com WORKER_IN_PROCESS
 * desligado: o cancelamento precisa alcancar o FFmpeg em andamento, e o
 * registro desses processos vive na memoria deste processo.
 */

const POLL_MS = 1_000;

/**
 * Estado da fila, compartilhado entre as copias deste modulo.
 *
 * O Next.js carrega um exemplar para o `instrumentation`, onde o worker roda,
 * e outro para as rotas de API. Com variaveis soltas no modulo, a rota via uma
 * fila parada — encoder nulo, nenhum job ativo — e o cancelamento nunca
 * alcancava o render em andamento.
 */
interface QueueState {
  /** Jobs em andamento neste processo. */
  active: Set<string>;
  /** Cancelamento pedido antes de o FFmpeg subir: a janela entre claim e spawn. */
  cancelRequested: Set<string>;
  timer: NodeJS.Timeout | null;
  concurrency: number;
  encoderChoice: string | null;
}

const globalRef = globalThis as unknown as { __editorExportQueue?: QueueState };
const state: QueueState = (globalRef.__editorExportQueue ??= {
  active: new Set(),
  cancelRequested: new Set(),
  timer: null,
  concurrency: 1,
  encoderChoice: null,
});
const { active, cancelRequested } = state;

/**
 * Quantos exports ao mesmo tempo.
 *
 * Encoder de GPU tem circuito dedicado: dois em paralelo quase dobram a vazao
 * sem disputar a CPU. O libx264 ja usa todos os nucleos sozinho — dois ao mesmo
 * tempo so disputam a mesma CPU e cada um termina mais tarde (§56).
 */
function concurrencyFor(encoder: string): number {
  const configured = Number(process.env.EDITOR_EXPORT_CONCURRENCY);
  if (Number.isInteger(configured) && configured >= 1 && configured <= 4) return configured;
  return encoder === "libx264" ? 1 : 2;
}

export interface EnqueueOptions {
  /** Template para os vídeos que ainda não têm um aplicado. */
  fallbackTemplateId?: string | null;
  fps?: number;
  encoderMode?: EncoderMode;
  /**
   * Camada de texto já desenhada pelo navegador, por vídeo. Fotografada no job:
   * editar o texto depois de mandar exportar não muda o que já está na fila.
   */
  textLayers?: Record<string, string>;
}

/** Só aceita a camada do próprio vídeo, no formato que a rota de upload gera. */
function validTextLayer(videoId: string, name: string | undefined): string | null {
  if (!name) return null;
  const pattern = new RegExp(`^txt_${videoId}_[0-9a-f]{16}\\.png$`);
  return pattern.test(name) ? name : null;
}

export interface EnqueueResult {
  jobIds: string[];
  /** Quantos vídeos entraram com cada template. */
  byTemplate: Record<string, number>;
  /** Vídeos sem template aplicado e sem reserva: não entram na fila. */
  skipped: string[];
}

/**
 * Enfileira um job por video e volta na hora.
 *
 * Cada video sai com o template que foi APLICADO a ele; o template aberto no
 * painel so vale para quem ainda nao tem um. Antes, o lote inteiro saia com o
 * template do painel e a aplicacao por video era ignorada em silencio.
 *
 * O recorte e fotografado agora; o template e lido na hora de renderizar. Se o
 * usuario ajustar o recorte de um video depois de mandar exportar, o job ja
 * enfileirado nao muda por baixo dele.
 */
export function enqueueExports(videoIds: string[], opts: EnqueueOptions = {}): EnqueueResult {
  const assigned = getVideoTemplateIds(videoIds);
  const result: EnqueueResult = { jobIds: [], byTemplate: {}, skipped: [] };
  const templates = new Map<string, ReturnType<typeof getEditorTemplate>>();

  for (const videoId of videoIds) {
    const templateId = assigned.get(videoId) ?? opts.fallbackTemplateId ?? null;
    if (!templates.has(templateId ?? "")) {
      templates.set(templateId ?? "", templateId ? getEditorTemplate(templateId) : null);
    }
    const template = templates.get(templateId ?? "");
    if (!templateId || !template) {
      result.skipped.push(videoId);
      continue;
    }

    const crop = getVideoCrop(videoId);
    const job = createEditorJob({
      videoId,
      templateId,
      profileId: crop?.profileId ?? null,
      crop: crop ?? undefined,
      exportSettings: {
        // A resolução de saída é a do canvas do template.
        width: template.config.canvasWidth,
        height: template.config.canvasHeight,
        fps: opts.fps ?? 30,
        videoCodec: "h264",
        audioCodec: "aac",
        encoderMode: opts.encoderMode ?? "auto",
        textLayer: template.config.text?.enabled
          ? validTextLayer(videoId, opts.textLayers?.[videoId])
          : null,
        // Fotografado agora, como o recorte: mudar os efeitos depois de mandar
        // exportar não muda o job que já está na fila.
        effects: getVideoEffects(videoId),
      },
    });
    result.jobIds.push(job.id);
    result.byTemplate[templateId] = (result.byTemplate[templateId] ?? 0) + 1;
  }

  tick();
  return result;
}

async function runJob(job: EditorJob): Promise<void> {
  try {
    if (cancelRequested.has(job.id)) throw new ExportError("Exportação cancelada.");

    const video = getVideo(job.videoId);
    if (!video) throw new ExportError("O vídeo foi removido do acervo.");

    const template = job.templateId ? getEditorTemplate(job.templateId) : null;
    if (!template) throw new ExportError("O template deste job foi excluído.");

    const encoder = await resolveEncoder(job.exportSettings.encoderMode);
    if (cancelRequested.has(job.id)) throw new ExportError("Exportação cancelada.");

    // Grava no banco só quando o inteiro muda: o FFmpeg manda várias linhas
    // de progresso por segundo, e cada uma viraria uma escrita.
    let lastPercent = -1;
    const out = await renderVideo(
      {
        jobId: job.id,
        videoId: job.videoId,
        sourcePath: video.path,
        originalName: video.originalName,
        sourceWidth: video.width ?? 0,
        sourceHeight: video.height ?? 0,
        durationSeconds: video.durationSeconds ?? 0,
        hasAudio: video.hasAudio,
        // Sem recorte salvo, o job guarda o quadro inteiro — que é o certo.
        crop: job.crop,
        template: template.config,
        textLayer: job.exportSettings.textLayer ?? null,
        effects: job.exportSettings.effects ?? null,
        fps: job.exportSettings.fps,
        encoder,
      },
      (snap) => {
        if (snap.percent == null) return;
        const p = Math.floor(snap.percent);
        if (p !== lastPercent) {
          lastPercent = p;
          updateEditorJobProgress(job.id, p);
        }
      },
    );

    updateEditorJobStatus(job.id, "completed", { progress: 100, outputPath: out.outputPath });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha ao exportar.";
    const cancelled = cancelRequested.has(job.id) || message.includes("cancelada");
    updateEditorJobStatus(job.id, cancelled ? "cancelled" : "failed", {
      errorMessage: cancelled ? "Cancelado pelo usuário." : message,
    });
  } finally {
    cancelRequested.delete(job.id);
    active.delete(job.id);
    // Um job terminando libera uma vaga: não espera o próximo intervalo.
    tick();
  }
}

/**
 * Preenche as vagas livres.
 *
 * Um job que falha nao para os outros (§129): cada um tem seu proprio
 * try/catch, e a fila segue.
 */
function tick(): void {
  if (!state.timer) return;
  while (active.size < state.concurrency) {
    const job = claimNextEditorJob();
    if (!job) return;
    active.add(job.id);
    void runJob(job);
  }
}

/** Arquivos `.processing` sem dono são restos de um render interrompido. */
function removeOrphanPartials(): number {
  const dir = outputDir();
  if (!fs.existsSync(dir)) return 0;
  let removed = 0;
  for (const name of fs.readdirSync(dir)) {
    // Só dentro da pasta gerenciada e só a extensão que nós mesmos criamos (§69).
    if (!name.endsWith(".processing")) continue;
    try {
      fs.unlinkSync(path.join(dir, name));
      removed++;
    } catch {
      // Arquivo preso por outro programa: fica para a próxima inicialização.
    }
  }
  return removed;
}

export async function startExportWorker(): Promise<void> {
  if (state.timer) return;

  const requeued = requeueInterruptedEditorJobs();
  const orphans = removeOrphanPartials();
  if (requeued || orphans) {
    console.info(
      `[editor] ${requeued} exportação(ões) interrompida(s) voltaram à fila; ${orphans} arquivo(s) parcial(is) removido(s).`,
    );
  }

  try {
    state.encoderChoice = await resolveEncoder("auto");
    state.concurrency = concurrencyFor(state.encoderChoice);
  } catch {
    // Sem encoder, os jobs falham um a um com a mensagem do resolveEncoder —
    // melhor que o worker não subir e a fila ficar parada sem explicação.
    state.concurrency = 1;
  }

  state.timer = setInterval(tick, POLL_MS);
  console.info(`[editor] fila de exportação ativa (${state.encoderChoice ?? "sem encoder"}, ${state.concurrency} em paralelo).`);
  tick();
}

export function cancelEditorJob(jobId: string): boolean {
  if (cancelPendingEditorJob(jobId)) return true;
  if (!active.has(jobId)) return false;
  cancelRequested.add(jobId);
  cancelExport(jobId);
  return true;
}

export function cancelAllEditorJobs(): number {
  const pending = cancelAllPendingEditorJobs();
  let running = 0;
  for (const id of listProcessingEditorJobIds()) {
    if (active.has(id)) {
      cancelRequested.add(id);
      cancelExport(id);
      running++;
    }
  }
  return pending + running;
}

export function exportQueueInfo(): { encoder: string | null; concurrency: number; active: number } {
  return { encoder: state.encoderChoice, concurrency: state.concurrency, active: active.size };
}
