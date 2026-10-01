import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * "Analisar novamente" em lote. O defeito que isto trava: a rota criava um job
 * novo mesmo com o vídeo já em análise, e dois jobs do mesmo vídeo rodavam
 * juntos sobre os mesmos arquivos — um duplo clique no lote faria isso com
 * dezenas de vídeos.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shortcta-reanalysis-"));

let dbMod: typeof import("../src/lib/db");
let repo: typeof import("../src/lib/repo");

beforeAll(async () => {
  process.env.DATA_DIR = tmpDir;
  process.env.TRANSCRIPTION_PROVIDER = "none";
  process.env.VISION_PROVIDER = "none";
  dbMod = await import("../src/lib/db");
  repo = await import("../src/lib/repo");
  dbMod.db();
});

afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // No Windows o SQLite pode segurar os arquivos WAL; a pasta fica no %TEMP%.
  }
});

let seq = 0;
function makeVideo(): string {
  const name = `r${++seq}`;
  const filePath = path.join(tmpDir, `${name}.mp4`);
  fs.writeFileSync(filePath, "conteudo ficticio");
  return repo.createVideo({
    originalName: `${name}.mp4`,
    storedName: `${name}.mp4`,
    path: filePath,
    hash: `hash_${name}_${Math.random()}`,
    bytes: 17,
    mime: "video/mp4",
  }).id;
}

function openJobs(videoId: string): number {
  return (
    dbMod
      .db()
      .prepare("SELECT COUNT(*) AS n FROM analysis_jobs WHERE video_id = ? AND status NOT IN ('done','error','canceled')")
      .get(videoId) as { n: number }
  ).n;
}

describe("reanálise em lote", () => {
  it("enfileira os vídeos já analisados", () => {
    const a = makeVideo();
    const b = makeVideo();
    for (const id of [a, b]) repo.setJobStatus(repo.createJob(id).id, "done");

    const result = repo.requestReanalysis([a, b]);
    expect(result.queued).toEqual([a, b]);
    expect(repo.latestJob(a)?.status).toBe("queued");
    expect(repo.latestJob(a)?.reuseScene).toBe(false);
  });

  it("pula o vídeo que já está na fila ou em análise, com o motivo", () => {
    const naFila = makeVideo();
    repo.createJob(naFila);
    const emAnalise = makeVideo();
    repo.setJobStatus(repo.createJob(emAnalise).id, "transcribing");

    const result = repo.requestReanalysis([naFila, emAnalise]);
    expect(result.queued).toEqual([]);
    expect(result.skipped.map((s) => s.reason)).toEqual(["Já está na fila de análise.", "Já está na fila de análise."]);
    expect(openJobs(naFila)).toBe(1);
    expect(openJobs(emAnalise)).toBe(1);
  });

  it("duplo clique não enfileira duas vezes", () => {
    const id = makeVideo();
    repo.setJobStatus(repo.createJob(id).id, "error");
    repo.requestReanalysis([id]);
    const segundo = repo.requestReanalysis([id]);
    expect(segundo.queued).toEqual([]);
    expect(openJobs(id)).toBe(1);
  });

  it("id repetido na mesma lista conta uma vez", () => {
    const id = makeVideo();
    repo.setJobStatus(repo.createJob(id).id, "done");
    expect(repo.requestReanalysis([id, id]).queued).toEqual([id]);
    expect(openJobs(id)).toBe(1);
  });

  it("vídeo inexistente é relatado, não ignorado em silêncio", () => {
    const result = repo.requestReanalysis(["vid_nao_existe"]);
    expect(result.skipped).toEqual([{ id: "vid_nao_existe", reason: "Vídeo não encontrado." }]);
  });
});
