import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Fila de exportação do editor, contra um banco SQLite de verdade numa pasta
 * temporária. Dois defeitos reais motivam estes testes: a hora de início sendo
 * reescrita a cada atualização de progresso, e a exportação ignorando o
 * template aplicado a cada vídeo.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shortcta-editor-jobs-"));

let dbMod: typeof import("../src/lib/db");
let repo: typeof import("../src/lib/repo");
let editorRepo: typeof import("../src/lib/editorRepo");
let queue: typeof import("../src/lib/editor/exportQueue");
let exporter: typeof import("../src/lib/editor/export");
let templateMod: typeof import("../src/lib/editor/template");

beforeAll(async () => {
  process.env.DATA_DIR = tmpDir;
  process.env.TRANSCRIPTION_PROVIDER = "none";
  process.env.VISION_PROVIDER = "none";
  dbMod = await import("../src/lib/db");
  repo = await import("../src/lib/repo");
  editorRepo = await import("../src/lib/editorRepo");
  queue = await import("../src/lib/editor/exportQueue");
  exporter = await import("../src/lib/editor/export");
  templateMod = await import("../src/lib/editor/template");
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
  const name = `v${++seq}`;
  const filePath = path.join(tmpDir, `${name}.mp4`);
  fs.writeFileSync(filePath, "conteudo ficticio");
  const video = repo.createVideo({
    originalName: `${name}.mp4`,
    storedName: `${name}.mp4`,
    path: filePath,
    hash: `hash_${name}_${Math.random()}`,
    bytes: 17,
    mime: "video/mp4",
  });
  editorRepo.addVideosToEditor([video.id]);
  return video.id;
}

function clearJobs() {
  dbMod.db().prepare("DELETE FROM editor_jobs").run();
}

function job(id: string) {
  return editorRepo.getEditorJob(id)!;
}

describe("fila de exportação no banco", () => {
  it("o claim pega o job mais antigo e o marca como em processamento", () => {
    clearJobs();
    const a = editorRepo.createEditorJob({ videoId: makeVideo() });
    editorRepo.createEditorJob({ videoId: makeVideo() });

    const claimed = editorRepo.claimNextEditorJob();
    expect(claimed?.id).toBe(a.id);
    expect(job(a.id).status).toBe("processing");
    expect(job(a.id).startedAt).not.toBeNull();
  });

  it("dois claims seguidos nunca pegam o mesmo job", () => {
    clearJobs();
    editorRepo.createEditorJob({ videoId: makeVideo() });
    editorRepo.createEditorJob({ videoId: makeVideo() });

    const first = editorRepo.claimNextEditorJob();
    const second = editorRepo.claimNextEditorJob();
    expect(first?.id).toBeDefined();
    expect(second?.id).toBeDefined();
    expect(first?.id).not.toBe(second?.id);
    expect(editorRepo.claimNextEditorJob()).toBeNull();
  });

  it("a hora de início não é reescrita pelas atualizações seguintes", () => {
    clearJobs();
    const j = editorRepo.createEditorJob({ videoId: makeVideo() });
    editorRepo.claimNextEditorJob();
    const antiga = "2020-01-01T00:00:00.000Z";
    dbMod.db().prepare("UPDATE editor_jobs SET started_at = ? WHERE id = ?").run(antiga, j.id);

    // Com o COALESCE invertido, esta chamada trocava a hora de início por "agora".
    editorRepo.updateEditorJobStatus(j.id, "processing", { progress: 50 });
    editorRepo.updateEditorJobStatus(j.id, "completed", { progress: 100, outputPath: "x.mp4" });

    expect(job(j.id).startedAt).toBe(antiga);
    expect(job(j.id).completedAt).not.toBeNull();
  });

  it("progresso atrasado não ressuscita um job cancelado", () => {
    clearJobs();
    const j = editorRepo.createEditorJob({ videoId: makeVideo() });
    editorRepo.claimNextEditorJob();
    editorRepo.updateEditorJobStatus(j.id, "cancelled", { errorMessage: "Cancelado pelo usuário." });

    editorRepo.updateEditorJobProgress(j.id, 73);

    expect(job(j.id).status).toBe("cancelled");
    expect(job(j.id).progress).not.toBe(73);
  });

  it("cancelar pendentes não toca no job que já está renderizando", () => {
    clearJobs();
    const rodando = editorRepo.createEditorJob({ videoId: makeVideo() });
    const esperando = editorRepo.createEditorJob({ videoId: makeVideo() });
    editorRepo.claimNextEditorJob();

    expect(editorRepo.cancelAllPendingEditorJobs()).toBe(1);
    expect(job(rodando.id).status).toBe("processing");
    expect(job(esperando.id).status).toBe("cancelled");
  });

  it("jobs interrompidos por um reinício voltam para a fila (§112)", () => {
    clearJobs();
    const j = editorRepo.createEditorJob({ videoId: makeVideo() });
    editorRepo.claimNextEditorJob();
    editorRepo.updateEditorJobProgress(j.id, 40);

    expect(editorRepo.requeueInterruptedEditorJobs()).toBe(1);
    expect(job(j.id).status).toBe("pending");
    expect(job(j.id).progress).toBe(0);
    expect(job(j.id).startedAt).toBeNull();
  });
});

describe("template usado na exportação", () => {
  it("cada vídeo sai com o template aplicado a ele, não com o do painel", () => {
    clearJobs();
    const aplicado = editorRepo.createEditorTemplate("aplicado", templateMod.DEFAULT_TEMPLATE);
    const painel = editorRepo.createEditorTemplate("painel", templateMod.DEFAULT_TEMPLATE);
    const video = makeVideo();
    editorRepo.setVideoTemplate([video], aplicado.id);

    const r = queue.enqueueExports([video], { fallbackTemplateId: painel.id });

    expect(r.jobIds).toHaveLength(1);
    expect(job(r.jobIds[0]).templateId).toBe(aplicado.id);
    expect(r.byTemplate).toEqual({ [aplicado.id]: 1 });
  });

  it("vídeo sem template aplicado usa o do painel", () => {
    clearJobs();
    const painel = editorRepo.createEditorTemplate("painel", templateMod.DEFAULT_TEMPLATE);
    const video = makeVideo();

    const r = queue.enqueueExports([video], { fallbackTemplateId: painel.id });

    expect(job(r.jobIds[0]).templateId).toBe(painel.id);
  });

  it("um lote misto sai com o template certo em cada vídeo", () => {
    clearJobs();
    const a = editorRepo.createEditorTemplate("A", templateMod.DEFAULT_TEMPLATE);
    const b = editorRepo.createEditorTemplate("B", templateMod.DEFAULT_TEMPLATE);
    const comA = makeVideo();
    const semNenhum = makeVideo();
    editorRepo.setVideoTemplate([comA], a.id);

    const r = queue.enqueueExports([comA, semNenhum], { fallbackTemplateId: b.id });

    expect(r.byTemplate).toEqual({ [a.id]: 1, [b.id]: 1 });
  });

  it("vídeo sem template e sem reserva fica de fora, em vez de sair sem template", () => {
    clearJobs();
    const video = makeVideo();

    const r = queue.enqueueExports([video], {});

    expect(r.jobIds).toHaveLength(0);
    expect(r.skipped).toEqual([video]);
  });

  it("a resolução gravada no job é a do canvas do template", () => {
    clearJobs();
    const t = editorRepo.createEditorTemplate("720p", {
      ...templateMod.DEFAULT_TEMPLATE,
      canvasWidth: 720,
      canvasHeight: 1280,
      videoY: 280,
      videoWidth: 720,
      videoHeight: 720,
    });
    const video = makeVideo();
    editorRepo.setVideoTemplate([video], t.id);

    const r = queue.enqueueExports([video]);

    expect(job(r.jobIds[0]).exportSettings.width).toBe(720);
    expect(job(r.jobIds[0]).exportSettings.height).toBe(1280);
  });
});

describe("camada de texto no job", () => {
  const layerFor = (videoId: string) => `txt_${videoId}_0123456789abcdef.png`;

  it("grava a camada do vídeo quando o template tem texto ligado", () => {
    clearJobs();
    const t = editorRepo.createEditorTemplate("com texto", {
      ...templateMod.DEFAULT_TEMPLATE,
      text: templateMod.DEFAULT_TEXT_STYLE,
    });
    const video = makeVideo();
    editorRepo.setVideoTemplate([video], t.id);

    const r = queue.enqueueExports([video], { textLayers: { [video]: layerFor(video) } });

    expect(job(r.jobIds[0]).exportSettings.textLayer).toBe(layerFor(video));
  });

  it("ignora a camada quando o template não mostra texto", () => {
    clearJobs();
    const t = editorRepo.createEditorTemplate("sem texto", templateMod.DEFAULT_TEMPLATE);
    const video = makeVideo();
    editorRepo.setVideoTemplate([video], t.id);

    const r = queue.enqueueExports([video], { textLayers: { [video]: layerFor(video) } });

    expect(job(r.jobIds[0]).exportSettings.textLayer).toBeNull();
  });

  it("recusa a camada de outro vídeo ou com nome fora do padrão", () => {
    clearJobs();
    const t = editorRepo.createEditorTemplate("com texto", {
      ...templateMod.DEFAULT_TEMPLATE,
      text: templateMod.DEFAULT_TEXT_STYLE,
    });
    const a = makeVideo();
    const b = makeVideo();
    editorRepo.setVideoTemplate([a, b], t.id);

    const r = queue.enqueueExports([a, b], {
      textLayers: { [a]: layerFor(b), [b]: "../../segredo.png" },
    });

    expect(job(r.jobIds[0]).exportSettings.textLayer).toBeNull();
    expect(job(r.jobIds[1]).exportSettings.textLayer).toBeNull();
  });

  it("camada de job pendente fica protegida da limpeza; a de job concluído não", () => {
    clearJobs();
    const t = editorRepo.createEditorTemplate("com texto", {
      ...templateMod.DEFAULT_TEMPLATE,
      text: templateMod.DEFAULT_TEXT_STYLE,
    });
    const pendente = makeVideo();
    const concluido = makeVideo();
    editorRepo.setVideoTemplate([pendente, concluido], t.id);
    const r = queue.enqueueExports([pendente, concluido], {
      textLayers: { [pendente]: layerFor(pendente), [concluido]: layerFor(concluido) },
    });
    editorRepo.updateEditorJobStatus(r.jobIds[1], "completed", { progress: 100 });

    const emUso = editorRepo.textLayerFilesInUse();
    expect(emUso.has(layerFor(pendente))).toBe(true);
    expect(emUso.has(layerFor(concluido))).toBe(false);
  });
});

describe("texto próprio do vídeo", () => {
  it("grava, e texto vazio volta ao CTA da análise", () => {
    const video = makeVideo();
    const ler = () =>
      (dbMod.db().prepare("SELECT text FROM editor_video_texts WHERE video_id = ?").get(video) as
        | { text: string }
        | undefined)?.text ?? null;

    editorRepo.setVideoTextOverride(video, "  Você faria o mesmo?  ");
    expect(ler()).toBe("Você faria o mesmo?");

    editorRepo.setVideoTextOverride(video, "   ");
    expect(ler()).toBeNull();
  });
});

describe("nome do arquivo de saída (§110)", () => {
  it("usa _editado e, se existir, _editado_2", () => {
    const dir = fs.mkdtempSync(path.join(tmpDir, "out-"));
    const primeiro = exporter.uniqueOutputPath(dir, "corte.mp4");
    expect(path.basename(primeiro)).toBe("corte_editado.mp4");

    fs.writeFileSync(primeiro, "x");
    expect(path.basename(exporter.uniqueOutputPath(dir, "corte.mp4"))).toBe("corte_editado_2.mp4");
  });

  it("um .processing em andamento conta como ocupado", () => {
    // Com dois exports em paralelo do mesmo vídeo, o segundo escolheria o
    // mesmo nome enquanto o primeiro ainda está renderizando.
    const dir = fs.mkdtempSync(path.join(tmpDir, "out-"));
    fs.writeFileSync(path.join(dir, "corte_editado.mp4.processing"), "");
    expect(path.basename(exporter.uniqueOutputPath(dir, "corte.mp4"))).toBe("corte_editado_2.mp4");
  });
});
