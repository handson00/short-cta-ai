import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Excluir da Fila não apaga o histórico de Exportações (HISTORICO §47).
 *
 * Banco e pastas numa área temporária: nada encosta em data/.
 */

vi.mock("../src/lib/auth", () => ({ isAuthenticated: async () => true, guardApi: async () => null }));

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shortcta-historico-"));

let dbMod: typeof import("../src/lib/db");
let repo: typeof import("../src/lib/repo");
let editorRepo: typeof import("../src/lib/editorRepo");
let queue: typeof import("../src/lib/queue");
let remocao: typeof import("../src/lib/videoRemoval");
let envMod: typeof import("../src/lib/env");
let listaRoute: typeof import("../src/app/api/exports/route");
let historicoRoute: typeof import("../src/app/api/exports/[jobId]/route");
let bulkRoute: typeof import("../src/app/api/videos/bulk-delete/route");

beforeAll(async () => {
  process.env.DATA_DIR = tmpDir;
  process.env.DATABASE_PATH = path.join(tmpDir, "teste.db");
  process.env.EDITOR_OUTPUT_DIR = path.join(tmpDir, "saida");
  vi.resetModules();
  dbMod = await import("../src/lib/db");
  repo = await import("../src/lib/repo");
  editorRepo = await import("../src/lib/editorRepo");
  queue = await import("../src/lib/queue");
  remocao = await import("../src/lib/videoRemoval");
  envMod = await import("../src/lib/env");
  listaRoute = await import("../src/app/api/exports/route");
  historicoRoute = await import("../src/app/api/exports/[jobId]/route");
  bulkRoute = await import("../src/app/api/videos/bulk-delete/route");
  dbMod.db();
});

afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Windows pode segurar o banco; a pasta é temporária.
  }
});

/** Um vídeo da Fila com arquivo enviado, miniatura, artefatos e dados de publicação. */
function videoNaFila(nome: string) {
  const upload = path.join(tmpDir, `${nome}.mp4`);
  fs.writeFileSync(upload, Buffer.alloc(1000));
  const v = repo.createVideo({
    originalName: `${nome}.mp4`,
    storedName: `${nome}.mp4`,
    path: upload,
    hash: `hash_${nome}`,
    bytes: 1000,
    mime: "video/mp4",
  });
  const artefatos = path.join(envMod.env.artifactsDir, v.id);
  fs.mkdirSync(artefatos, { recursive: true });
  const thumb = path.join(artefatos, "thumb.jpg");
  fs.writeFileSync(thumb, "jpg");
  fs.writeFileSync(path.join(artefatos, "audio.wav"), Buffer.alloc(5000));
  dbMod.db().prepare("UPDATE videos SET thumbnail_path = ? WHERE id = ?").run(thumb, v.id);

  editorRepo.addVideosToEditor([v.id]);
  editorRepo.setVideoTextOverride(v.id, "MEU CTA PRÓPRIO");
  repo.saveCaptions(v.id, { pt: "Legenda guardada" });
  repo.saveVideoHashtags(v.id, { doVideo: ["#filme"], nosComentarios: [], todas: [] });
  return { id: v.id, upload, thumb, artefatos };
}

/** Uma exportação concluída do vídeo, com o MP4 na pasta de saída. */
function exportar(videoId: string, nome: string): { jobId: string; mp4: string } {
  const mp4 = path.join(tmpDir, `${nome}_editado.mp4`);
  fs.writeFileSync(mp4, Buffer.alloc(2000));
  const job = editorRepo.createEditorJob({ videoId });
  dbMod
    .db()
    .prepare("UPDATE editor_jobs SET status = 'completed', progress = 100, output_path = ?, completed_at = ? WHERE id = ?")
    .run(mp4, new Date().toISOString(), job.id);
  return { jobId: job.id, mp4 };
}

async function historico() {
  const corpo = await (await listaRoute.GET()).json();
  return corpo.exports as Array<{ jobId: string; videoId: string; cta: string; ptCaption: string; archivedAt: string | null }>;
}

const naFila = (id: string) => repo.listVideos().some((v) => v.id === id);
const existe = (id: string) => repo.getVideo(id) !== null;

function removerDoHistorico(jobId: string, apagarArquivo = false) {
  return historicoRoute.DELETE(
    new Request(`http://localhost:3000/api/exports/${jobId}${apagarArquivo ? "?apagarArquivo=1" : ""}`, { method: "DELETE" }),
    { params: Promise.resolve({ jobId }) },
  );
}

