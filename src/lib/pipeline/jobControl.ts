import { db, nowIso } from "../db";
import type { JobStatus } from "../types";

/**
 * Controle de lease do job. Fica separado da fila para evitar import circular
 * entre a fila (que chama o runner) e o runner (que precisa bater o ponto).
 */

export const LEASE_MS = 90_000;

export interface ClaimedJob {
  id: string;
  videoId: string;
  attempts: number;
  maxAttempts: number;
  reuseScene: boolean;
}

export function heartbeat(jobId: string): void {
  db()
    .prepare("UPDATE analysis_jobs SET lease_expires_at = ?, updated_at = ? WHERE id = ?")
    .run(new Date(Date.now() + LEASE_MS).toISOString(), nowIso(), jobId);
}

export function setStage(jobId: string, stage: JobStatus): void {
  db()
    .prepare("UPDATE analysis_jobs SET status = ?, stage = ?, updated_at = ? WHERE id = ?")
    .run(stage, stage, nowIso(), jobId);
  heartbeat(jobId);
}

export function releaseJob(jobId: string): void {
  db().prepare("UPDATE analysis_jobs SET lease_owner = NULL, lease_expires_at = NULL WHERE id = ?").run(jobId);
}
