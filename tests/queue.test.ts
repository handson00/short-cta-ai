import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Teste de durabilidade da fila: o critério de aceite exige que jobs sejam
 * retomados ou registrados adequadamente depois de um reinício do worker.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shortcta-queue-"));

let db: typeof import("../src/lib/db");
let repo: typeof import("../src/lib/repo");
let queue: typeof import("../src/lib/queue");

beforeAll(async () => {
  process.env.DATA_DIR = tmpDir;
  process.env.TRANSCRIPTION_PROVIDER = "none";
  process.env.VISION_PROVIDER = "none";
  db = await import("../src/lib/db");
  repo = await import("../src/lib/repo");
  queue = await import("../src/lib/queue");
  db.db();
});

afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // No Windows a remocao pode falhar com EPERM enquanto o SQLite ainda
    // segura os arquivos WAL; a pasta fica no %TEMP% e e inofensiva.
  }
});

function makeVideo(name: string) {
  const filePath = path.join(tmpDir, `${name}.mp4`);
  fs.writeFileSync(filePath, "conteudo ficticio");
  return repo.createVideo({
    originalName: `${name}.mp4`,
    storedName: `${name}.mp4`,
    path: filePath,
    hash: `hash_${name}_${Math.random()}`,
    bytes: 17,
    mime: "video/mp4",
  });
}

/** Esvazia a fila para que um teste não dependa do que outro deixou para trás. */
function drain() {
  db.db().prepare("UPDATE analysis_jobs SET status = 'canceled' WHERE status = 'queued'").run();
}

function expireLease(jobId: string) {
  db.db()
    .prepare("UPDATE analysis_jobs SET lease_expires_at = ? WHERE id = ?")
    .run(new Date(Date.now() - 60_000).toISOString(), jobId);
}

describe("fila persistente", () => {
  it("entrega um job por vez e não devolve o mesmo duas vezes", () => {
    drain();
    const video = makeVideo("a");
    repo.createJob(video.id);

    const first = queue.claimNextJob();
    expect(first?.videoId).toBe(video.id);
    expect(first?.attempts).toBe(1);

    const again = queue.claimNextJob();
    expect(again).toBeNull();
  });

  it("devolve à fila um job cujo worker morreu", () => {
    drain();
    const video = makeVideo("b");
    const job = repo.createJob(video.id);
    const claimed = queue.claimNextJob();
    expect(claimed?.id).toBe(job.id);

    expireLease(job.id);
    const recovery = queue.recoverStaleJobs();
    expect(recovery.requeued).toBeGreaterThanOrEqual(1);
    expect(repo.getJob(job.id)?.status).toBe("queued");
  });

  it("marca erro explícito quando as tentativas se esgotam", () => {
    drain();
    const video = makeVideo("c");
    const job = repo.createJob(video.id);

    for (let i = 0; i < 3; i += 1) {
      const claimed = queue.claimNextJob();
      expect(claimed?.id).toBe(job.id);
      expireLease(job.id);
      queue.recoverStaleJobs();
    }

    const finished = repo.getJob(job.id);
    expect(finished?.status).toBe("error");
    expect(finished?.errorCode).toBe("worker_restart");
    // Erro registrado continua recuperável pelo usuário, não some da interface.
    expect(finished?.retryable).toBe(true);
  });

  it("cancela um item que ainda não começou", () => {
    drain();
    const video = makeVideo("d");
    const job = repo.createJob(video.id);
    expect(repo.requestCancel(video.id)).toBe(true);
    expect(repo.getJob(job.id)?.status).toBe("canceled");
    // Cancelado não volta a ser reivindicado.
    const claimed = queue.claimNextJob();
    expect(claimed?.id).not.toBe(job.id);
  });

  it("sinaliza cancelamento para um job em andamento", () => {
    drain();
    const video = makeVideo("e");
    const job = repo.createJob(video.id);
    queue.claimNextJob();
    expect(repo.requestCancel(video.id)).toBe(true);
    expect(repo.isCancelRequested(job.id)).toBe(true);
  });

  it("a varredura periódica recupera um job cujo lease venceu sem reinício", () => {
    drain();
    const video = makeVideo("g");
    const job = repo.createJob(video.id);
    queue.claimNextJob();
    expect(repo.getJob(job.id)?.status).toBe("extracting_media");

    // Nenhum reinício acontece aqui: só o tempo do lease passando.
    expireLease(job.id);
    expect(queue.recoverStaleJobs().requeued).toBe(1);
    expect(repo.getJob(job.id)?.status).toBe("queued");
  });

  it("dedupe por hash encontra o vídeo já importado", () => {
    const video = makeVideo("f");
    expect(repo.findVideoByHash(video.hash)?.id).toBe(video.id);
  });
});
