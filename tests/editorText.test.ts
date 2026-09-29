import { describe, expect, it } from "vitest";
import {
  layoutText,
  prepareText,
  textOpacityAt,
  wrapParagraph,
  type Measure,
} from "../src/lib/editor/textLayout";
import { DEFAULT_TEMPLATE, DEFAULT_TEXT_STYLE, validateTemplateConfig } from "../src/lib/editor/template";
import { detectAsset } from "../src/lib/editor/assets";
import type { EditorTextStyle } from "../src/lib/types";

/**
 * A quebra e o encaixe do texto decidem as linhas do preview e da camada
 * exportada. Um medidor falso (cada caractere = 0,6 da fonte) deixa a regra
 * testável sem navegador; no app, quem mede é o canvas.
 */
const mono: Measure = (text, size) => Array.from(text).length * size * 0.6;

const style: EditorTextStyle = {
  ...DEFAULT_TEXT_STYLE,
  width: 624, // útil = 624 - 2 * (8 + 12) = 584
  height: 300,
  strokeWidth: 8,
  maxFontSize: 60,
  minFontSize: 20,
  lineHeight: 1.2,
  uppercase: false,
};

describe("preparo do texto", () => {
  it("junta espaços repetidos e mantém a quebra manual", () => {
    expect(prepareText("  A   sorte\n\n acabou  ", false)).toBe("A sorte\n\nacabou");
  });

  it("maiúsculas em pt-BR, com acento", () => {
    expect(prepareText("ação é já", true)).toBe("AÇÃO É JÁ");
  });
});

describe("quebra de linha", () => {
  it("quebra entre palavras quando a linha estoura", () => {
    // Cada caractere vale 6 px a 10 px de fonte; cabem 10 por linha.
    const lines = wrapParagraph("uma frase de teste", 60, 10, mono);
    expect(lines).toEqual(["uma frase", "de teste"]);
  });

  it("palavra maior que a linha é partida, em vez de vazar da caixa", () => {
    const lines = wrapParagraph("inconstitucionalissimamente", 60, 10, mono);
    for (const l of lines) expect(mono(l, 10)).toBeLessThanOrEqual(60);
    expect(lines.join("")).toBe("inconstitucionalissimamente");
  });

  it("não parte um emoji no meio", () => {
    // "⚠️" são dois code points; partir entre eles desenharia um símbolo quebrado.
    const lines = wrapParagraph("⚠️⚠️⚠️⚠️⚠️⚠️", 12, 10, mono);
    for (const l of lines) expect(l.startsWith("️")).toBe(false);
  });
});

describe("encaixe na caixa", () => {
  it("texto curto sai no tamanho máximo", () => {
    const r = layoutText("Olha isso", style, mono);
    expect(r.fontSize).toBe(60);
    expect(r.overflow).toBe(false);
  });

  it("texto longo diminui até caber, em vez de vazar", () => {
    const longo = "A sorte acabou do nada e ninguém entendeu o que aconteceu naquela cozinha";
    const r = layoutText(longo, style, mono);
    expect(r.fontSize).toBeLessThan(60);
    expect(r.overflow).toBe(false);
    expect(r.blockHeight).toBeLessThanOrEqual(style.height - 2 * 20);
  });

  it("sem espaço nem no mínimo, avisa em vez de fingir que coube", () => {
    const enorme = "palavra ".repeat(200);
    const r = layoutText(enorme, style, mono);
    expect(r.fontSize).toBe(style.minFontSize);
    expect(r.overflow).toBe(true);
  });

  it("o mesmo texto no mesmo estilo dá sempre o mesmo resultado", () => {
    const a = layoutText("Você faria o mesmo?", style, mono);
    const b = layoutText("Você faria o mesmo?", style, mono);
    expect(a).toEqual(b);
  });
});

