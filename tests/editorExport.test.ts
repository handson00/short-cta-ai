import { describe, expect, it } from "vitest";
import { buildFilterGraph, ffmpegColor } from "../src/lib/editor/filterGraph";
import {
  consumeProgress,
  estimateRemainingSeconds,
  newProgressState,
} from "../src/lib/editor/progress";
import type { EditorTemplateConfig } from "../src/lib/types";

const template: EditorTemplateConfig = {
  backgroundColor: "#1a1033",
  canvasWidth: 1080,
  canvasHeight: 1920,
  videoX: 40,
  videoY: 400,
  videoWidth: 1000,
  videoHeight: 1000,
  fitMode: "fit",
};

function graph(over: Partial<Parameters<typeof buildFilterGraph>[0]> = {}) {
  return buildFilterGraph({
    crop: null,
    sourceWidth: 1080,
    sourceHeight: 1920,
    template,
    fps: 30,
    hasBackgroundImage: false,
    hasOverlayImage: false,
    hasLogoImage: false,
    ...over,
  });
}

describe("filter graph", () => {
  it("sem imagem de fundo, cria uma fonte de cor sólida", () => {
    const g = graph();
    expect(g.colorSource).toBe("color=c=0x1a1033:s=1080x1920");
    expect(g.imageInputs).toEqual([]);
  });

  it("com imagem de fundo, não cria fonte de cor", () => {
    const g = graph({ hasBackgroundImage: true });
    expect(g.colorSource).toBeNull();
    expect(g.imageInputs).toEqual(["background"]);
  });

  it("recorta a origem nos pixels do recorte", () => {
    const g = graph({ crop: { x: 0, y: 0.25, width: 1, height: 0.5 } });
    // 1080x1920 → recorte de 1080x960 começando em y=480.
    expect(g.filterComplex).toContain("crop=1080:960:0:480");
  });

  it("termina sempre em yuv420p e fps fixo", () => {
    expect(graph().filterComplex).toContain("fps=30,format=yuv420p[out]");
  });

  it("numera as entradas na ordem em que o chamador passa os -i", () => {
    const g = graph({ hasOverlayImage: true, hasLogoImage: true });
    expect(g.imageInputs).toEqual(["overlay", "logo"]);
    // Fundo é sempre a entrada 1; overlay e logo vêm depois, em ordem.
    expect(g.filterComplex).toContain("[2:v]scale=1080:1920[ov]");
    expect(g.filterComplex).toContain("[3:v]scale=");
  });

  it("com fundo, overlay e logo, as entradas ficam em sequência", () => {
    const g = graph({ hasBackgroundImage: true, hasOverlayImage: true, hasLogoImage: true });
    expect(g.imageInputs).toEqual(["background", "overlay", "logo"]);
    expect(g.filterComplex).toContain("[2:v]scale=1080:1920[ov]");
  });

  it("a logo cabe na caixa sem deformar, e fica centrada nela", () => {
    const g = graph({
      hasLogoImage: true,
      template: { ...template, logoX: 420, logoY: 120, logoWidth: 240, logoHeight: 240 },
    });
    // Sem force_original_aspect_ratio, uma logo larga esticava para preencher
    // a altura da caixa — foi o defeito relatado no primeiro render real.
    expect(g.filterComplex).toContain("scale=240:240:force_original_aspect_ratio=decrease[logo]");
    // As dimensões reais só existem em tempo de execução, daí a expressão.
    expect(g.filterComplex).toContain("overlay=420+(240-overlay_w)/2:120+(240-overlay_h)/2");
  });

  it("todas as dimensões são pares, porque H.264 recusa lado ímpar", () => {
    const g = graph({
      sourceWidth: 1081,
      sourceHeight: 1921,
      template: { ...template, videoWidth: 999, videoHeight: 777 },
    });
    for (const [, w, h] of g.filterComplex.matchAll(/(?:scale|crop)=(\d+):(\d+)/g)) {
      expect(Number(w) % 2).toBe(0);
      expect(Number(h) % 2).toBe(0);
    }
  });

  it("em FILL, recorta o que estoura o slot em vez de deformar", () => {
    const g = graph({
      sourceWidth: 1920,
      sourceHeight: 1080,
      template: { ...template, fitMode: "fill" },
    });
    // O recorte final nunca é maior que o slot.
    const crops = [...g.filterComplex.matchAll(/crop=(\d+):(\d+)/g)];
    const ultimo = crops[crops.length - 1];
    expect(Number(ultimo[1])).toBeLessThanOrEqual(template.videoWidth);
    expect(Number(ultimo[2])).toBeLessThanOrEqual(template.videoHeight);
  });
});