describe("excluir da Fila", () => {
  it("vídeo sem exportação é apagado de vez, como sempre foi", () => {
    const v = videoNaFila("sem_export");
    expect(remocao.tirarDaFila(v.id)).toBe("apagado");
    expect(existe(v.id)).toBe(false);
    expect(fs.existsSync(v.upload)).toBe(false);
    expect(fs.existsSync(v.artefatos)).toBe(false);
  });

  it("vídeo com exportação sai da Fila e do Editor, mas fica no histórico com os dados", async () => {
    const v = videoNaFila("com_export");
    const e = exportar(v.id, "com_export");

    expect(remocao.tirarDaFila(v.id)).toBe("arquivado");

    expect(naFila(v.id)).toBe(false);
    expect(editorRepo.listEditorVideoIds()).not.toContain(v.id);
    expect(dbMod.db().prepare("SELECT 1 FROM editor_videos WHERE video_id = ?").get(v.id)).toBeUndefined();

    const item = (await historico()).find((x) => x.jobId === e.jobId);
    expect(item).toBeDefined();
    expect(item!.archivedAt).not.toBeNull();
    // O CTA do histórico continua sendo o texto próprio do editor.
    expect(item!.cta).toBe("MEU CTA PRÓPRIO");
    expect(item!.ptCaption).toBe("Legenda guardada");
    expect(fs.existsSync(e.mp4)).toBe(true);
  });

  it("o arquivado perde o que pesa, mas a capa fica", () => {
    const v = videoNaFila("arquivos");
    exportar(v.id, "arquivos");
    remocao.tirarDaFila(v.id);
    expect(fs.existsSync(v.upload)).toBe(false);
    expect(fs.existsSync(path.join(v.artefatos, "audio.wav"))).toBe(false);
    expect(fs.existsSync(v.thumb)).toBe(true);
  });

  it("reimportar o mesmo arquivo vira um vídeo novo, não um 'duplicado' invisível", () => {
    const v = videoNaFila("reimporte");
    exportar(v.id, "reimporte");
    remocao.tirarDaFila(v.id);
    expect(repo.findVideoByHash("hash_reimporte")).toBeNull();
  });

  it("o arquivado com erro de análise não entra no 'Terminar os N com erro' nem na contagem", () => {
    const v = videoNaFila("com_erro");
    exportar(v.id, "com_erro");
    const job = repo.createJob(v.id);
    dbMod.db().prepare("UPDATE analysis_jobs SET status = 'error', error_code = 'quota_exhausted' WHERE id = ?").run(job.id);
    expect(repo.listFailedVideos().map((f) => f.id)).toContain(v.id);
    const errosAntes = queue.queueCounts().error ?? 0;

    remocao.tirarDaFila(v.id);
    expect(repo.listFailedVideos().map((f) => f.id)).not.toContain(v.id);
    expect(queue.queueCounts().error ?? 0).toBe(errosAntes - 1);
  });

  it("a exclusão em lote diz quais foram para o histórico", async () => {
    const a = videoNaFila("lote_a");
    const b = videoNaFila("lote_b");
    exportar(b.id, "lote_b");
    const res = await bulkRoute.POST(
      new Request("http://localhost:3000/api/videos/bulk-delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [a.id, b.id] }),
      }),
    );
    const corpo = await res.json();
    expect(corpo.deleted).toEqual([a.id, b.id]);
    expect(corpo.archived).toEqual([b.id]);
    expect(existe(a.id)).toBe(false);
    expect(existe(b.id)).toBe(true);
  });
});

describe("remover do histórico", () => {
  it("vídeo ainda na Fila: some do histórico, continua na Fila, e o MP4 fica por padrão", async () => {
    const v = videoNaFila("ativo");
    const e = exportar(v.id, "ativo");
    const res = await removerDoHistorico(e.jobId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ arquivoApagado: false, videoApagado: false });
    expect((await historico()).some((x) => x.jobId === e.jobId)).toBe(false);
    expect(naFila(v.id)).toBe(true);
    expect(fs.existsSync(e.mp4)).toBe(true);
  });

  it("apaga o MP4 da pasta só quando pedido", async () => {
    const v = videoNaFila("apagar_mp4");
    const e = exportar(v.id, "apagar_mp4");
    const corpo = await (await removerDoHistorico(e.jobId, true)).json();
    expect(corpo.arquivoApagado).toBe(true);
    expect(fs.existsSync(e.mp4)).toBe(false);
  });

  it("arquivado com duas exportações: a primeira sai, o vídeo fica; a última sai, o vídeo sai de vez", async () => {
    const v = videoNaFila("duas");
    const e1 = exportar(v.id, "duas_1");
    const e2 = exportar(v.id, "duas_2");
    remocao.tirarDaFila(v.id);

    expect((await (await removerDoHistorico(e1.jobId)).json()).videoApagado).toBe(false);
    expect(existe(v.id)).toBe(true);

    expect((await (await removerDoHistorico(e2.jobId)).json()).videoApagado).toBe(true);
    expect(existe(v.id)).toBe(false);
    expect(fs.existsSync(v.thumb)).toBe(false);
    // O MP4 continua: só o pedido explícito apaga.
    expect(fs.existsSync(e2.mp4)).toBe(true);
  });

  it("exportação que não está no histórico responde 404", async () => {
    expect((await removerDoHistorico("ejb_nao_existe")).status).toBe(404);
  });
});
