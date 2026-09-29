import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Fila de captura de comentários. O defeito que motiva estes testes: o
 * `INSERT OR IGNORE` prometia ignorar vídeo já pedido, mas sem índice único não
 * havia o que ignorar — dois cliques em "Capturar comentários" deixaram 196
 * pedidos para 98 vídeos no banco do usuário.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shortcta-capture-"));

let dbMod: typeof import("../src/lib/db");
let repo: typeof import("../src/lib/repo");

function linha(id: string, videoId: string, status: string, minuto: number) {
  const t = `2026-09-27T18:${String(minuto).padStart(2, "0")}:00.000Z`;
  return [id, videoId, `https://www.tiktok.com/@x/video/${videoId}`, status, t, t];
}

beforeAll(async () => {
  // Banco no formato antigo: a fila sem o índice único e com o mesmo vídeo
  // pedido duas vezes — exatamente o estado encontrado em produção.
  const legado = new Database(path.join(tmpDir, "short-cta-ai.db"));
  legado.exec(`CREATE TABLE capture_queue (
    id TEXT PRIMARY KEY, video_id TEXT NOT NULL, url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT)`);
  const ins = legado.prepare(
    "INSERT INTO capture_queue (id, video_id, url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  ins.run(...linha("cq_antigo", "vid_a", "pending", 34));
  ins.run(...linha("cq_repetido", "vid_a", "pending", 35));
  ins.run(...linha("cq_historico", "vid_a", "done", 10));
  ins.run(...linha("cq_outro", "vid_b", "pending", 34));
  legado.close();

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

function ids(videoId: string, status?: string): string[] {
  const rows = dbMod
    .db()
    .prepare(
      `SELECT id FROM capture_queue WHERE video_id = ? ${status ? "AND status = ?" : ""} ORDER BY id`,
    )
    .all(...(status ? [videoId, status] : [videoId])) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

let seq = 0;
function makeVideo(): string {
  const name = `c${++seq}`;
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

describe("migração de bancos antigos", () => {
  it("remove o pedido repetido e mantém o mais antigo", () => {
    expect(ids("vid_a", "pending")).toEqual(["cq_antigo"]);
  });

  it("não mexe no histórico de pedidos já concluídos", () => {
    expect(ids("vid_a", "done")).toEqual(["cq_historico"]);
  });

  it("não mexe em pedido de outro vídeo", () => {
    expect(ids("vid_b")).toEqual(["cq_outro"]);
  });
});

describe("pedir captura", () => {
  it("pedir o mesmo vídeo duas vezes deixa um pedido só", () => {
    const video = makeVideo();
    const item = { videoId: video, url: "https://www.tiktok.com/@x/video/1" };

    expect(repo.addToCaptureQueue([item])).toBe(1);
    expect(repo.addToCaptureQueue([item])).toBe(0);
    expect(ids(video)).toHaveLength(1);
  });

  it("o mesmo vídeo repetido dentro de um lote conta uma vez", () => {
    const video = makeVideo();
    const item = { videoId: video, url: "https://www.tiktok.com/@x/video/2" };

    expect(repo.addToCaptureQueue([item, item, item])).toBe(1);
  });

  it("depois de concluído, o vídeo pode ser pedido de novo", () => {
    const video = makeVideo();
    const item = { videoId: video, url: "https://www.tiktok.com/@x/video/3" };
    repo.addToCaptureQueue([item]);
    const [id] = ids(video);

    repo.completeCaptureQueueItem(id);

    // Uma captura nova é um pedido legítimo: os comentários mudam com o tempo.
    expect(repo.addToCaptureQueue([item])).toBe(1);
  });

  it("um erro que ainda pode ser tentado continua ocupando o lugar do vídeo", () => {
    const video = makeVideo();
    const item = { videoId: video, url: "https://www.tiktok.com/@x/video/4" };
    repo.addToCaptureQueue([item]);
    repo.failCaptureQueueItem(ids(video)[0]);

    // Primeira falha devolve o pedido para 'pending': não entra outro.
    expect(repo.addToCaptureQueue([item])).toBe(0);
  });
});
