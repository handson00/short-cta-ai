import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildFilterGraph } from "../src/lib/editor/filterGraph";
import { DEFAULT_TEMPLATE } from "../src/lib/editor/template";
import {
  DEFAULT_EFFECTS,
  countEffects,
  effectsError,
  normalizeEffects,
  outputDuration,
  outputTimeAt,
  zoomRect,
  type EditorEffects,
} from "../src/lib/editor/effects";

/**
 * Aba Efeitos. A regra pura e o filter graph são conferidos como texto; a
 * exportação de verdade é conferida MEDINDO o arquivo que o FFmpeg produz —
 * duração, cor do pixel e volume —, porque etiqueta certa sobre dado errado
 * passa em qualquer verificação que só lê metadado (HISTORICO §21).
 *
 * Tudo numa pasta temporária: nada encosta em data/.
 */

vi.mock("../src/lib/auth", () => ({ isAuthenticated: async () => true, guardApi: async () => null }));

const FX_ALL: EditorEffects = {
  mirror: true,
  trimStart: 0.5,
  trimEnd: 0.5,
  enhanceColor: true,
  speed: 1.25,
  zoom: 1.1,
  enhanceAudio: true,
};

function graph(effects: EditorEffects | null, over: Record<string, unknown> = {}) {
  return buildFilterGraph({
    crop: null,
    sourceWidth: 720,
    sourceHeight: 1280,
    durationSeconds: 10,
    sourceHasAudio: true,
    sourceColorSpace: "bt709",
    template: DEFAULT_TEMPLATE,
    fps: 30,
    hasBackgroundImage: false,
    hasOverlayImage: false,
    hasLogoImage: false,
    hasTextLayer: false,
    effects,
    ...over,
  });
}

// ------------------------------ Regra pura ---------------------------------

describe("regra dos efeitos", () => {
  it("valores fora do limite são trazidos para dentro, lixo vira padrão", () => {
    expect(normalizeEffects({ speed: 9, zoom: 0.2, trimStart: -3, mirror: "sim" })).toEqual({
      ...DEFAULT_EFFECTS,
      speed: 1.25,
      zoom: 1,
      trimStart: 0,
    });
    expect(normalizeEffects(null)).toEqual(DEFAULT_EFFECTS);
  });

  it("duração final: trecho cortado dividido pela velocidade", () => {
    expect(outputDuration(10, FX_ALL)).toBeCloseTo(9 / 1.25, 5);
    expect(outputDuration(10, DEFAULT_EFFECTS)).toBe(10);
  });

  it("corte que não deixa vídeo é recusado com o motivo", () => {
    expect(effectsError(1.5, { ...DEFAULT_EFFECTS, trimStart: 0.5, trimEnd: 0.5 })).toMatch(/menos de 1s/);
    expect(effectsError(10, FX_ALL)).toBeNull();
  });

  it("zoom é um recorte menor em volta do centro do recorte", () => {
    const r = zoomRect({ x: 0.2, y: 0, width: 0.6, height: 1 }, 1.2);
    expect(r.width).toBeCloseTo(0.5, 5);
    expect(r.x).toBeCloseTo(0.25, 5);
    expect(r.height).toBeCloseTo(1 / 1.2, 5);
    expect(r.y + r.height / 2).toBeCloseTo(0.5, 5);
  });

  it("o texto do preview segue o tempo do vídeo exportado", () => {
    // 2,5 s da origem, com 0,5 s cortado do início e 1,25x: 1,6 s no arquivo.
    expect(outputTimeAt(2.5, FX_ALL)).toBeCloseTo(1.6, 5);
  });

  it("conta os efeitos ligados", () => {
    expect(countEffects(FX_ALL)).toBe(6);
    expect(countEffects(DEFAULT_EFFECTS)).toBe(0);
  });
});

// ---------------------------- Filter graph ---------------------------------

describe("filter graph com efeitos", () => {
  it("sem efeitos, o grafo é exatamente o de antes", () => {
    expect(graph(DEFAULT_EFFECTS).filterComplex).toBe(graph(null).filterComplex);
  });

  it("espelho e cor entram depois do recorte, antes da escala", () => {
    const fc = graph(FX_ALL).filterComplex;
    const video = fc.split(";")[0];
    expect(video.indexOf("hflip")).toBeGreaterThan(video.indexOf("crop="));
    expect(video.indexOf("eq=contrast=1.08:saturation=1.18")).toBeLessThan(video.indexOf("scale="));
    expect(video).toContain("setpts=PTS/1.25");
  });

  it("zoom recorta menos pixels da origem", () => {
    // 720x1280 com zoom 1,1: ~654x1164 (pares), centrado.
    expect(graph(FX_ALL).filterComplex).toMatch(/crop=65\d:116\d:3\d:5\d/);
  });

  it("velocidade no áudio original sem mudar o tom, e áudio melhorado no fim", () => {
    const fc = graph(FX_ALL).filterComplex;
    expect(fc).toContain("[0:a]atempo=1.25,volume=1,highpass=f=80,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]");
  });

  it("a música é cortada na duração FINAL e não é acelerada", () => {
    const fc = graph(FX_ALL, {
      template: { ...DEFAULT_TEMPLATE, audio: { mode: "replace", music: "m.mp3", originalVolume: 1, musicVolume: 0.5 } },
    }).filterComplex;
    expect(fc).toContain("atrim=duration=7.2,");
    expect(fc).not.toMatch(/\[2:a\][^;]*atempo/);
  });
});

