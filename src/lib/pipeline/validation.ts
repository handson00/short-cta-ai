import { z } from "zod";
import { type CtaOptions, type CtaResult, type CtaStyle, type CtaSuggestion, type SceneAnalysis } from "../types";
import { dedupeSuggestions, evaluateCta, isGeneric, MAX_CHARS, similarity, styleDistribution } from "./ctaPlan";

/**
 * O modelo pode devolver JSON invalido, com campos a mais, com aspas tortas ou
 * embrulhado em bloco de codigo. O backend nunca salva um resultado que nao
 * passou por aqui.
 */

export class InvalidModelOutput extends Error {
  constructor(
    message: string,
    readonly issues: string[],
  ) {
    super(message);
    this.name = "InvalidModelOutput";
  }
}

/** Extrai o primeiro objeto JSON de uma resposta possivelmente enfeitada. */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(body);
  } catch {
    // fallback: primeiro bloco balanceado entre chaves
  }

  const start = body.indexOf("{");
  if (start === -1) throw new InvalidModelOutput("Resposta sem objeto JSON", [raw.slice(0, 200)]);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < body.length; i += 1) {
    const ch = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        const candidate = body.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch (err) {
          throw new InvalidModelOutput("JSON malformado na resposta", [(err as Error).message]);
        }
      }
    }
  }
  throw new InvalidModelOutput("JSON incompleto na resposta", []);
}

const confidenceSchema = z.enum(["high", "medium", "low"]).catch("low");

const workSchema = z
  .object({
    title: z.string().trim().min(1).max(200).nullable().catch(null),
    originalTitle: z.string().trim().max(200).nullable().catch(null),
    year: z.number().int().min(1870).max(2100).nullable().catch(null),
    mediaType: z.enum(["movie", "series"]).nullable().catch(null),
    confidence: confidenceSchema,
    evidence: z.array(z.string().trim().max(400)).max(12).catch([]),
    sources: z.array(z.string().trim().max(400)).max(12).catch([]),
    status: z.enum(["identified", "not_identified_safely"]).catch("not_identified_safely"),
  })
  .nullable();

const sceneAnalysisSchema = z.object({
  sceneSummary: z.string().trim().min(1).max(600),
  analysisLimitations: z.array(z.string().trim().max(300)).max(12).catch([]),
  conflict: z.string().trim().max(400).nullable().catch(null),
  curiosity: z.string().trim().max(400).nullable().catch(null),
  withhold: z.string().trim().max(400).nullable().catch(null),
  speculation: z.array(z.string().trim().max(300)).max(12).catch([]),
  existingCta: z
    .object({
      text: z.string().trim().min(1).max(300),
      confidence: confidenceSchema,
      firstSeenAtSeconds: z.number().min(0).max(100_000).nullable().catch(null),
      strength: z.string().trim().max(300).nullable().catch(null),
      possibleImprovement: z.string().trim().max(300).nullable().catch(null),
    })
    .nullable()
    .catch(null),
  work: workSchema.catch(null),
});

export function parseSceneAnalysis(raw: unknown): SceneAnalysis {
  const result = sceneAnalysisSchema.safeParse(raw);
  if (!result.success) {
    throw new InvalidModelOutput(
      "A análise da cena não seguiu o contrato de saída",
      result.error.issues.map((i: any) => `${i.path.join(".") || "raiz"}: ${i.message}`),
    );
  }
  const value = result.data;

  // Uma obra "identificada" sem titulo e uma contradicao: rebaixamos.
  const work = value.work
    ? {
        title: value.work.title ?? null,
        originalTitle: value.work.originalTitle ?? null,
        year: value.work.year ?? null,
        mediaType: value.work.mediaType ?? null,
        status: value.work.title ? value.work.status : ("not_identified_safely" as const),
        confidence: value.work.title ? value.work.confidence : ("low" as const),
        evidence: value.work.evidence ?? [],
        sources: value.work.sources ?? [],
      }
    : null;

  return {
    sceneSummary: value.sceneSummary,
    analysisLimitations: value.analysisLimitations ?? [],
    conflict: value.conflict ?? null,
    curiosity: value.curiosity ?? null,
    withhold: value.withhold ?? null,
    speculation: value.speculation ?? [],
    existingCta: value.existingCta
      ? {
          text: value.existingCta.text,
          confidence: value.existingCta.confidence,
          firstSeenAtSeconds: value.existingCta.firstSeenAtSeconds ?? null,
          strength: value.existingCta.strength ?? null,
          possibleImprovement: value.existingCta.possibleImprovement ?? null,
        }
      : null,
    work,
  };
}

const ctaResultSchema = z.object({
  recommendedCta: z.object({
    text: z.string().trim().min(3).max(200),
    reason: z.string().trim().min(3).max(300),
  }),
  suggestions: z
    .array(
      z.object({
        text: z.string().trim().min(3).max(200),
        style: z.enum(["curiosidade", "suspense", "conflito", "reviravolta", "emocional", "ultracurto"] as const).catch("curiosidade"),
        reason: z.string().trim().max(300).nullish(),
      }),
    )
    .min(1)
    .max(40),
});