describe("opacidade no tempo (mesma regra dos fades do FFmpeg)", () => {
  const t: EditorTextStyle = { ...style, start: 1, end: 5, fadeIn: 1, fadeOut: 1 };

  it("invisível fora da janela", () => {
    expect(textOpacityAt(0.5, t, 10)).toBe(0);
    expect(textOpacityAt(5.5, t, 10)).toBe(0);
  });

  it("sobe no fade de entrada, fica cheio no meio, desce no de saída", () => {
    expect(textOpacityAt(1.5, t, 10)).toBeCloseTo(0.5);
    expect(textOpacityAt(3, t, 10)).toBe(1);
    expect(textOpacityAt(4.5, t, 10)).toBeCloseTo(0.5);
  });

  it("sem fim definido, vai até a duração do vídeo", () => {
    expect(textOpacityAt(9.9, { ...t, end: null, fadeOut: 0 }, 10)).toBe(1);
  });
});

describe("validação de texto e áudio no template", () => {
  const base = { ...DEFAULT_TEMPLATE };

  it("aceita o estilo padrão", () => {
    expect(validateTemplateConfig({ ...base, text: DEFAULT_TEXT_STYLE })).toBeNull();
  });

  it("recusa caixa de texto fora do canvas, dizendo qual borda", () => {
    const erro = validateTemplateConfig({ ...base, text: { ...DEFAULT_TEXT_STYLE, x: 500, width: 700 } });
    expect(erro).toMatch(/direita/);
  });

  it("recusa mínimo maior que máximo", () => {
    expect(
      validateTemplateConfig({ ...base, text: { ...DEFAULT_TEXT_STYLE, minFontSize: 90, maxFontSize: 40 } }),
    ).toMatch(/mínimo/);
  });

  it("recusa fades mais longos que o tempo em tela", () => {
    expect(
      validateTemplateConfig({ ...base, text: { ...DEFAULT_TEXT_STYLE, start: 0, end: 1, fadeIn: 1, fadeOut: 1 } }),
    ).toMatch(/fades/);
  });

  it("texto desligado não é validado", () => {
    expect(validateTemplateConfig({ ...base, text: { ...DEFAULT_TEXT_STYLE, enabled: false, x: 99999 } })).toBeNull();
  });

  it("misturar ou substituir exige uma música", () => {
    expect(
      validateTemplateConfig({ ...base, audio: { mode: "mix", originalVolume: 1, musicVolume: 0.3 } }),
    ).toMatch(/música/);
  });

  it("recusa volume acima de 200%", () => {
    expect(
      validateTemplateConfig({ ...base, audio: { mode: "original", originalVolume: 3, musicVolume: 0 } }),
    ).toMatch(/200%/);
  });
});

describe("reconhecimento de arquivos pelo conteúdo", () => {
  const bytes = (...b: number[]) => Buffer.from([...b, ...new Array(16).fill(0)]);
  const text = (s: string, pad = 16) => Buffer.concat([Buffer.from(s, "latin1"), Buffer.alloc(pad)]);

  it("reconhece imagem, fonte e áudio", () => {
    expect(detectAsset(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))?.ext).toBe(".png");
    expect(detectAsset(bytes(0x00, 0x01, 0x00, 0x00))?.kind).toBe("font");
    expect(detectAsset(text("OTTO"))?.ext).toBe(".otf");
    expect(detectAsset(text("ID3"))?.ext).toBe(".mp3");
    expect(detectAsset(text("OggS"))?.kind).toBe("audio");
    expect(detectAsset(text("fLaC"))?.kind).toBe("audio");
  });

  it("distingue M4A de um MP4 de vídeo, que também começa com ftyp", () => {
    const m4a = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), text("ftypM4A ")]);
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), text("ftypisom")]);
    expect(detectAsset(m4a)?.ext).toBe(".m4a");
    expect(detectAsset(mp4)).toBeNull();
  });

  it("não aceita arquivo desconhecido só pela extensão", () => {
    expect(detectAsset(text("GIF89a"))).toBeNull();
  });
});
