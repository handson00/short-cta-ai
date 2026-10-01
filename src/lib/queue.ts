import os from "node:os";
import { db, nowIso, toBool } from "./db";
import { ACTIVE_STATUSES } from "./types";
import { getSettings } from "./settings";
import { runJob } from "./pipeline/runner";
import { heartbeat, LEASE_MS, type ClaimedJob } from "./pipeline/jobControl";

/**
 * Fila persistente em SQLite.
 *
 * Para um uso local de usuario unico isso evita subir Redis so para enfileirar
 * videos. O que importa e a durabilidade: cada job tem um lease com prazo, de
 * modo que um worker morto no meio do caminho nao deixa o item preso — na volta
 * o job e devolvido para a fila ou marcado com erro, nunca esquecido.
 */

const HEARTBEAT_MS = 20_000;
const POLL_MS = 1_500;
/**
 * A varredura de leases vencidos roda periodicamente, não só na subida: um
 * worker derrubado no meio de um job deixa o lease válido por mais um tempo, e
 * sem esta repetição aquele item ficaria "processando" para sempre.
 */
const RECOVERY_SWEEP_MS = 20_000;

const OWNER = `${os.hostname()}:${process.pid}`;

/**
 * Duas pistas. "local" = jobs que transcrevem (importação, "Analisar
 * novamente"): pesam na CPU e respeitam a concorrência configurada. "ai" =
 * "Gerar CTAs" com a parte local já pronta: passam o tempo esperando a rede, e
 * enfileirá-los atrás de transcrições deixaria a IA parada à toa. Um job "ai"
 * de vídeo que nunca foi processado faz a parte local na pista dele — é raro e
 * não justifica trocar de pista no meio.
 */
export type QueueLane = "local" | "ai";

export function claimNextJob(lane?: QueueLane): ClaimedJob | null {
  const database = db();
  const laneFilter =
    lane === "ai" ? "AND mode = 'ai'" : lane === "local" ? "AND COALESCE(mode, 'full') <> 'ai'" : "";
  const claim = database.transaction((): ClaimedJob | null => {
    const row = database
      .prepare(
        `SELECT id, video_id, attempts, max_attempts, reuse_scene, mode FROM analysis_jobs
         WHERE status = 'queued' AND cancel_requested = 0
           AND (lease_expires_at IS NULL OR lease_expires_at < ?) ${laneFilter}
         ORDER BY created_at LIMIT 1`,
      )
      .get(nowIso()) as
      | { id: string; video_id: string; attempts: number; max_attempts: number; reuse_scene: number; mode: string | null }
      | undefined;
    if (!row) return null;

    database
      .prepare(
        `UPDATE analysis_jobs SET status = 'extracting_media', stage = 'extracting_media', attempts = attempts + 1,
           lease_owner = ?, lease_expires_at = ?, started_at = COALESCE(started_at, ?), updated_at = ?
         WHERE id = ?`,
      )
      .run(OWNER, new Date(Date.now() + LEASE_MS).toISOString(), nowIso(), nowIso(), row.id);

    return {
      id: row.id,
      videoId: row.video_id,
      attempts: row.attempts + 1,
      maxAttempts: row.max_attempts,
      reuseScene: toBool(row.reuse_scene),
      mode: row.mode === "local" || row.mode === "ai" ? row.mode : "full",
    };
  });

  return claim.immediate();
}

export { heartbeat, setStage, type ClaimedJob } from "./pipeline/jobControl";

/**
 * Chamado na subida do worker. Um job que estava em andamento sem lease valido
 * volta para a fila; se ja gastou as tentativas, vira erro explicito em vez de
 * ficar "processando" para sempre.
 */
