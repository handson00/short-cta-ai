import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ctaOriginNote, ctaStyleLabel, currentCtaIndex, stepCta, type CtaOption } from "../src/lib/editor/ctaOptions";

/**
 * Botão "Outro CTA" do editor: percorre os CTAs gerados para o vídeo e diz o
 * estilo do texto que está sobre ele. A rota é conferida contra um banco numa
 * pasta temporária — nada encosta em data/short-cta-ai.db.
 */

vi.mock("../src/lib/auth", () => ({ isAuthenticated: async () => true }));

const OPTIONS: CtaOption[] = [
  { text: "🔥 O QUE ELE ESCONDE NO PORÃO?", style: "curiosidade", origin: "generated", recommended: true },
  { text: "💣 ELE TEM SEGUNDOS PARA FUGIR", style: "suspense", origin: "generated", recommended: false },
  { text: "O FINAL VAI TE CHOCAR", style: "curiosidade", origin: "original", recommended: false },
];

describe("regra do botão", () => {
  it("avança para o próximo e dá a volta no fim", () => {
    expect(stepCta(OPTIONS, OPTIONS[0].text)?.text).toBe(OPTIONS[1].text);
    expect(stepCta(OPTIONS, OPTIONS[2].text)?.text).toBe(OPTIONS[0].text);
  });

  it("volta para o anterior", () => {
    expect(stepCta(OPTIONS, OPTIONS[0].text, -1)?.text).toBe(OPTIONS[2].text);
  });

  it("texto próprio: o primeiro clique leva ao primeiro CTA (o recomendado)", () => {
    expect(currentCtaIndex(OPTIONS, "texto que eu escrevi")).toBe(-1);
    expect(stepCta(OPTIONS, "texto que eu escrevi")?.text).toBe(OPTIONS[0].text);
  });

  it("espaços a mais não fazem o texto parecer próprio", () => {
    expect(currentCtaIndex(OPTIONS, "  💣 ELE TEM  SEGUNDOS PARA FUGIR ")).toBe(1);
  });

  it("sem CTA gerado, não há o que carregar", () => {
    expect(stepCta([], "qualquer")).toBeNull();
  });

  it("diz o estilo e a origem", () => {
    expect(ctaStyleLabel("curiosidade")).toBe("Curiosidade");
    expect(ctaStyleLabel("resolveDuvida")).toBe("Resolve dúvida");
    expect(ctaOriginNote(OPTIONS[0])).toBe("recomendado");
    expect(ctaOriginNote(OPTIONS[2])).toBe("já estava no vídeo");
  });
});

// ------------------------------- Rota --------------------------------------

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shortcta-cta-options-"));
let dbMod: typeof import("../src/lib/db");
let repo: typeof import("../src/lib/repo");
let editorRepo: typeof import("../src/lib/editorRepo");
let route: typeof import("../src/app/api/editor/library/route");

beforeAll(async () => {
  process.env.DATA_DIR = tmpDir;
  process.env.DATABASE_PATH = path.join(tmpDir, "teste.db");
  vi.resetModules();
  dbMod = await import("../src/lib/db");
  repo = await import("../src/lib/repo");
  editorRepo = await import("../src/lib/editorRepo");
  route = await import("../src/app/api/editor/library/route");
  dbMod.db();
});

afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Windows pode segurar o banco; a pasta é temporária.
  }
});

function suggest(videoId: string, text: string, style: string, position: number, recommended = false, origin = "generated") {
  dbMod
    .db()
    .prepare(
      `INSERT INTO cta_suggestions (id, video_id, analysis_id, text, style, reason, is_recommended, origin, position, created_at)
       VALUES (?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?)`,
    )
    .run(`cta_${videoId}_${position}`, videoId, text, style, recommended ? 1 : 0, origin, position, new Date().toISOString());
}

describe("rota da biblioteca do editor", () => {
  it("manda os CTAs de cada vídeo, recomendado primeiro, sem repetir texto", async () => {
    const file = path.join(tmpDir, "a.mp4");
    fs.writeFileSync(file, "x");
    const video = repo.createVideo({ originalName: "a.mp4", storedName: "a.mp4", path: file, hash: "h_a", bytes: 1, mime: "video/mp4" });
    editorRepo.addVideosToEditor([video.id]);

    suggest(video.id, "SUSPENSE PRIMEIRO NA POSIÇÃO", "suspense", 0);
    suggest(video.id, "O RECOMENDADO", "curiosidade", 1, true);
    suggest(video.id, "O RECOMENDADO", "curiosidade", 2, false, "original");

    const res = await route.GET();
    const body = (await res.json()) as { videos: Array<{ id: string; ctaOptions: CtaOption[] }> };
    const options = body.videos.find((v) => v.id === video.id)!.ctaOptions;

    expect(options.map((o) => [o.text, o.style, o.recommended])).toEqual([
      ["O RECOMENDADO", "curiosidade", true],
      ["SUSPENSE PRIMEIRO NA POSIÇÃO", "suspense", false],
    ]);
    // O texto repetido era também o que já estava no vídeo: a marca sobrevive à fusão.
    expect(options[0].origin).toBe("original");
    expect(ctaOriginNote(options[0])).toBe("recomendado · já estava no vídeo");
  });

  it("vídeo sem CTA gerado vem com a lista vazia, não some", async () => {
    const file = path.join(tmpDir, "b.mp4");
    fs.writeFileSync(file, "x");
    const video = repo.createVideo({ originalName: "b.mp4", storedName: "b.mp4", path: file, hash: "h_b", bytes: 1, mime: "video/mp4" });
    editorRepo.addVideosToEditor([video.id]);

    const body = (await (await route.GET()).json()) as { videos: Array<{ id: string; ctaOptions: CtaOption[] }> };
    expect(body.videos.find((v) => v.id === video.id)?.ctaOptions).toEqual([]);
  });
});
