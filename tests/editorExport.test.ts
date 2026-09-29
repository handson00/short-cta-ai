import { describe, expect, it } from "vitest";
import { assumedColorSpace, buildFilterGraph, ffmpegColor } from "../src/lib/editor/filterGraph";
import {
  consumeProgress,
  estimateRemainingSeconds,
  newProgressState,
} from "../src/lib/editor/progress";
import { DEFAULT_TEXT_STYLE } from "../src/lib/editor/template";
import type { EditorTemplateConfig, EditorTextStyle } from "../src/lib/types";

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
    durationSeconds: 10,
    sourceHasAudio: true,
    sourceColorSpace: "bt709",
    template,
    fps: 30,
    hasBackgroundImage: false,
    hasOverlayImage: false,
    hasLogoImage: false,
    hasTextLayer: false,
    ...over,
  });
}

const textStyle: EditorTextStyle = {
  ...DEFAULT_TEXT_STYLE,
  x: 60,
  y: 80,
  width: 960,
  height: 300,
};

describe("filter graph", () => {
  it("sem imagem de fundo, cria uma fonte de cor sólida", () => {
    const g = graph();
    expect(g.colorSource).toBe("color=c=0x1a1033:s=1080x1920");
    expect(g.inputs).toEqual(["background"]);
  });

  it("com imagem de fundo, não cria fonte de cor", () => {
    const g = graph({ hasBackgroundImage: true });
    expect(g.colorSource).toBeNull();
    expect(g.inputs).toEqual(["background"]);
  });

  it("todo overlay usa shortest=1: o vídeo é a única fonte finita e encerra o arquivo", () => {
    // Sem isto, um vídeo sem áudio exportava para sempre: medido no FFmpeg
    // real, o render de um clipe de 4 s foi morto por timeout aos 25 s.
    const g = graph({ hasOverlayImage: true, hasLogoImage: true, hasTextLayer: true, template: { ...template, text: textStyle } });
    const overlays = g.filterComplex.match(/overlay=[^;[]*/g) ?? [];
    expect(overlays).toHaveLength(4);
    for (const o of overlays) expect(o).toContain("shortest=1");
  });

  it("recorta a origem nos pixels do recorte", () => {
    const g = graph({ crop: { x: 0, y: 0.25, width: 1, height: 0.5 } });
    // 1080x1920 → recorte de 1080x960 começando em y=480.
    expect(g.filterComplex).toContain("crop=1080:960:0:480");
  });

  it("termina sempre em yuv420p e fps fixo", () => {
    expect(graph().filterComplex).toContain("fps=30,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv[out]");
  });

  it("numera as entradas na ordem em que o chamador passa os -i", () => {
    const g = graph({ hasOverlayImage: true, hasLogoImage: true });
    expect(g.inputs).toEqual(["background", "overlay", "logo"]);
    // Fundo é sempre a entrada 1; overlay e logo vêm depois, em ordem.
    expect(g.filterComplex).toContain("[2:v]scale=1080:1920:");
    expect(g.filterComplex).toMatch(/[ov]/);
    expect(g.filterComplex).toContain("[3:v]scale=");
  });

  it("texto e música entram depois das imagens, na ordem certa", () => {
    const g = graph({
      hasLogoImage: true,
      hasTextLayer: true,
      template: {
        ...template,
        text: textStyle,
        audio: { mode: "mix", music: "tpl_x.mp3", originalVolume: 1, musicVolume: 0.3 },
      },
    });
    expect(g.inputs).toEqual(["background", "logo", "text", "music"]);
    expect(g.filterComplex).toContain("[3:v]scale=960:300:");
    expect(g.filterComplex).toContain("[4:a]volume=0.3");
  });

  it("a logo cabe na caixa sem deformar, e fica centrada nela", () => {
    const g = graph({
      hasLogoImage: true,
      template: { ...template, logoX: 420, logoY: 120, logoWidth: 240, logoHeight: 240 },
    });
    // Sem force_original_aspect_ratio, uma logo larga esticava para preencher
    // a altura da caixa — foi o defeito relatado no primeiro render real.
    expect(g.filterComplex).toContain("scale=240:240:force_original_aspect_ratio=decrease:");
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

describe("cor (BT.709 convertido, não só etiquetado)", () => {
  /**
   * 23 dos 98 vídeos do acervo vêm em BT.601. Só etiquetar a saída como BT.709
   * fazia o verde das barras de teste sair (0,189,0) em vez de (12,220,2).
   */
  it("toda entrada visual é convertida para BT.709 antes do overlay", () => {
    const g = graph({
      hasBackgroundImage: true,
      hasOverlayImage: true,
      hasLogoImage: true,
      hasTextLayer: true,
      template: { ...template, text: textStyle },
    });
    // vídeo, fundo, overlay, logo e texto
    expect(g.filterComplex.match(/out_color_matrix=bt709:out_range=tv/g)).toHaveLength(5);
  });

  it("origem com matriz declarada não é reetiquetada antes da conversão", () => {
    const g = graph({ sourceColorSpace: "smpte170m" });
    expect(g.filterComplex.startsWith("[0:v]crop=")).toBe(true);
  });

  it("origem HD sem matriz declarada é tratada como BT.709, como os players fazem", () => {
    const g = graph({ sourceColorSpace: null, sourceWidth: 720, sourceHeight: 1280 });
    expect(g.filterComplex.startsWith("[0:v]setparams=color_primaries=bt709")).toBe(true);
  });

  it("origem abaixo de 720p sem matriz declarada é tratada como BT.601", () => {
    const g = graph({ sourceColorSpace: null, sourceWidth: 480, sourceHeight: 854 });
    expect(g.filterComplex.startsWith("[0:v]setparams=color_primaries=smpte170m")).toBe(true);
  });

  it("a matriz assumida segue o menor lado do vídeo", () => {
    expect(assumedColorSpace(null, 1080, 1920)).toBe("bt709");
    expect(assumedColorSpace(null, 540, 960)).toBe("smpte170m");
    expect(assumedColorSpace("smpte170m", 1080, 1920)).toBe("smpte170m");
  });
});

describe("camada de texto", () => {
  const withText = (text: Partial<EditorTextStyle>) =>
    graph({ hasTextLayer: true, template: { ...template, text: { ...textStyle, ...text } } });

  it("entra na posição da caixa, no tamanho da caixa", () => {
    const g = withText({});
    expect(g.filterComplex).toContain("scale=960:300");
    expect(g.filterComplex).toMatch(/\[txt\]overlay=60:80:shortest=1/);
  });

  it("sempre visível não recebe janela de tempo nem fade", () => {
    const g = withText({});
    expect(g.filterComplex).not.toContain("enable=");
    expect(g.filterComplex).not.toContain("fade=");
  });

  it("com janela e fades, usa between() entre aspas e os dois fades com alfa", () => {
    const g = withText({ start: 0.5, end: 3, fadeIn: 0.5, fadeOut: 0.5 });
    // As aspas protegem a vírgula do between() do separador do filtergraph.
    expect(g.filterComplex).toContain("enable='between(t,0.5,3)'");
    expect(g.filterComplex).toContain("fade=t=in:st=0.5:d=0.5:alpha=1");
    expect(g.filterComplex).toContain("fade=t=out:st=2.5:d=0.5:alpha=1");
  });

  it("sem fim definido, a janela e o fade de saída usam a duração do vídeo", () => {
    const g = withText({ start: 1, end: null, fadeOut: 1 });
    expect(g.filterComplex).toContain("enable='between(t,1,10)'");
    expect(g.filterComplex).toContain("fade=t=out:st=9:d=1:alpha=1");
  });

  it("texto desligado no template não entra, mesmo com camada enviada", () => {
    const g = graph({ hasTextLayer: true, template: { ...template, text: { ...textStyle, enabled: false } } });
    expect(g.inputs).not.toContain("text");
  });
});

describe("áudio (§36)", () => {
  const withAudio = (audio: EditorTemplateConfig["audio"], sourceHasAudio = true) =>
    graph({ sourceHasAudio, template: { ...template, audio } });

  it("original: mantém o áudio do vídeo, com o volume configurado", () => {
    const g = withAudio({ mode: "original", originalVolume: 0.8, musicVolume: 0 });
    expect(g.audioLabel).toBe("aout");
    expect(g.filterComplex).toContain("[0:a]volume=0.8,aresample=48000[aout]");
  });

  it("sem configuração de áudio, é o original", () => {
    expect(graph().audioLabel).toBe("aout");
  });

  it("mudo: o arquivo sai sem trilha", () => {
    const g = withAudio({ mode: "mute", originalVolume: 1, musicVolume: 0 });
    expect(g.audioLabel).toBeNull();
    expect(g.filterComplex).not.toContain("[0:a]");
  });

  it("original num vídeo sem áudio: sai sem trilha, em vez de mapear o que não existe", () => {
    expect(withAudio({ mode: "original", originalVolume: 1, musicVolume: 0 }, false).audioLabel).toBeNull();
  });

  it("substituir: só a música, cortada na duração do vídeo", () => {
    const g = withAudio({ mode: "replace", music: "tpl_m.mp3", originalVolume: 1, musicVolume: 0.6 });
    expect(g.filterComplex).toContain("[2:a]volume=0.6,atrim=duration=10,asetpts=N/SR/TB,aresample=48000[aout]");
    expect(g.filterComplex).not.toContain("[0:a]");
  });

  it("misturar: amix sem normalização, para o volume configurado ser o que sai", () => {
    const g = withAudio({ mode: "mix", music: "tpl_m.mp3", originalVolume: 1, musicVolume: 0.3 });
    expect(g.filterComplex).toContain("amix=inputs=2:duration=first:normalize=0");
  });

  it("misturar num vídeo sem áudio vira substituir", () => {
    const g = withAudio({ mode: "mix", music: "tpl_m.mp3", originalVolume: 1, musicVolume: 0.3 }, false);
    expect(g.filterComplex).not.toContain("amix");
    expect(g.audioLabel).toBe("aout");
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