export interface ValidatedCtaResult extends CtaResult {
  issues: string[];
  /** true quando a recomendacao do modelo foi substituida pela melhor local. */
  recommendationReplaced: boolean;
}

/**
 * Valida tipos, comprimentos, categorias, duplicacoes e campos obrigatorios.
 * Quando a recomendacao do modelo nao se sustenta, promovemos o melhor
 * candidato pelos criterios da secao 6.3 em vez de perder o job inteiro.
 */
export function validateCtaResult(
  raw: unknown,
  options: CtaOptions,
  analysis: SceneAnalysis,
): ValidatedCtaResult {
  const parsed = ctaResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new InvalidModelOutput(
      "As sugestões não seguiram o contrato de saída",
      parsed.error.issues.map((i: any) => `${i.path.join(".") || "raiz"}: ${i.message}`),
    );
  }

  const issues: string[] = [];
  const distribution = styleDistribution(options.count);

  let suggestions: CtaSuggestion[] = dedupeSuggestions(
    parsed.data.suggestions.map((s: any) => ({ text: s.text, style: s.style, reason: s.reason ?? null })),
  );

  const tooLong = suggestions.filter((s: any) => s.text.length > MAX_CHARS);
  if (tooLong.length) issues.push(`${tooLong.length} sugestão(ões) acima de ${MAX_CHARS} caracteres.`);

  const generic = suggestions.filter((s: any) => isGeneric(s.text));
  if (generic.length) {
    issues.push(`${generic.length} sugestão(ões) com fórmula genérica foram descartadas.`);
    suggestions = suggestions.filter((s: any) => !isGeneric(s.text));
  }

  if (suggestions.length === 0) {
    throw new InvalidModelOutput("Nenhuma sugestão utilizável restou após a validação", issues);
  }

  if (suggestions.length !== options.count) {
    issues.push(`Foram pedidas ${options.count} sugestões e chegaram ${suggestions.length} utilizáveis.`);
  }

  for (const [style, expected] of Object.entries(distribution)) {
    if (expected === 0) continue;
    const got = suggestions.filter((s: any) => s.style === style).length;
    if (got === 0) issues.push(`Nenhuma sugestão do estilo ${style}.`);
  }

  const sceneTerms = [analysis.sceneSummary, analysis.conflict ?? "", analysis.curiosity ?? ""]
    .join(" ")
    .split(/\s+/)
    .filter((w: any) => w.length > 4)
    .slice(0, 40);

  const scored = suggestions
    .map((s: any) => ({ cta: s, evaluation: evaluateCta(s, { others: suggestions, withhold: analysis.withhold, sceneTerms }) }))
    .sort((a, b) => b.evaluation.total - a.evaluation.total);

  const modelChoice = parsed.data.recommendedCta;
  const matched = suggestions.find((s: any) => similarity(s.text, modelChoice.text) >= 0.85);
  let recommendationReplaced = false;

  let recommendedText = modelChoice.text;
  let recommendedReason = modelChoice.reason;

  const modelChoiceValid =
    Boolean(matched) && !isGeneric(modelChoice.text) && modelChoice.text.length <= MAX_CHARS;

  if (!modelChoiceValid) {
    const best = scored[0];
    recommendedText = best.cta.text;
    recommendedReason =
      best.evaluation.spoiler > 0
        ? "Apresenta o conflito sem revelar como a cena termina."
        : "Melhor equilíbrio entre fidelidade à cena e curiosidade entre as opções válidas.";
    recommendationReplaced = true;
    issues.push("A recomendação do modelo não passou na validação; promovemos o melhor candidato.");
  } else if (matched) {
    recommendedText = matched.text;
  }

  if (!suggestions.some((s: any) => s.text === recommendedText)) {
    suggestions.unshift({ text: recommendedText, style: "curiosidade", reason: recommendedReason });
  }

  return {
    recommendedCta: { text: recommendedText, reason: recommendedReason },
    suggestions,
    issues,
    recommendationReplaced,
  };
}

/** Resultado do CTA gerado a partir dos comentarios. */
export interface CommentCtaResult {
  suggestions: { text: string; style: CtaStyle; signal: string }[];
  recommendedIndex: number;
  audienceRead: string;
}

const commentCtaSchema = z.object({
  suggestions: z
    .array(
      z.object({
        text: z.string().min(3).max(MAX_CHARS),
        style: z.enum(["curiosidade", "suspense", "conflito", "reviravolta", "emocional", "ultracurto"] as const),
        // Exigir o sinal e o que impede um gancho inventado com os comentarios
        // de pano de fundo: sem apontar em que se apoia, nao entra.
        signal: z.string().min(3).max(300),
      }),
    )
    .min(1)
    .max(12),
  recommendedIndex: z.number().int().min(0),
  audienceRead: z.string().min(3).max(400),
});

