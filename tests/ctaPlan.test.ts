import { describe, expect, it } from "vitest";
import {
  dedupeSuggestions,
  describeDistribution,
  evaluateCta,
  isGeneric,
  styleDistribution,
} from "../src/lib/pipeline/ctaPlan";
import { CTA_STYLES } from "../src/lib/types";

describe("styleDistribution", () => {
  it("a soma bate com a quantidade pedida", () => {
    for (let count = 3; count <= 24; count += 1) {
      const dist = styleDistribution(count);
      const total = Object.values(dist).reduce((a, b) => a + b, 0);
      expect(total, `quantidade ${count}`).toBe(count);
    }
  });

  it("no padrão de 10 cobre todos os estilos sem estourar", () => {
    const dist = styleDistribution(10);
    expect(Object.values(dist).reduce((a, b) => a + b, 0)).toBe(10);
    for (const style of CTA_STYLES) expect(dist[style]).toBeGreaterThanOrEqual(1);
  });

  it("com menos estilos do que categorias, prioriza as principais", () => {
    const dist = styleDistribution(3);
    expect(dist.curiosidade).toBe(1);
    expect(dist.suspense).toBe(1);
    expect(dist.conflito).toBe(1);
    expect(dist.ultracurto).toBe(0);
  });

  it("descreve a distribuição em texto coerente", () => {
    expect(describeDistribution(10)).toMatch(/curiosidade/);
  });
});

describe("isGeneric", () => {
  it("pega fórmulas vazias mesmo com acento e caixa diferentes", () => {
    expect(isGeneric("Você não vai acreditar no que aconteceu")).toBe(true);
    expect(isGeneric("ASSISTA ATÉ O FINAL")).toBe(true);
    expect(isGeneric("Ele precisava decidir antes que fosse tarde")).toBe(false);
  });
});

describe("evaluateCta", () => {
  const sceneTerms = ["decisão", "refém", "delegado"];

  it("penaliza quem entrega a resolução", () => {
    const spoiler = evaluateCta(
      { text: "O delegado solta o refém no final", style: "suspense" },
      { others: [], withhold: "o delegado solta o refém", sceneTerms },
    );
    expect(spoiler.spoiler).toBe(0);
    expect(spoiler.notes.join(" ")).toMatch(/antecipar/);
  });

  it("premia frase ancorada na cena", () => {
    const good = evaluateCta(
      { text: "A decisão do delegado parecia cruel…", style: "curiosidade" },
      { others: [], withhold: "ele salva todos", sceneTerms },
    );
    const vague = evaluateCta(
      { text: "Algo inacreditável estava por vir", style: "curiosidade" },
      { others: [], withhold: "ele salva todos", sceneTerms },
    );
    expect(good.total).toBeGreaterThan(vague.total);
  });

  it("marca ultracurto acima de 7 palavras", () => {
    const result = evaluateCta(
      { text: "Uma decisão tomada em silêncio mudou o destino de todos ali", style: "ultracurto" },
      { others: [], sceneTerms: [] },
    );
    expect(result.notes.join(" ")).toMatch(/ultracurto/);
  });
});

describe("dedupeSuggestions", () => {
  it("remove paráfrases quase idênticas", () => {
    const out = dedupeSuggestions([
      { text: "Ele precisava decidir antes que fosse tarde", style: "suspense" },
      { text: "Ele precisava decidir antes que fosse tarde", style: "conflito" },
      { text: "Uma escolha impossível em dez segundos", style: "conflito" },
    ]);
    expect(out).toHaveLength(2);
  });
});