// ------------------------- Exportação de verdade ---------------------------

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shortcta-effects-"));
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";

let exporter: typeof import("../src/lib/editor/export");
let editorRepo: typeof import("../src/lib/editorRepo");
let repo: typeof import("../src/lib/repo");
let dbMod: typeof import("../src/lib/db");
let effectsRoute: typeof import("../src/app/api/editor/effects/route");

/** Vídeo de 6 s: metade esquerda vermelha, direita azul; tom de 440 Hz bem baixo (-30 dB). */
function makeSource(file: string) {
  execFileSync(ffmpeg, [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", "color=c=red:s=160x284:d=6,format=yuv420p",
    "-f", "lavfi", "-i", "color=c=blue:s=160x284:d=6,format=yuv420p",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=6,volume=-30dB",
    "-filter_complex", "[0:v][1:v]hstack=inputs=2,setsar=1[v]",
    "-map", "[v]", "-map", "2:a",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
    "-c:a", "aac", "-shortest", file,
  ]);
}

function probeDuration(file: string): number {
  return Number(execFileSync(ffmpeg.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1"), [
    "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file,
  ]).toString().trim());
}

/** Cor média de uma região 20x20 do quadro em 1 s (RGB). */
function pixel(file: string, x: number, y: number): [number, number, number] {
  const out = execFileSync(ffmpeg, [
    "-v", "error", "-ss", "1", "-i", file, "-frames:v", "1",
    "-vf", `crop=20:20:${x}:${y},scale=1:1:flags=area`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
  ]);
  return [out[0], out[1], out[2]];
}

/** Loudness integrada (LUFS) medida pelo ebur128 do FFmpeg. */
function loudness(file: string): number {
  // O ebur128 escreve o resumo em stderr; a última linha "I: ... LUFS" é a integrada.
  const res = spawnSync(ffmpeg, ["-nostats", "-i", file, "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" });
  const match = [...String(res.stderr).matchAll(/I:\s+(-?[\d.]+) LUFS/g)].pop();
  return match ? Number(match[1]) : NaN;
}

beforeAll(async () => {
  process.env.DATA_DIR = tmpDir;
  process.env.DATABASE_PATH = path.join(tmpDir, "teste.db");
  process.env.EDITOR_OUTPUT_DIR = path.join(tmpDir, "output");
  vi.resetModules();
  dbMod = await import("../src/lib/db");
  repo = await import("../src/lib/repo");
  editorRepo = await import("../src/lib/editorRepo");
  exporter = await import("../src/lib/editor/export");
  effectsRoute = await import("../src/app/api/editor/effects/route");
  dbMod.db();
});

afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Windows pode segurar arquivos; a pasta é temporária.
  }
});

