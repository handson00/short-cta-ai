import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Página de Exportações e a pasta de saída configurável.
 *
 * Banco e pastas numa área temporária: nada encosta em data/.
 */

vi.mock("../src/lib/auth", () => ({ isAuthenticated: async () => true, guardApi: async () => null }));

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shortcta-exports-"));

let dbMod: typeof import("../src/lib/db");
let repo: typeof import("../src/lib/repo");
let editorRepo: typeof import("../src/lib/editorRepo");
let settings: typeof import("../src/lib/settings");
let outputDirMod: typeof import("../src/lib/editor/outputDir");
let route: typeof import("../src/app/api/exports/route");
let media: typeof import("../src/app/api/exports/[jobId]/media/route");

beforeAll(async () => {
  process.env.DATA_DIR = tmpDir;
  process.env.DATABASE_PATH = path.join(tmpDir, "teste.db");
  process.env.EDITOR_OUTPUT_DIR = path.join(tmpDir, "saida-padrao");
  vi.resetModules();
  dbMod = await import("../src/lib/db");
  repo = await import("../src/lib/repo");
  editorRepo = await import("../src/lib/editorRepo");
  settings = await import("../src/lib/settings");
  outputDirMod = await import("../src/lib/editor/outputDir");
  route = await import("../src/app/api/exports/route");
  media = await import("../src/app/api/exports/[jobId]/media/route");
  dbMod.db();
});

afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Windows pode segurar o banco; a pasta é temporária.
  }
});

// -------------------------- Pasta configurável ------------------------------

describe("pasta dos vídeos exportados", () => {
  it("vazio = a pasta padrão", () => {
    settings.saveSettings({ paths: { outputDir: "" } });
    expect(outputDirMod.outputDir()).toBe(path.join(tmpDir, "saida-padrao"));
    expect(outputDirMod.validateOutputDir("")).toBeNull();
  });

  it("configurada, vence a padrão — e é criada se não existir", () => {
    const wanted = path.join(tmpDir, "minha-pasta", "prontos");
    expect(outputDirMod.validateOutputDir(wanted)).toBeNull();
    expect(fs.existsSync(wanted)).toBe(true);
    settings.saveSettings({ paths: { outputDir: wanted } });
    expect(outputDirMod.outputDir()).toBe(wanted);
  });

  it("caminho relativo é recusado com instrução, não aceito em silêncio", () => {
    expect(outputDirMod.validateOutputDir("videos/prontos")).toMatch(/caminho completo/i);
  });

  it("caminho que é um arquivo é recusado", () => {
    const file = path.join(tmpDir, "um-arquivo.txt");
    fs.writeFileSync(file, "x");
    expect(outputDirMod.validateOutputDir(file)).toMatch(/arquivo, não uma pasta/i);
  });

  it("espaços em volta não viram uma pasta diferente", () => {
    const wanted = path.join(tmpDir, "com-espaco");
    fs.mkdirSync(wanted, { recursive: true });
    const saved = settings.saveSettings({ paths: { outputDir: `  ${wanted}  ` } });
    expect(saved.paths.outputDir).toBe(wanted);
  });
});

// ------------------------------- A página -----------------------------------

function video(name: string): string {
  const file = path.join(tmpDir, `${name}.mp4`);
  fs.writeFileSync(file, "x");
  const v = repo.createVideo({
    originalName: `${name}.mp4`,
    storedName: `${name}.mp4`,
    path: file,
    hash: `h_${name}`,
    bytes: 1,
    mime: "video/mp4",
  });
  editorRepo.addVideosToEditor([v.id]);
  return v.id;
}

/** Um job concluído apontando para um arquivo de saída de verdade. */
function completed(videoId: string, outName: string, completedAt: string): string {
  const out = path.join(tmpDir, outName);
  fs.writeFileSync(out, Buffer.alloc(2_000_000));
  const job = editorRepo.createEditorJob({ videoId });
  dbMod
    .db()
    .prepare("UPDATE editor_jobs SET status = 'completed', progress = 100, output_path = ?, completed_at = ? WHERE id = ?")
    .run(out, completedAt, job.id);
  return job.id;
}

async function listar() {
  const res = await route.GET();
  return (await res.json()) as {
    exports: Array<Record<string, unknown>>;
    outputDir: string;
    sessionStartedAt: string | null;
  };
}