export function recoverStaleJobs(): { requeued: number; failed: number } {
  const database = db();
  const placeholders = ACTIVE_STATUSES.map(() => "?").join(",");
  const rows = database
    .prepare(
      `SELECT id, attempts, max_attempts FROM analysis_jobs
       WHERE status IN (${placeholders}) AND (lease_expires_at IS NULL OR lease_expires_at < ?)`,
    )
    .all(...ACTIVE_STATUSES, nowIso()) as { id: string; attempts: number; max_attempts: number }[];

  let requeued = 0;
  let failed = 0;
  for (const row of rows) {
    if (row.attempts < row.max_attempts) {
      database
        .prepare(
          `UPDATE analysis_jobs SET status = 'queued', stage = 'queued', lease_owner = NULL,
             lease_expires_at = NULL, updated_at = ? WHERE id = ?`,
        )
        .run(nowIso(), row.id);
      requeued += 1;
    } else {
      database
        .prepare(
          `UPDATE analysis_jobs SET status = 'error', stage = 'error', error_code = 'worker_restart',
             error_message = 'O processamento foi interrompido e as tentativas se esgotaram.',
             retryable = 1, lease_owner = NULL, lease_expires_at = NULL, finished_at = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(nowIso(), nowIso(), row.id);
      failed += 1;
    }
  }
  return { requeued, failed };
}

export function queueCounts(): Record<string, number> {
  const rows = db()
    .prepare(
      // Um job por vídeo — o mais recente, com o mesmo desempate por rowid de
      // `repo.latestJob`; por MAX(created_at), um empate contava o vídeo duas vezes.
      `SELECT status, COUNT(*) AS total FROM analysis_jobs j
       WHERE j.rowid = (SELECT j2.rowid FROM analysis_jobs j2 WHERE j2.video_id = j.video_id
                        ORDER BY j2.created_at DESC, j2.rowid DESC LIMIT 1)
       GROUP BY status`,
    )
    .all() as { status: string; total: number }[];
  return Object.fromEntries(rows.map((r: any) => [r.status, r.total]));
}

/** Cancela todos os jobs na fila ou ativos. Jobs concluídos ou com erro não são tocados. */
export function cancelQueuedAndActiveJobs(): { canceled: number } {
  const database = db();
  const placeholders = [...ACTIVE_STATUSES, "queued"].map(() => "?").join(",");
  const result = database
    .prepare(
      `UPDATE analysis_jobs SET status = 'canceled', stage = 'canceled', cancel_requested = 1,
         lease_owner = NULL, lease_expires_at = NULL, finished_at = ?, updated_at = ?
       WHERE status IN (${placeholders})`,
    )
    .run(nowIso(), nowIso(), ...ACTIVE_STATUSES, "queued");
  return { canceled: result.changes };
}

// --------------------------------- Worker -----------------------------------

let started = false;
let stopping = false;
let timer: NodeJS.Timeout | null = null;
const running = new Map<string, { beat: NodeJS.Timeout; lane: QueueLane }>();

function laneCount(lane: QueueLane): number {
  let n = 0;
  for (const r of running.values()) if (r.lane === lane) n += 1;
  return n;
}

function fill(lane: QueueLane, limit: number): void {
  while (laneCount(lane) < limit) {
    const job = claimNextJob(lane);
    if (!job) break;
    void execute(job, lane);
  }
}

export function startWorker(): void {
  if (started) return;
  started = true;
  stopping = false;

  const recovery = recoverStaleJobs();
  if (recovery.requeued || recovery.failed) {
    console.info(
      `[fila] retomada apos reinicio: ${recovery.requeued} job(s) devolvidos a fila, ${recovery.failed} marcado(s) com erro.`,
    );
  }

  let lastSweep = Date.now();

  const tick = () => {
    if (stopping) return;
    try {
      if (Date.now() - lastSweep >= RECOVERY_SWEEP_MS) {
        lastSweep = Date.now();
        const sweep = recoverStaleJobs();
        if (sweep.requeued || sweep.failed) {
          console.info(`[fila] varredura: ${sweep.requeued} devolvido(s) a fila, ${sweep.failed} com erro.`);
        }
      }

      const settings = getSettings();
      const { concurrency, aiConcurrency } = settings.queue;
      fill("local", concurrency);
      // O plano gratuito do Gemini tem limite baixo de requisições por minuto:
      // um vídeo por vez faz as chamadas saírem em fila, em vez de três jobs
      // baterem no limite juntos e queimarem as tentativas.
      fill("ai", settings.ai.provider === "gemini" ? 1 : aiConcurrency);
    } catch (err) {
      console.error("[fila] falha no laco principal:", (err as Error).message);
    }
    timer = setTimeout(tick, POLL_MS);
  };

  tick();
  console.info(`[fila] worker ativo (${OWNER}).`);
}

export function stopWorker(): void {
  stopping = true;
  if (timer) clearTimeout(timer);
  for (const { beat } of running.values()) clearInterval(beat);
  running.clear();
  started = false;
}

async function execute(job: ClaimedJob, lane: QueueLane): Promise<void> {
  const beat = setInterval(() => heartbeat(job.id), HEARTBEAT_MS);
  running.set(job.id, { beat, lane });
  try {
    await runJob(job);
  } catch (err) {
    console.error(`[fila] job ${job.id} falhou de forma inesperada:`, (err as Error).message);
  } finally {
    clearInterval(beat);
    running.delete(job.id);
  }
}

export function workerRunning(): boolean {
  return started;
}

export function activeJobCount(): number {
  return running.size;
}