describe("cor para o FFmpeg", () => {
  it("converte #RRGGBB para 0xRRGGBB", () => {
    expect(ffmpegColor("#1a2b3c")).toBe("0x1a2b3c");
  });

  it("cai em preto quando a cor é inválida, em vez de quebrar o comando", () => {
    expect(ffmpegColor("azul")).toBe("0x000000");
    expect(ffmpegColor(undefined)).toBe("0x000000");
  });
});

describe("progresso do FFmpeg", () => {
  it("lê o tempo escrito e calcula o percentual", () => {
    const s = newProgressState();
    const snap = consumeProgress(s, "out_time_us=5000000\nspeed=2.0x\nprogress=continue\n", 10);
    expect(snap.outTimeSeconds).toBeCloseTo(5);
    expect(snap.percent).toBeCloseTo(50);
    expect(snap.speed).toBeCloseTo(2);
    expect(snap.done).toBe(false);
  });

  it("aguenta CRLF — foi um \\r que escondeu o bug do OCR por dois dias", () => {
    const s = newProgressState();
    const snap = consumeProgress(s, "out_time_us=2500000\r\nspeed=1.5x\r\nprogress=continue\r\n", 10);
    expect(snap.outTimeSeconds).toBeCloseTo(2.5);
    expect(snap.speed).toBeCloseTo(1.5);
  });

  it("junta linha cortada entre dois chunks", () => {
    const s = newProgressState();
    consumeProgress(s, "out_time_us=30", 10);
    const snap = consumeProgress(s, "00000\nprogress=continue\n", 10);
    expect(snap.outTimeSeconds).toBeCloseTo(3);
  });

  it("marca o fim quando chega progress=end", () => {
    const s = newProgressState();
    const snap = consumeProgress(s, "out_time_us=10000000\nprogress=end\n", 10);
    expect(snap.done).toBe(true);
    expect(snap.percent).toBeCloseTo(100);
  });

  it("nunca passa de 100%, mesmo se o tempo vier maior que a duração", () => {
    const s = newProgressState();
    const snap = consumeProgress(s, "out_time_us=99000000\nprogress=continue\n", 10);
    expect(snap.percent).toBe(100);
  });

  it("sem duração conhecida, não inventa percentual", () => {
    const s = newProgressState();
    const snap = consumeProgress(s, "out_time_us=5000000\n", 0);
    expect(snap.percent).toBeNull();
  });

  it("ignora velocidade N/A em vez de virar NaN", () => {
    const s = newProgressState();
    const snap = consumeProgress(s, "speed=N/A\nprogress=continue\n", 10);
    expect(snap.speed).toBeNull();
  });
});

describe("estimativa de tempo restante (§132)", () => {
  it("estima quando já há dados suficientes", () => {
    const snap = { outTimeSeconds: 10, percent: 50, speed: 2, done: false };
    expect(estimateRemainingSeconds(snap, 20)).toBeCloseTo(5);
  });

  it("não promete nada no começo da renderização", () => {
    expect(estimateRemainingSeconds({ outTimeSeconds: 0.2, percent: 1, speed: 2, done: false }, 20)).toBeNull();
  });

  it("não estima sem velocidade medida", () => {
    expect(estimateRemainingSeconds({ outTimeSeconds: 10, percent: 50, speed: null, done: false }, 20)).toBeNull();
  });
});