describe("rota da página de Exportações", () => {
  it("traz só os concluídos, com o texto e as hashtags para publicar", async () => {
    const id = video("pronto");
    const analysisId = repo.saveSceneAnalysis(
      id,
      {
        sceneSummary: "Um homem foge de casa.",
        plot: "Ele inventou uma máquina do tempo.",
        keyLines: [],
        analysisLimitations: [],
        conflict: null,
        curiosity: null,
        withhold: null,
        speculation: [],
        existingCta: null,
        work: null,
      },
      { promptVersion: "teste", model: "m" },
    );
    repo.replaceSuggestions(id, analysisId, [
      { text: "🔥 ELE INVENTOU UMA MÁQUINA DO TEMPO", style: "curiosidade", isRecommended: true },
    ]);
    repo.saveTranscript(id, {
      provider: "teste",
      language: "pt",
      text: "eu vou consertar tudo",
      segments: [{ start: 0, end: 2, text: "eu vou consertar tudo" }],
      hasSpeech: true,
      lowConfidence: false,
      warnings: [],
    });
    repo.saveVideoHashtags(id, { doVideo: ["#filme", "#cenasdefilme"], nosComentarios: [], todas: [] });
    completed(id, "pronto_editado.mp4", new Date().toISOString());

    const { exports } = await listar();
    const item = exports.find((e) => e.videoId === id)!;
    expect(item.fileName).toBe("pronto_editado.mp4");
    expect(item.cta).toBe("🔥 ELE INVENTOU UMA MÁQUINA DO TEMPO");
    expect(item.transcript).toBe("eu vou consertar tudo");
    expect(item.plot).toBe("Ele inventou uma máquina do tempo.");
    expect(item.hashtags).toEqual(["#filme", "#cenasdefilme"]);
    expect(item.bytes).toBe(2_000_000);
  });

  it("o texto próprio do editor vence o CTA da Fila, como no vídeo exportado", async () => {
    const id = video("comtexto");
    const analysisId = repo.saveSceneAnalysis(
      id,
      {
        sceneSummary: "resumo",
        plot: null,
        keyLines: [],
        analysisLimitations: [],
        conflict: null,
        curiosity: null,
        withhold: null,
        speculation: [],
        existingCta: null,
        work: null,
      },
      { promptVersion: "teste", model: "m" },
    );
    repo.replaceSuggestions(id, analysisId, [{ text: "CTA DA FILA", style: "curiosidade", isRecommended: true }]);
    editorRepo.setVideoTextOverride(id, "MEU TEXTO PRÓPRIO");
    completed(id, "comtexto_editado.mp4", new Date().toISOString());

    const { exports } = await listar();
    expect(exports.find((e) => e.videoId === id)?.cta).toBe("MEU TEXTO PRÓPRIO");
  });

  it("arquivo apagado é MARCADO, não escondido: some da lista pareceria que nunca exportou", async () => {
    const id = video("sumiu");
    completed(id, "sumiu_editado.mp4", new Date().toISOString());
    const antes = (await listar()).exports.find((e) => e.videoId === id)!;
    expect(antes.fileMissing).toBe(false);

    fs.unlinkSync(path.join(tmpDir, "sumiu_editado.mp4"));
    const depois = (await listar()).exports.find((e) => e.videoId === id)!;
    expect(depois.fileMissing).toBe(true);
    expect(depois.bytes).toBeNull();
    // Os dados para publicar continuam disponíveis mesmo sem o arquivo.
    expect(depois.outputPath).toContain("sumiu_editado.mp4");
  });

  it("job que ainda não terminou não aparece", async () => {
    const id = video("na-fila");
    editorRepo.createEditorJob({ videoId: id }); // fica 'pending'
    expect((await listar()).exports.some((e) => e.videoId === id)).toBe(false);
  });

  it("o caminho do arquivo vem do job, nunca do cliente", async () => {
    const id = video("servir");
    const jobId = completed(id, "servir_editado.mp4", new Date().toISOString());
    fs.writeFileSync(path.join(tmpDir, "servir_editado.mp4"), Buffer.alloc(1000, 7));

    const ok = await media.GET(new Request("http://x"), { params: Promise.resolve({ jobId }) });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("video/mp4");
    expect(ok.headers.get("content-length")).toBe("1000");

    // Um id que não é job não serve arquivo nenhum.
    const nada = await media.GET(new Request("http://x"), {
      params: Promise.resolve({ jobId: "E:\\Windows\\System32\\config\\SAM" }),
    });
    expect(nada.status).toBe(404);
  });

  it("responde a Range: o player pede o vídeo em pedaços", async () => {
    const id = video("faixa");
    const jobId = completed(id, "faixa_editado.mp4", new Date().toISOString());
    fs.writeFileSync(path.join(tmpDir, "faixa_editado.mp4"), Buffer.alloc(5000, 3));

    const res = await media.GET(new Request("http://x", { headers: { range: "bytes=100-199" } }), {
      params: Promise.resolve({ jobId }),
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 100-199/5000");
    expect(res.headers.get("content-length")).toBe("100");
  });

  it("job que não terminou, ou arquivo que sumiu, não é servido", async () => {
    const pendente = editorRepo.createEditorJob({ videoId: video("pendente-media") });
    const r1 = await media.GET(new Request("http://x"), { params: Promise.resolve({ jobId: pendente.id }) });
    expect(r1.status).toBe(404);

    const id = video("apagado-media");
    const jobId = completed(id, "apagado_editado.mp4", new Date().toISOString());
    fs.unlinkSync(path.join(tmpDir, "apagado_editado.mp4"));
    const r2 = await media.GET(new Request("http://x"), { params: Promise.resolve({ jobId }) });
    expect(r2.status).toBe(404);
  });

  it("marca o que saiu nesta sessão do servidor", async () => {
    (globalThis as { __appStartedAt?: string }).__appStartedAt = new Date().toISOString();
    const antigo = video("antigo");
    completed(antigo, "antigo_editado.mp4", "2020-01-01T00:00:00.000Z");
    const agora = video("agora");
    completed(agora, "agora_editado.mp4", new Date(Date.now() + 1000).toISOString());

    const { exports } = await listar();
    expect(exports.find((e) => e.videoId === antigo)?.thisSession).toBe(false);
    expect(exports.find((e) => e.videoId === agora)?.thisSession).toBe(true);
  });
});
