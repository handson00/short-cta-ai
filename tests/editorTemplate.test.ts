import { describe, expect, it } from "vitest";
import { FULL_FRAME as FULL_FRAME_RECT } from "../src/lib/editor/crop";
import {
  cropRegionTransform,
  croppedAspect,
  DEFAULT_TEMPLATE,
  fromCanvasFraction,
  logoRect,
  placeVideoInSlot,
  slotFromNormalized,
  slotToNormalized,
  toCanvasFraction,
  validateTemplateConfig,
} from "../src/lib/editor/template";
import type { EditorTemplateConfig } from "../src/lib/types";

/**
 * A mesma conta serve ao preview e à exportação (spec §86). Se estes testes
 * passarem e o vídeo ainda sair deformado, o defeito está no renderizador,
 * não aqui.
 */

const slot: EditorTemplateConfig = {
  canvasWidth: 1080,
  canvasHeight: 1920,
  videoX: 40,
  videoY: 400,
  videoWidth: 1000,
  videoHeight: 1000, // slot quadrado, para o fit/fill ficar evidente
  fitMode: "fit",
};

describe("encaixe do vídeo no slot", () => {
  it("FIT: um vídeo deitado cabe inteiro e sobra espaço em cima e embaixo", () => {
    const r = placeVideoInSlot(16 / 9, slot, "fit");
    expect(r.width).toBeCloseTo(1000);
    expect(r.height).toBeCloseTo(562.5);
    // Centralizado no slot.
    expect(r.x).toBeCloseTo(40);
    expect(r.y).toBeCloseTo(400 + (1000 - 562.5) / 2);
  });

  it("FIT: um vídeo em pé cabe inteiro e sobra espaço dos lados", () => {
    const r = placeVideoInSlot(9 / 16, slot, "fit");
    expect(r.height).toBeCloseTo(1000);
    expect(r.width).toBeCloseTo(562.5);
    expect(r.y).toBeCloseTo(400);
    expect(r.x).toBeCloseTo(40 + (1000 - 562.5) / 2);
  });

  it("FILL: preenche o slot inteiro, estourando o lado maior", () => {
    const r = placeVideoInSlot(16 / 9, slot, "fill");
    expect(r.height).toBeCloseTo(1000);
    expect(r.width).toBeCloseTo(1777.78, 1);
    // Estoura o slot dos dois lados, simetricamente — é o corte esperado.
    expect(r.x).toBeLessThan(slot.videoX);
  });

  it("FIT nunca estoura o slot; FILL nunca deixa buraco", () => {
    for (const aspect of [0.5, 9 / 16, 1, 4 / 3, 16 / 9, 2.5]) {
      const fit = placeVideoInSlot(aspect, slot, "fit");
      expect(fit.width).toBeLessThanOrEqual(slot.videoWidth + 0.01);
      expect(fit.height).toBeLessThanOrEqual(slot.videoHeight + 0.01);

      const fill = placeVideoInSlot(aspect, slot, "fill");
      expect(fill.width).toBeGreaterThanOrEqual(slot.videoWidth - 0.01);
      expect(fill.height).toBeGreaterThanOrEqual(slot.videoHeight - 0.01);
    }
  });

  it("não deforma o vídeo: a proporção de saída é sempre a de entrada", () => {
    for (const aspect of [0.5, 9 / 16, 1, 16 / 9]) {
      for (const mode of ["fit", "fill"] as const) {
        const r = placeVideoInSlot(aspect, slot, mode);
        expect(r.width / r.height).toBeCloseTo(aspect, 4);
      }
    }
  });

  it("um vídeo com a mesma proporção do slot dá o mesmo resultado nos dois modos", () => {
    const fit = placeVideoInSlot(1, slot, "fit");
    const fill = placeVideoInSlot(1, slot, "fill");
    expect(fit.width).toBeCloseTo(fill.width);
    expect(fit.height).toBeCloseTo(fill.height);
  });
});

describe("proporção do recorte", () => {
  it("usa a proporção do recorte, não a do arquivo", () => {
    // Recortar a metade de cima de um 1080x1920 dá um quadrado.
    const a = croppedAspect({ x: 0, y: 0, width: 1, height: 0.5625 }, 1080, 1920);
    expect(a).toBeCloseTo(1, 3);
  });

  it("sem recorte, usa a proporção do arquivo", () => {
    expect(croppedAspect(null, 1080, 1920)).toBeCloseTo(0.5625);
  });

  it("não divide por zero quando a resolução é desconhecida", () => {
    expect(croppedAspect(null, 0, 0)).toBeCloseTo(9 / 16);
  });
});