describe("exportação com todos os efeitos (FFmpeg real, medido)", () => {
  it("corta, acelera, espelha e deixa o áudio no volume padrão", async () => {
    const source = path.join(tmpDir, "origem.mp4");
    makeSource(source);

    // Template simples: o vídeo ocupa o canvas inteiro, 320x568 (sem texto).
    const template = {
      ...DEFAULT_TEMPLATE,
      canvasWidth: 320,
      canvasHeight: 568,
      videoX: 0,
      videoY: 0,
      videoWidth: 320,
      videoHeight: 568,
      fitMode: "fill" as const,
    };

    const base = {
      videoId: "v_fx",
      sourcePath: source,
      originalName: "origem.mp4",
      sourceWidth: 320,
      sourceHeight: 284,
      durationSeconds: 6,
      hasAudio: true,
      crop: null,
      template,
      fps: 30,
      encoder: "libx264",
    };

    const plain = await exporter.renderVideo({ ...base, jobId: "j_plain" });
    const fx = await exporter.renderVideo({ ...base, jobId: "j_fx", effects: { ...FX_ALL, zoom: 1, enhanceColor: false } });

    // Duração: (6 - 0,5 - 0,5) / 1,25 = 4 s.
    expect(probeDuration(plain.outputPath)).toBeCloseTo(6, 0);
    expect(Math.abs(probeDuration(fx.outputPath) - 4)).toBeLessThan(0.15);

    // Espelho: sem efeito, a esquerda é vermelha; espelhado, é azul.
    const [pr, , pb] = pixel(plain.outputPath, 20, 270);
    const [fr, , fb] = pixel(fx.outputPath, 20, 270);
    expect(pr).toBeGreaterThan(pb);
    expect(fb).toBeGreaterThan(fr);

    // Áudio: o tom entrou a ~-30 dB; melhorado, sai perto de -14 LUFS.
    const before = loudness(plain.outputPath);
    const after = loudness(fx.outputPath);
    expect(after).toBeGreaterThan(before + 8);
    expect(Math.abs(after - -14)).toBeLessThan(2);

    // Os seis juntos (zoom e cor inclusos): o FFmpeg aceita a combinação
    // inteira e o arquivo sai com vídeo e áudio na duração certa.
    const all = await exporter.renderVideo({ ...base, jobId: "j_all", effects: FX_ALL });
    expect(Math.abs(probeDuration(all.outputPath) - 4)).toBeLessThan(0.15);
    // Cor realçada: o vermelho (agora à direita, pelo espelho) fica mais saturado, não some.
    const [ar, ag, ab] = pixel(all.outputPath, 280, 270);
    expect(ar).toBeGreaterThan(200);
    expect(ag + ab).toBeLessThan(60);
  });

  it("corte maior que o vídeo vira erro claro, sem arquivo pela metade", async () => {
    const source = path.join(tmpDir, "curto.mp4");
    makeSource(source);
    await expect(
      exporter.renderVideo({
        jobId: "j_bad",
        videoId: "v_bad",
        sourcePath: source,
        originalName: "curto.mp4",
        sourceWidth: 320,
        sourceHeight: 284,
        durationSeconds: 6,
        hasAudio: true,
        crop: null,
        template: DEFAULT_TEMPLATE,
        effects: { ...DEFAULT_EFFECTS, trimStart: 3, trimEnd: 3 },
        encoder: "libx264",
      }),
    ).rejects.toThrow(/deixa menos de 1s/);
    const leftovers = fs.readdirSync(path.join(tmpDir, "output")).filter((f) => f.startsWith("curto"));
    expect(leftovers).toEqual([]);
  });
});

// --------------------------------- Rota ------------------------------------

function video(name: string): string {
  const file = path.join(tmpDir, `${name}.mp4`);
  fs.writeFileSync(file, "x");
  const v = repo.createVideo({ originalName: `${name}.mp4`, storedName: `${name}.mp4`, path: file, hash: `h_${name}`, bytes: 1, mime: "video/mp4" });
  editorRepo.addVideosToEditor([v.id]);
  return v.id;
}

function post(body: unknown) {
  return effectsRoute.POST(new Request("http://x/api/editor/effects", { method: "POST", body: JSON.stringify(body) }) as never);
}

describe("rota de efeitos", () => {
  it("'todos' grava em todos os vídeos da edição, resolvidos no servidor", async () => {
    const a = video("a");
    const b = video("b");
    const res = await post({ scope: "all", effects: { ...DEFAULT_EFFECTS, mirror: true } });
    expect(res.status).toBe(200);
    expect(editorRepo.getVideoEffects(a)?.mirror).toBe(true);
    expect(editorRepo.getVideoEffects(b)?.mirror).toBe(true);
  });

  it("tudo desligado apaga os efeitos do vídeo", async () => {
    const c = video("c");
    await post({ scope: "videos", videoIds: [c], effects: { ...DEFAULT_EFFECTS, zoom: 1.1 } });
    expect(editorRepo.getVideoEffects(c)?.zoom).toBe(1.1);
    await post({ scope: "videos", videoIds: [c], effects: DEFAULT_EFFECTS });
    expect(editorRepo.getVideoEffects(c)).toBeNull();
  });

  it("recusa valor fora do limite (a tela não manda, mas a rota confere)", async () => {
    const res = await post({ scope: "all", effects: { ...DEFAULT_EFFECTS, speed: 3 } });
    expect(res.status).toBe(422);
  });

  it("a exportação fotografa os efeitos do vídeo no job", async () => {
    const d = video("d");
    await post({ scope: "videos", videoIds: [d], effects: { ...DEFAULT_EFFECTS, speed: 1.1 } });
    const tpl = editorRepo.createEditorTemplate("t", DEFAULT_TEMPLATE);
    const queue = await import("../src/lib/editor/exportQueue");
    const { jobIds } = queue.enqueueExports([d], { fallbackTemplateId: tpl.id });
    expect(editorRepo.getEditorJob(jobIds[0])?.exportSettings.effects?.speed).toBe(1.1);
  });
});
