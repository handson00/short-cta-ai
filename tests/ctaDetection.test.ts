import { describe, expect, it } from "vitest";
import { classifyDetectedText, normalizeText, regionOf, type OcrLine } from "../src/lib/pipeline/ctaDetection";

const FRAME = { frameWidth: 1080, frameHeight: 1920 };

function line(partial: Partial<OcrLine> & { text: string }): OcrLine {
  return {
    left: 100,
    top: 150,
    width: 880,
    height: 130,
    confidence: 0.9,
    timestampSeconds: 0,
    ...FRAME,
    ...partial,
  };
}

describe("regionOf", () => {
  it("separa terço superior, centro e inferior", () => {
    expect(regionOf(line({ text: "x", top: 100 }))).toBe("top");
    expect(regionOf(line({ text: "x", top: 900, height: 60 }))).toBe("middle");
    expect(regionOf(line({ text: "x", top: 1700, height: 60 }))).toBe("bottom");
  });
});

describe("classifyDetectedText", () => {
  it("reconhece um gancho grande e persistente no topo", () => {
    const lines = [0, 0.5, 1].map((t) =>
      line({ text: "A DECISAO PARECIA CRUEL MAS SALVOU VIDAS", timestampSeconds: t }),
    );
    const { existingCta, visibleText } = classifyDetectedText(lines, 3);
    expect(existingCta).not.toBeNull();
    expect(existingCta!.confidence).toBe("high");
    expect(visibleText[0].type).toBe("possible_hook");
  });

  it("não confunde legenda de diálogo com gancho", () => {
    const lines = [line({ text: "- Nao faca isso agora", top: 1700, height: 50, timestampSeconds: 1 })];
    const { existingCta, visibleText } = classifyDetectedText(lines, 4);
    expect(visibleText[0].type).toBe("possible_subtitle");
    expect(existingCta).toBeNull();
  });

  it("reconhece o @ do perfil como marca, não como título", () => {
    const { visibleText } = classifyDetectedText(
      [line({ text: "@cortesdofilme", top: 40, width: 200, height: 30 })],
      3,
    );
    expect(visibleText[0].type).toBe("possible_handle");
  });

  it("marca chamada de plataforma como marca d'água", () => {
    const { visibleText } = classifyDetectedText([line({ text: "Se inscreva no canal" })], 3);
    expect(visibleText[0].type).toBe("possible_watermark");
  });

  it("encontra gancho que só aparece depois de uma animação", () => {
    const lines = [2, 3, 5].map((t) =>
      line({ text: "O QUE ELE FEZ DEPOIS MUDOU TUDO", timestampSeconds: t }),
    );
    const { existingCta } = classifyDetectedText(lines, 6);
    expect(existingCta?.firstSeenAtSeconds).toBe(2);
  });

  it("baixa a confiança quando o OCR leu mal", () => {
    const lines = [line({ text: "ELE NAO ESPERAVA ESSA RESPOSTA", confidence: 0.35, height: 40 })];
    const { existingCta } = classifyDetectedText(lines, 1);
    // Leitura fraca não vira afirmação: ou não há CTA, ou ele não é de alta confiança.
    expect(existingCta?.confidence ?? "low").not.toBe("high");
  });

  it("agrupa a mesma frase lida com ruído entre frames", () => {
    const { visibleText } = classifyDetectedText(
      [
        line({ text: "A DECISAO PARECIA CRUEL", timestampSeconds: 0 }),
        line({ text: "A DECISAO PARECIA CRUELL", timestampSeconds: 0.5 }),
      ],
      2,
    );
    expect(visibleText).toHaveLength(1);
    expect(visibleText[0].persistence).toBe(2);
  });
});

describe("normalizeText", () => {
  it("ignora acento, caixa e pontuação", () => {
    expect(normalizeText("Ação, é isso!")).toBe("ACAO E ISSO");
  });
});

describe("CTA fixo x legenda de diálogo", () => {
  // Casos medidos no acervo real em 2026-09-18: 32 vídeos analisados, 7 CTAs
  // corretos (persistência de 8 a 12 frames) e 13 falsos positivos (todos com
  // persistência 1). Vários dos falsos eram texto perfeitamente legível, o que
  // torna a confiança do OCR inútil para separá-los. O que separa é aparecer
  // em mais de um instante.
  it("não promove a CTA um texto que aparece em um único frame", () => {
    const lines = [
      line({ text: "EU SOU O ARQUEIRO VERDE", timestampSeconds: 3, top: 200, confidence: 0.96 }),
    ];
    const { existingCta } = classifyDetectedText(lines, 8);
    expect(existingCta).toBeNull();
  });

  it("promove o mesmo texto quando ele permanece em vários frames", () => {
    const lines = [0, 2, 4, 6].map((t) =>
      line({ text: "EU SOU O ARQUEIRO VERDE", timestampSeconds: t, top: 200, confidence: 0.96 }),
    );
    const { existingCta } = classifyDetectedText(lines, 8);
    expect(existingCta).not.toBeNull();
    expect(existingCta!.text).toContain("ARQUEIRO VERDE");
  });

  it("ainda avalia um vídeo do qual só se conseguiu um frame", () => {
    // Com um frame só não há como medir permanência; exigir persistência
    // aqui seria transformar "não deu para verificar" em "não tem CTA".
    const lines = [line({ text: "A CIDADE TINHA SO 1 SEGUNDO DE VIDA", timestampSeconds: 0, top: 200 })];
    const { existingCta } = classifyDetectedText(lines, 1);
    expect(existingCta).not.toBeNull();
  });
});