describe("slot em fração e em pixel", () => {
  it("vai e volta mantendo a mesma região", () => {
    const norm = slotToNormalized(slot);
    const back = slotFromNormalized(norm, slot);
    expect(back.videoX).toBe(slot.videoX);
    expect(back.videoY).toBe(slot.videoY);
    expect(back.videoWidth).toBe(slot.videoWidth);
    expect(back.videoHeight).toBe(slot.videoHeight);
  });

  it("arredonda para par, porque H.264 recusa lado ímpar", () => {
    const back = slotFromNormalized({ x: 0, y: 0, width: 0.8435, height: 0.5 }, slot);
    expect(back.videoWidth % 2).toBe(0);
    expect(back.videoHeight % 2).toBe(0);
  });

  it("nunca deixa o slot sair do canvas", () => {
    const back = slotFromNormalized({ x: 0.99, y: 0.99, width: 1, height: 1 }, slot);
    expect(back.videoX + back.videoWidth).toBeLessThanOrEqual(back.canvasWidth);
    expect(back.videoY + back.videoHeight).toBeLessThanOrEqual(back.canvasHeight);
  });
});

describe("o template mostra a mesma região que o recorte", () => {
  /**
   * O defeito que estes testes travam: a caixa recebia a proporção do recorte,
   * mas a imagem desenhada dentro era o quadro inteiro. O template mostrava o
   * vídeo todo espremido, em vez da região recortada.
   */
  const placement = { width: 800, height: 400 };

  it("a região do recorte cobre exatamente a caixa", () => {
    const crop = { x: 0.25, y: 0.5, width: 0.5, height: 0.25 };
    const t = cropRegionTransform(placement, crop);

    // A borda esquerda do recorte tem de cair em 0, e a direita na largura.
    expect(t.left + crop.x * t.width).toBeCloseTo(0);
    expect(t.left + (crop.x + crop.width) * t.width).toBeCloseTo(placement.width);
    expect(t.top + crop.y * t.height).toBeCloseTo(0);
    expect(t.top + (crop.y + crop.height) * t.height).toBeCloseTo(placement.height);
  });

  it("um recorte menor amplia a imagem, em vez de espremê-la", () => {
    const t = cropRegionTransform(placement, { x: 0, y: 0, width: 0.5, height: 0.5 });
    expect(t.width).toBeCloseTo(1600);
    expect(t.height).toBeCloseTo(800);
  });

  it("sem recorte, a imagem ocupa a caixa sem deslocamento", () => {
    const t = cropRegionTransform(placement, FULL_FRAME_RECT);
    expect(t.width).toBeCloseTo(placement.width);
    expect(t.height).toBeCloseTo(placement.height);
    expect(t.left).toBeCloseTo(0);
    expect(t.top).toBeCloseTo(0);
  });

  it("não divide por zero num recorte degenerado", () => {
    const t = cropRegionTransform(placement, { x: 0, y: 0, width: 0, height: 0 });
    expect(Number.isFinite(t.width)).toBe(true);
    expect(Number.isFinite(t.height)).toBe(true);
  });
});

describe("logo fixa", () => {
  it("o padrão traz uma posição utilizável, sem precisar configurar", () => {
    const l = logoRect(DEFAULT_TEMPLATE);
    expect(l.width).toBeGreaterThan(0);
    expect(l.x + l.width).toBeLessThanOrEqual(DEFAULT_TEMPLATE.canvasWidth);
    expect(l.y + l.height).toBeLessThanOrEqual(DEFAULT_TEMPLATE.canvasHeight);
  });

  it("a posição da logo vai e volta entre fração e pixel", () => {
    const original = { x: 100, y: 200, width: 300, height: 150 };
    const back = fromCanvasFraction(toCanvasFraction(original, slot), slot);
    expect(back).toEqual(original);
  });

  it("a logo nunca sai do canvas ao ser arrastada para fora", () => {
    const px = fromCanvasFraction({ x: 0.98, y: 0.98, width: 0.5, height: 0.5 }, slot);
    expect(px.x + px.width).toBeLessThanOrEqual(slot.canvasWidth);
    expect(px.y + px.height).toBeLessThanOrEqual(slot.canvasHeight);
  });

  it("só valida a logo quando existe uma imagem de logo", () => {
    // Posição inválida, mas sem logo não há o que validar.
    const semLogo = { ...slot, logoX: 9000, logoWidth: 400 };
    expect(validateTemplateConfig(semLogo)).toBeNull();
    expect(validateTemplateConfig({ ...semLogo, logo: "tpl_x.png" })).toMatch(/logo/i);
  });
});

describe("validação do template", () => {
  it("aceita cor de fundo em #RRGGBB", () => {
    expect(validateTemplateConfig({ ...slot, backgroundColor: "#1a2b3c" })).toBeNull();
  });

  it("recusa cor de fundo malformada", () => {
    expect(validateTemplateConfig({ ...slot, backgroundColor: "azul" })).toMatch(/#RRGGBB/);
  });

  it("aceita o template padrão", () => {
    expect(validateTemplateConfig(DEFAULT_TEMPLATE)).toBeNull();
  });

  it("recusa slot que ultrapassa o canvas, dizendo qual borda", () => {
    const erro = validateTemplateConfig({ ...slot, videoX: 900, videoWidth: 1000 });
    expect(erro).toMatch(/direita/i);
  });

  it("recusa canvas com lado ímpar", () => {
    expect(validateTemplateConfig({ ...slot, canvasWidth: 1081 })).toMatch(/pares/i);
  });

  it("recusa área de vídeo degenerada", () => {
    expect(validateTemplateConfig({ ...slot, videoHeight: 0 })).not.toBeNull();
  });
});
