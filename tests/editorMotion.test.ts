import { describe, expect, it } from "vitest";
import {
  confidenceLevel,
  detectContentRect,
  projections,
  smooth,
  spanAboveFraction,
  temporalMotion,
} from "../src/lib/editor/motion";

const W = 90;
const H = 160;

/** Monta um mapa de movimento com um bloco "em movimento" dentro de uma moldura parada. */
function mapWithBlock(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  inside = 40,
  outside = 0,
): Float32Array {
  const m = new Float32Array(W * H).fill(outside);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) m[y * W + x] = inside;
  }
  return m;
}

describe("variação temporal", () => {
  it("dá zero quando nada muda entre os frames", () => {
    const a = new Uint8Array(4).fill(120);
    const b = new Uint8Array(4).fill(120);
    const m = temporalMotion([a, b], 2, 2);
    expect(Array.from(m)).toEqual([0, 0, 0, 0]);
  });

  it("mede a diferença média entre frames consecutivos", () => {
    const f1 = new Uint8Array([0, 0, 0, 0]);
    const f2 = new Uint8Array([10, 0, 0, 0]);
    const f3 = new Uint8Array([30, 0, 0, 0]);
    const m = temporalMotion([f1, f2, f3], 2, 2);
    // |10-0| = 10 e |30-10| = 20, média 15.
    expect(m[0]).toBeCloseTo(15);
    expect(m[1]).toBe(0);
  });

  it("devolve tudo zero com um frame só, em vez de quebrar", () => {
    const m = temporalMotion([new Uint8Array(4).fill(7)], 2, 2);
    expect(Array.from(m)).toEqual([0, 0, 0, 0]);
  });
});

describe("projeção e span", () => {
  it("acha o início e o fim do trecho com movimento", () => {
    const p = new Float32Array([0, 0, 10, 10, 10, 0, 0]);
    expect(spanAboveFraction(p, 0.3)).toEqual([2, 4]);
  });

  it("não parte o conteúdo ao meio quando uma cena escura derruba o movimento", () => {
    // O vale no meio é uma cena parada, não o fim da região do vídeo.
    const p = new Float32Array([0, 10, 10, 1, 10, 10, 0]);
    expect(spanAboveFraction(p, 0.3)).toEqual([1, 5]);
  });

  it("devolve o perfil inteiro quando não há movimento nenhum", () => {
    expect(spanAboveFraction(new Float32Array(5), 0.3)).toEqual([0, 4]);
  });

  it("a suavização apaga um pico de um pixel só", () => {
    const s = smooth(new Float32Array([0, 0, 30, 0, 0]));
    expect(s[2]).toBeCloseTo(10);
    expect(s[2]).toBeLessThan(30);
  });

  it("projeta linhas e colunas com as médias certas", () => {
    const m = mapWithBlock(10, 20, 79, 139);
    const { columns, rows } = projections(m, W, H);
    expect(columns[0]).toBe(0);
    expect(columns[40]).toBeGreaterThan(0);
    expect(rows[0]).toBe(0);
    expect(rows[80]).toBeGreaterThan(0);
  });
});

describe("detecção da região útil", () => {
  it("encontra o retângulo do conteúdo dentro de uma moldura parada", () => {
    const r = detectContentRect(mapWithBlock(9, 32, 80, 127), W, H);
    expect(r.hasBorder).toBe(true);

    const left = r.rect.x * W;
    const top = r.rect.y * H;
    const right = (r.rect.x + r.rect.width) * W;
    const bottom = (r.rect.y + r.rect.height) * H;

    // A suavização alarga o retângulo em até um pixel de análise por lado.
    // Sobrar é aceitável; faltar não. Cortar conteúdo é o pior erro possível
    // aqui (§108), e um recorte 1px maior é invisível no vídeo final.
    expect(left).toBeLessThanOrEqual(9);
    expect(left).toBeGreaterThanOrEqual(9 - 2);
    expect(top).toBeLessThanOrEqual(32);
    expect(top).toBeGreaterThanOrEqual(32 - 2);
    expect(right).toBeGreaterThanOrEqual(81);
    expect(right).toBeLessThanOrEqual(81 + 2);
    expect(bottom).toBeGreaterThanOrEqual(128);
    expect(bottom).toBeLessThanOrEqual(128 + 2);
  });

  it("nunca corta o conteúdo, qualquer que seja a posição do bloco", () => {
    for (const [x0, y0, x1, y1] of [
      [5, 10, 40, 60],
      [20, 50, 85, 150],
      [0, 0, 45, 80],
      [44, 79, 89, 159],
    ]) {
      const r = detectContentRect(mapWithBlock(x0, y0, x1, y1), W, H);
      expect(r.rect.x * W).toBeLessThanOrEqual(x0);
      expect(r.rect.y * H).toBeLessThanOrEqual(y0);
      expect((r.rect.x + r.rect.width) * W).toBeGreaterThanOrEqual(x1 + 1);
      expect((r.rect.y + r.rect.height) * H).toBeGreaterThanOrEqual(y1 + 1);
    }
  });

  it("dá confiança alta quando a moldura está totalmente parada", () => {
    const r = detectContentRect(mapWithBlock(9, 32, 80, 127, 40, 0), W, H);
    expect(r.confidence).toBeGreaterThanOrEqual(85);
    expect(confidenceLevel(r.confidence)).toBe("alta");
  });

  it("baixa a confiança quando a moldura também se mexe", () => {
    const nitido = detectContentRect(mapWithBlock(9, 32, 80, 127, 40, 0), W, H);
    const ruidoso = detectContentRect(mapWithBlock(9, 32, 80, 127, 40, 18), W, H);
    expect(ruidoso.confidence).toBeLessThan(nitido.confidence);
  });

  it("não afirma recorte quando o conteúdo ocupa o quadro inteiro", () => {
    const r = detectContentRect(mapWithBlock(0, 0, W - 1, H - 1), W, H);
    expect(r.hasBorder).toBe(false);
    expect(r.confidence).toBe(0);
  });

  it("não inventa região num vídeo sem movimento nenhum", () => {
    const r = detectContentRect(new Float32Array(W * H), W, H);
    expect(r.hasBorder).toBe(false);
    expect(r.confidence).toBe(0);
  });

  it("o retângulo detectado nunca sai do quadro", () => {
    const r = detectContentRect(mapWithBlock(0, 0, 40, 40), W, H);
    expect(r.rect.x).toBeGreaterThanOrEqual(0);
    expect(r.rect.y).toBeGreaterThanOrEqual(0);
    expect(r.rect.x + r.rect.width).toBeLessThanOrEqual(1);
    expect(r.rect.y + r.rect.height).toBeLessThanOrEqual(1);
  });
});

describe("faixas de confiança (§22)", () => {
  it("classifica nas três faixas da spec", () => {
    expect(confidenceLevel(94)).toBe("alta");
    expect(confidenceLevel(85)).toBe("alta");
    expect(confidenceLevel(84)).toBe("revisar");
    expect(confidenceLevel(60)).toBe("revisar");
    expect(confidenceLevel(58)).toBe("baixa");
  });
});
