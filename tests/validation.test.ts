import { describe, expect, it } from "vitest";
import {
  extractJson,
  InvalidModelOutput,
  parseSceneAnalysis,
  validateCtaResult,
} from "../src/lib/pipeline/validation";
import type { CtaOptions, SceneAnalysis } from "../src/lib/types";

const OPTIONS: CtaOptions = {
  count: 6,
  language: "pt-BR",
  creativity: 0.7,
  avoidSpoilers: true,
  useExistingCtaAsReference: true,
  styleExamples: [],
};

const ANALYSIS: SceneAnalysis = {
  sceneSummary: "Um personagem precisa tomar uma decisão sob ameaça imediata.",
  plot: null,
  keyLines: [],
  analysisLimitations: [],
  conflict: "decisão sob ameaça",
  curiosity: "o motivo da decisão",
  withhold: "ele salva todos ao desobedecer a ordem",
  speculation: [],
  existingCta: null,
  work: null,
};

describe("extractJson", () => {
  it("lê JSON puro", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("lê JSON dentro de bloco de código", () => {
    expect(extractJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
  });

  it("lê JSON com texto em volta", () => {
    expect(extractJson('Claro! {"a":3} espero ter ajudado')).toEqual({ a: 3 });
  });

  it("recusa resposta sem objeto", () => {
    expect(() => extractJson("desculpe, não consigo")).toThrow(InvalidModelOutput);
  });
});

describe("parseSceneAnalysis", () => {
  it("rebaixa obra 'identificada' sem título", () => {
    const parsed = parseSceneAnalysis({
      sceneSummary: "Cena tensa.",
      work: { title: null, confidence: "high", status: "identified", evidence: [], sources: [] },
    });
    expect(parsed.work?.status).toBe("not_identified_safely");
    expect(parsed.work?.confidence).toBe("low");
  });

  it("recusa saída sem resumo", () => {
    expect(() => parseSceneAnalysis({ analysisLimitations: [] })).toThrow(InvalidModelOutput);
  });
});

describe("validateCtaResult", () => {
  const suggestions = [
    { text: "Ele precisava decidir antes que fosse tarde", style: "suspense" },
    { text: "A ordem era clara, a consciência não", style: "conflito" },
    { text: "Parecia crueldade até alguém explicar", style: "curiosidade" },
    { text: "Ninguém esperava essa virada", style: "reviravolta" },
    { text: "A decisão que ele levaria para sempre", style: "emocional" },
    { text: "Dez segundos para decidir", style: "ultracurto" },
  ];

  it("aceita uma saída bem formada", () => {
    const result = validateCtaResult(
      { recommendedCta: { text: suggestions[2].text, reason: "Cria curiosidade sem antecipar." }, suggestions },
      OPTIONS,
      ANALYSIS,
    );
    expect(result.suggestions).toHaveLength(6);
    expect(result.recommendationReplaced).toBe(false);
  });

  it("descarta fórmulas genéricas", () => {
    const result = validateCtaResult(
      {
        recommendedCta: { text: suggestions[0].text, reason: "Mostra o conflito sem entregar o desfecho." },
        suggestions: [...suggestions, { text: "Você não vai acreditar no final", style: "curiosidade" }],
      },
      OPTIONS,
      ANALYSIS,
    );
    expect(result.suggestions.some((s) => s.text.includes("não vai acreditar"))).toBe(false);
    expect(result.issues.join(" ")).toMatch(/genérica/);
  });

  it("promove outro candidato quando a recomendação não está entre as sugestões", () => {
    const result = validateCtaResult(
      { recommendedCta: { text: "Algo completamente diferente disso aqui", reason: "porque sim" }, suggestions },
      OPTIONS,
      ANALYSIS,
    );
    expect(result.recommendationReplaced).toBe(true);
    expect(result.suggestions.map((s) => s.text)).toContain(result.recommendedCta.text);
  });

  it("recusa saída fora do contrato", () => {
    expect(() => validateCtaResult({ suggestions: [] }, OPTIONS, ANALYSIS)).toThrow(InvalidModelOutput);
  });

  it("registra quando a quantidade não bate", () => {
    const result = validateCtaResult(
      { recommendedCta: { text: suggestions[0].text, reason: "Mostra o conflito sem entregar o desfecho." }, suggestions: suggestions.slice(0, 3) },
      OPTIONS,
      ANALYSIS,
    );
    expect(result.issues.join(" ")).toMatch(/Foram pedidas 6/);
  });
});
