import type { CtaStyle, CtaSuggestion } from "../types";
import { normalizeText } from "./ctaDetection";

/**
 * Distribuicao de estilos.
 *
 * A quantidade total manda: se o usuario pediu 10 sugestoes, a soma das
 * categorias tem de dar 10. Os pesos abaixo so definem a proporcao.
 */
const WEIGHTS: Record<CtaStyle, number> = {
  curiosidade: 2,
  suspense: 2,
  conflito: 2,
  reviravolta: 2,
  emocional: 1,
  ultracurto: 1,
};

/** Ordem de prioridade quando nao ha espaco para todas as categorias. */
const PRIORITY: CtaStyle[] = ["curiosidade", "suspense", "conflito", "reviravolta", "emocional", "ultracurto"];

export function styleDistribution(count: number): Record<CtaStyle, number> {
  const total = Math.max(1, Math.round(count));
  const out = Object.fromEntries(Object.keys(WEIGHTS).map((s: any) => [s, 0])) as Record<CtaStyle, number>;

  if (total <= PRIORITY.length) {
    for (let i = 0; i < total; i += 1) out[PRIORITY[i]] = 1;
    return out;
  }

  const weightSum = PRIORITY.reduce((a, s) => a + WEIGHTS[s], 0);
  const exact = PRIORITY.map((s) => ({ style: s, value: (total * WEIGHTS[s]) / weightSum }));
  let assigned = 0;
  for (const item of exact) {
    out[item.style] = Math.max(1, Math.floor(item.value));
    assigned += out[item.style];
  }

  // Sobras pelo maior resto; excedente retirado das categorias mais fartas.
  const remainders = exact
    .map((item) => ({ style: item.style, rest: item.value - Math.floor(item.value) }))
    .sort((a, b) => b.rest - a.rest);
  let i = 0;
  while (assigned < total) {
    out[remainders[i % remainders.length].style] += 1;
    assigned += 1;
    i += 1;
  }
  while (assigned > total) {
    const fattest = PRIORITY.slice().sort((a, b) => out[b] - out[a])[0];
    if (out[fattest] <= 1) break;
    out[fattest] -= 1;
    assigned -= 1;
  }
  return out;
}

export function describeDistribution(count: number): string {
  const dist = styleDistribution(count);
  return PRIORITY.filter((s) => dist[s] > 0)
    .map((s) => `${dist[s]} de ${s}`)
    .join(", ");
}

// ----------------------------- Avaliacao editorial --------------------------

/** Formulas que nao dizem nada sobre a cena. */
export const GENERIC_PATTERNS = [
  "voce nao vai acreditar",
  "assista ate o final",
  "veja ate o fim",
  "nao vai acreditar no que",
  "isso vai te chocar",
  "o final e surpreendente",
  "preparese para se surpreender",
  "aperte o play",
  "olha so isso",
  "simplesmente impressionante",
];

export const MAX_CHARS = 80;
export const ULTRASHORT_MAX_CHARS = 45;

export function isGeneric(text: string): boolean {
  const n = normalizeText(text).toLowerCase();
  return GENERIC_PATTERNS.some((p) => n.includes(normalizeText(p).toLowerCase()));
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export interface CtaEvaluation {
  fidelity: number;
  curiosity: number;
  clarity: number;
  size: number;
  spoiler: number;
  variety: number;
  total: number;
  notes: string[];
}

/**
 * Criterios da secao 6.3. Serve para ordenar candidatos e para recusar uma
 * recomendacao invalida do modelo — nao e um numero para mostrar ao usuario
 * como se fosse previsao de desempenho.
 */
export function evaluateCta(
  cta: CtaSuggestion,
  ctx: { others: CtaSuggestion[]; withhold?: string | null; sceneTerms: string[] },
): CtaEvaluation {
  const notes: string[] = [];
  const words = wordCount(cta.text);
  const chars = cta.text.length;
  const normalized = normalizeText(cta.text);

  // Fidelidade: mede ancoragem na cena, nao veracidade — isso o modelo garante
  // ao trabalhar so com as evidencias.
  const terms = ctx.sceneTerms.map((t) => normalizeText(t)).filter((t) => t.length > 3);
  const overlap = terms.filter((t) => normalized.includes(t)).length;
  let fidelity = Math.min(3, overlap);
  if (terms.length > 0 && overlap === 0) {
    fidelity = 0;
    notes.push("Nenhum termo da cena aparece na frase.");
  }

  let curiosity = 0;
  if (/[.…]{1,3}$|\?$/.test(cta.text.trim())) curiosity += 1;
  if (/(ate|quando|mas|porque|so que|depois que)\b/i.test(cta.text)) curiosity += 1;
  if (isGeneric(cta.text)) {
    curiosity -= 3;
    notes.push("Formula generica.");
  }

  const clarity = words <= 14 && !/[;:]{2,}/.test(cta.text) ? 2 : 1;

  const limit = cta.style === "ultracurto" ? ULTRASHORT_MAX_CHARS : MAX_CHARS;
  let size = chars <= limit ? 2 : 0;
  if (cta.style === "ultracurto" && words > 7) {
    size -= 1;
    notes.push("Acima de 7 palavras para um ultracurto.");
  }
  if (chars > limit) notes.push(`Passa de ${limit} caracteres.`);

  // Spoiler: se o texto contem o que deveria ficar guardado, perde pontos.
  let spoiler = 2;
  if (ctx.withhold) {
    const withheldTerms = normalizeText(ctx.withhold)
      .split(" ")
      .filter((t) => t.length > 4);
    const leaked = withheldTerms.filter((t) => normalized.includes(t)).length;
    if (withheldTerms.length > 0 && leaked / withheldTerms.length > 0.5) {
      spoiler = 0;
      notes.push("Parece antecipar a resolucao.");
    }
  }

  const variety = ctx.others.some((o) => o.text !== cta.text && similarity(o.text, cta.text) > 0.7) ? 0 : 1;
  if (variety === 0) notes.push("Muito parecida com outra sugestao.");

  const total = fidelity + curiosity + clarity + size + spoiler + variety;
  return { fidelity, curiosity, clarity, size, spoiler, variety, total, notes };
}

export function similarity(a: string, b: string): number {
  const ta = new Set(normalizeText(a).split(" ").filter(Boolean));
  const tb = new Set(normalizeText(b).split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / Math.max(ta.size, tb.size);
}

/** Remove duplicatas e quase duplicatas preservando a ordem de chegada. */
export function dedupeSuggestions(list: CtaSuggestion[]): CtaSuggestion[] {
  const out: CtaSuggestion[] = [];
  for (const item of list) {
    const text = item.text.trim();
    if (!text) continue;
    if (out.some((o) => similarity(o.text, text) >= 0.85)) continue;
    out.push({ ...item, text });
  }
  return out;
}
