import { describe, expect, it } from "vitest";
import {
  averageHashFromGray,
  hammingDistance,
  isNearDuplicate,
  selectFrameTimestamps,
} from "../src/lib/media/frames";

describe("selectFrameTimestamps", () => {
  it("nunca pede um frame além da duração real", () => {
    for (const duration of [0.4, 1, 2.5, 3, 4.9, 7, 30, 180]) {
      const stamps = selectFrameTimestamps(duration, 12);
      expect(stamps.every((t) => t <= duration)).toBe(true);
    }
  });

  it("não tenta extrair aos 5s de um vídeo de 3s", () => {
    expect(selectFrameTimestamps(3, 12)).not.toContain(5);
  });

  it("cobre o início, onde o gancho costuma estar", () => {
    const stamps = selectFrameTimestamps(20, 12);
    expect(stamps.slice(0, 4)).toEqual([0, 0.5, 1, 2]);
  });

  it("respeita o limite de imagens por vídeo", () => {
    for (const max of [2, 4, 6, 8, 12, 20]) {
      expect(selectFrameTimestamps(60, max).length).toBeLessThanOrEqual(max);
    }
  });

  it("não devolve instantes colados", () => {
    const stamps = selectFrameTimestamps(1.2, 12);
    for (let i = 1; i < stamps.length; i += 1) {
      expect(stamps[i] - stamps[i - 1]).toBeGreaterThanOrEqual(0.25);
    }
  });

  it("aguenta duração inválida", () => {
    expect(selectFrameTimestamps(0, 12)).toEqual([0]);
    expect(selectFrameTimestamps(Number.NaN, 12)).toEqual([0]);
  });
});

describe("average hash", () => {
  it("gera 16 dígitos hexadecimais", () => {
    const bytes = new Uint8Array(64).map((_, i) => i * 4);
    expect(averageHashFromGray(bytes)).toHaveLength(16);
  });

  it("identifica frames quase idênticos", () => {
    const base = new Uint8Array(64).map((_, i) => (i < 32 ? 10 : 240));
    const almost = new Uint8Array(base);
    almost[0] = 12;
    const a = averageHashFromGray(base);
    const b = averageHashFromGray(almost);
    expect(hammingDistance(a, b)).toBeLessThanOrEqual(2);
    expect(isNearDuplicate(b, [a])).toBe(true);
  });

  it("distingue frames diferentes", () => {
    const a = averageHashFromGray(new Uint8Array(64).map((_, i) => (i < 32 ? 0 : 255)));
    const b = averageHashFromGray(new Uint8Array(64).map((_, i) => (i % 2 ? 0 : 255)));
    expect(isNearDuplicate(b, [a])).toBe(false);
  });
});
