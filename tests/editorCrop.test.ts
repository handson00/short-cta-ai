import { describe, expect, it } from "vitest";
import {
  clampRect,
  fromPixels,
  isFullFrame,
  MIN_CROP,
  resizeRect,
  toPixels,
  FULL_FRAME,
} from "../src/lib/editor/crop";

/**
 * O recorte é guardado em fração do quadro, não em pixel, para o mesmo valor
 * servir a 720x1280 e a 1080x1920. Os casos abaixo travam justamente as
 * conversões e os limites — errar aqui corta o conteúdo do vídeo.
 */

describe("arraste do retângulo", () => {
  const start = { x: 0.2, y: 0.2, width: 0.5, height: 0.5 };

  it("move o retângulo inteiro sem mudar o tamanho", () => {
    const r = resizeRect(start, "move", 0.1, -0.05);
    expect(r.x).toBeCloseTo(0.3);
    expect(r.y).toBeCloseTo(0.15);
    expect(r.width).toBeCloseTo(0.5);
    expect(r.height).toBeCloseTo(0.5);
  });

  it("não deixa o retângulo sair pela borda ao ser movido", () => {
    const r = resizeRect(start, "move", 5, 5);
    expect(r.x).toBeCloseTo(0.5);
    expect(r.y).toBeCloseTo(0.5);
    expect(r.x + r.width).toBeLessThanOrEqual(1);
    expect(r.y + r.height).toBeLessThanOrEqual(1);
  });

  it("ao puxar a borda esquerda, move x e compensa na largura", () => {
    const r = resizeRect(start, "w", 0.1, 0);
    expect(r.x).toBeCloseTo(0.3);
    expect(r.width).toBeCloseTo(0.4);
    // A borda direita fica parada: é isso que diferencia redimensionar de mover.
    expect(r.x + r.width).toBeCloseTo(start.x + start.width);
  });

  it("ao puxar a borda inferior, só a altura muda", () => {
    const r = resizeRect(start, "s", 0, 0.2);
    expect(r.y).toBeCloseTo(0.2);
    expect(r.height).toBeCloseTo(0.7);
  });

  it("respeita o tamanho mínimo em vez de inverter o retângulo", () => {
    const r = resizeRect(start, "e", -10, 0);
    expect(r.width).toBeCloseTo(MIN_CROP);
    expect(r.width).toBeGreaterThan(0);
  });

  it("redimensiona nos dois eixos quando o handle é de canto", () => {
    const r = resizeRect(start, "se", 0.1, 0.1);
    expect(r.width).toBeCloseTo(0.6);
    expect(r.height).toBeCloseTo(0.6);
  });
});

describe("normalização", () => {
  it("traz de volta para dentro do quadro um retângulo que estourou", () => {
    const r = clampRect({ x: 0.8, y: 0.9, width: 0.5, height: 0.4 });
    expect(r.x + r.width).toBeLessThanOrEqual(1);
    expect(r.y + r.height).toBeLessThanOrEqual(1);
  });

  it("reconhece o quadro inteiro como ausência de recorte", () => {
    expect(isFullFrame(FULL_FRAME)).toBe(true);
    expect(isFullFrame({ x: 0.1, y: 0, width: 0.9, height: 1 })).toBe(false);
  });
});

describe("conversão entre fração e pixel", () => {
  it("converte para pixels da fonte", () => {
    const px = toPixels({ x: 0.1, y: 0.2, width: 0.8, height: 0.5 }, 1080, 1920);
    expect(px.x).toBe(108);
    expect(px.y).toBe(384);
    expect(px.width).toBe(864);
    expect(px.height).toBe(960);
  });

  it("arredonda para par, porque H.264 em yuv420p recusa lado ímpar", () => {
    const px = toPixels({ x: 0, y: 0, width: 0.8435, height: 0.5 }, 1080, 1920);
    expect(px.width % 2).toBe(0);
    expect(px.height % 2).toBe(0);
  });

  it("nunca deixa o recorte ultrapassar o quadro em pixel", () => {
    const px = toPixels({ x: 0.99, y: 0.99, width: 1, height: 1 }, 1080, 1920);
    expect(px.x + px.width).toBeLessThanOrEqual(1080);
    expect(px.y + px.height).toBeLessThanOrEqual(1920);
  });

  it("volta de pixel para fração mantendo a mesma região", () => {
    const original = { x: 0.1, y: 0.2, width: 0.8, height: 0.5 };
    const voltou = fromPixels(toPixels(original, 1080, 1920), 1080, 1920);
    expect(voltou.x).toBeCloseTo(original.x, 2);
    expect(voltou.y).toBeCloseTo(original.y, 2);
    expect(voltou.width).toBeCloseTo(original.width, 2);
    expect(voltou.height).toBeCloseTo(original.height, 2);
  });

  it("o mesmo recorte vale para resoluções diferentes", () => {
    const rect = { x: 0.0759, y: 0.1947, width: 0.8481, height: 0.5052 };
    const hd = toPixels(rect, 720, 1280);
    const fhd = toPixels(rect, 1080, 1920);
    expect(hd.width / 720).toBeCloseTo(fhd.width / 1080, 2);
    expect(hd.height / 1280).toBeCloseTo(fhd.height / 1920, 2);
  });

  it("devolve o quadro inteiro quando a resolução é desconhecida", () => {
    expect(fromPixels({ x: 0, y: 0, width: 10, height: 10 }, 0, 0)).toEqual(FULL_FRAME);
  });
});