export function validateCommentCtaResult(raw: unknown): CommentCtaResult {
  const parsed = commentCtaSchema.safeParse(raw);
  if (!parsed.success) {
    throw new InvalidModelOutput(
      "O CTA por comentários não seguiu o contrato de saída",
      parsed.error.issues.map((i: any) => `${i.path.join(".") || "raiz"}: ${i.message}`),
    );
  }
  const dados = parsed.data;

  // Duplicata nao acrescenta escolha, so ocupa espaco na tela.
  const vistos = new Set<string>();
  const suggestions = dados.suggestions.filter((sg) => {
    const chave = sg.text.trim().toLowerCase();
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
  if (suggestions.length === 0) {
    throw new InvalidModelOutput("O modelo não devolveu nenhum gancho aproveitável", []);
  }

  const recommendedIndex =
    dados.recommendedIndex < suggestions.length ? dados.recommendedIndex : 0;

  return { suggestions, recommendedIndex, audienceRead: dados.audienceRead };
}

export interface PublishKitResult {
  description: string;
  hashtags: string[];
  sendTrigger: string | null;
  titleStrategy: string | null;
  audienceRead: string | null;
}

/** Pedidos explicitos de engajamento fazem o Reels deixar de ser recomendado. */
const ISCA_DE_ENGAJAMENTO =
  /\b(comenta|comente|comentem|curta|curte|curtam|compartilh\w*|marca\s+(alguem|algu[ée]m|seu|sua)|salva\s+(esse|este|aqui)|salve\s+(esse|este)|manda\s+pra\s+geral|segue\s+(o\s+)?perfil|siga|inscreva)\b/i;

const HASHTAG_GENERICA = /^#(viral|fyp|foryou|foryoupage|explore|explorar|parati|tiktok|reels|instagram|trend|trending)$/i;

const publishKitSchema = z.object({
  description: z.string().min(10).max(1200),
  hashtags: z.array(z.string().min(2).max(60)).min(1).max(5),
  sendTrigger: z.string().max(300).nullish(),
  titleStrategy: z.string().max(300).nullish(),
  audienceRead: z.string().max(400).nullish(),
});

export function validatePublishKit(raw: unknown): PublishKitResult {
  const parsed = publishKitSchema.safeParse(raw);
  if (!parsed.success) {
    throw new InvalidModelOutput(
      "O kit de publicação não seguiu o contrato de saída",
      parsed.error.issues.map((i: any) => `${i.path.join(".") || "raiz"}: ${i.message}`),
    );
  }
  const d = parsed.data;

  if (ISCA_DE_ENGAJAMENTO.test(d.description)) {
    throw new InvalidModelOutput(
      "A legenda pede engajamento de forma explícita, o que faz o Reels deixar de ser recomendado",
      [d.description.slice(0, 200)],
    );
  }

  // Hashtag de volume nao traz alcance e mistura o video com qualquer assunto.
  const hashtags = d.hashtags
    .map((h: any) => (h.startsWith("#") ? h : `#${h}`))
    .map((h: any) => h.replace(/\s+/g, ""))
    .filter((h: any) => !HASHTAG_GENERICA.test(h))
    .slice(0, 5);

  if (hashtags.length === 0) {
    throw new InvalidModelOutput("Todas as hashtags eram genéricas de volume", d.hashtags);
  }

  return {
    description: d.description.trim(),
    hashtags,
    sendTrigger: d.sendTrigger ?? null,
    titleStrategy: d.titleStrategy ?? null,
    audienceRead: d.audienceRead ?? null,
  };
}


// ----------------------- Optimized Comment CTA Result -----------------------

export interface OptimizedCommentCtaResult {
  suggestions: Array<{
    text: string;
    style: string;
    signal: string;
    technique: string;
  }>;
  recommendedIndex: number;
  strategyExplained: string;
}

const optimizedCommentCtaSchema = z.object({
  suggestions: z
    .array(
      z.object({
        text: z.string().min(3).max(MAX_CHARS),
        style: z.string(),
        signal: z.string(),
        technique: z.string(),
      }),
    )
    .min(1)
    .max(10),
  recommendedIndex: z.number().int().min(0),
  strategyExplained: z.string().min(10).max(500),
});

export function validateOptimizedCommentCtaResult(
  raw: unknown,
): OptimizedCommentCtaResult {
  const parsed = optimizedCommentCtaSchema.safeParse(raw);
  if (!parsed.success) {
    throw new InvalidModelOutput(
      "CTA otimizado não seguiu o contrato de saída",
      parsed.error.issues.map((i: any) => `${i.path.join(".") || "raiz"}: ${i.message}`),
    );
  }
  const result = parsed.data;
  if (result.recommendedIndex >= result.suggestions.length) {
    throw new InvalidModelOutput("recommendedIndex fora do intervalo", [
      "recommendedIndex deve ser um índice válido na lista de sugestões",
    ]);
  }
  return result;
}
