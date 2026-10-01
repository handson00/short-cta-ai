import { env } from "../../env";

/**
 * Modelos do Gemini para a tela de Configurações.
 *
 * A tela oferece só três (`GEMINI_MAIN_MODELS`): básico, médio e avançado. A
 * conta é consultada (API nativa `models.list`) apenas para dizer se cada um
 * está disponível para a chave — o Google aposenta modelos, e um modelo que
 * sumiu precisa aparecer como indisponível, não como erro no meio de um lote.
 *
 * O que a API NÃO informa é quais têm plano gratuito. Isso vem da página de
 * preços, copiado abaixo com a data da conferência. É um rótulo de ajuda, não
 * uma garantia: se o Google mudar, a cota esgotada aparece como erro explícito
 * (`quota_exhausted`), nunca como ausência de resultado.
 */

/** https://ai.google.dev/gemini-api/docs/pricing — conferido em 2026-09-30 (página de 2026-09-24). */
export const GEMINI_FREE_TIER_CHECKED_AT = "2026-09-30";
export const GEMINI_FREE_TIER_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
] as const;

const FREE = new Set<string>(GEMINI_FREE_TIER_MODELS);

/**
 * Os três modelos oferecidos na tela (pedido do usuário, 2026-09-30: "só os
 * principais — básico, médio e avançado"). Todos com plano gratuito na página
 * de preços. O avançado é o 2.5 Pro porque o único Pro mais novo
 * (gemini-3.1-pro-preview) não tem plano gratuito.
 */
export type ModelTask = "analysis" | "generation";

/**
 * `recommendedFor`: a etapa em que o modelo é o sugerido — o que faz o
 * trabalho gastando menos da cota gratuita (pedido do usuário, 2026-09-30).
 *
 * O Básico é o recomendado nas duas, pelo que foi MEDIDO na conta dele nesse
 * dia: análise em 3–4 s com o flash-lite, enquanto o 3.8-flash devolvia 503
 * "high demand" na geração (HISTORICO §32). Modelo mais leve também é o de
 * maior cota no plano gratuito. Ganchos curtos não precisam do mais pesado.
 */
export const GEMINI_MAIN_MODELS = [
  {
    id: "gemini-3.5-flash-lite",
    tier: "Básico",
    displayName: "Gemini 3.5 Flash-Lite",
    hint: "mais rápido, maior cota",
    recommendedFor: ["analysis", "generation"] as ModelTask[],
  },
  {
    id: "gemini-3.8-flash",
    tier: "Médio",
    displayName: "Gemini 3.8 Flash",
    hint: "mais elaborado, sobrecarrega em horário de pico",
    recommendedFor: [] as ModelTask[],
  },
  {
    id: "gemini-2.5-pro",
    tier: "Avançado",
    displayName: "Gemini 2.5 Pro",
    hint: "raciocina mais, cota menor",
    recommendedFor: [] as ModelTask[],
  },
];

/** O modelo recomendado para a etapa. */
export function recommendedModel(task: ModelTask): string {
  return GEMINI_MAIN_MODELS.find((m) => m.recommendedFor.includes(task))?.id ?? GEMINI_MAIN_MODELS[0].id;
}

export interface MainModelOption {
  id: string;
  tier: string;
  displayName: string;
  hint: string;
  /** Etapas em que este é o modelo sugerido. */
  recommendedFor: ModelTask[];
  freeTier: boolean;
  /**
   * Se a conta oferece o modelo: true/false conferido na lista da conta; null
   * quando não deu para conferir (sem chave ou consulta falhou — o motivo vai
   * à parte).
   */
  available: boolean | null;
}

/** Os três principais, marcados com o que a conta de fato oferece. */
export function mainModelOptions(account: GeminiModelOption[] | null): MainModelOption[] {
  const ids = account ? new Set(account.map((m) => m.id)) : null;
  return GEMINI_MAIN_MODELS.map((m) => ({
    ...m,
    freeTier: FREE.has(m.id),
    available: ids ? ids.has(m.id) : null,
  }));
}

/**
 * Modelos que respondem `generateContent` mas não servem para escrever texto a
 * partir de texto: gerar imagem, voz, conversa ao vivo, embeddings, uso de
 * computador. Oferecê-los na lista só faria o job falhar depois.
 */
const NOT_FOR_TEXT = /(image|imagen|tts|audio|live|embedding|computer-use|robotics|veo|aqa|native-audio)/i;

export interface GeminiModelOption {
  /** ID como o endpoint compatível espera: "gemini-3.8-flash". */
  id: string;
  displayName: string;
  freeTier: boolean;
  inputTokenLimit: number | null;
}

interface RawModel {
  name?: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
  inputTokenLimit?: number;
}

/** Filtra e ordena a resposta da API: gratuitos primeiro, depois por nome (mais novo antes). */
export function toModelOptions(raw: RawModel[]): GeminiModelOption[] {
  const seen = new Set<string>();
  const out: GeminiModelOption[] = [];
  for (const m of raw) {
    const id = (m.name ?? "").replace(/^models\//, "").trim();
    if (!id || seen.has(id)) continue;
    if (!id.startsWith("gemini")) continue;
    if (!(m.supportedGenerationMethods ?? []).includes("generateContent")) continue;
    if (NOT_FOR_TEXT.test(id)) continue;
    seen.add(id);
    out.push({
      id,
      displayName: m.displayName?.trim() || id,
      freeTier: FREE.has(id),
      inputTokenLimit: typeof m.inputTokenLimit === "number" ? m.inputTokenLimit : null,
    });
  }
  return out.sort((a, b) => Number(b.freeTier) - Number(a.freeTier) || b.id.localeCompare(a.id, "en", { numeric: true }));
}

export class GeminiListError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number | null,
  ) {
    super(message);
  }
}

/**
 * Consulta a conta. A chave vai no cabeçalho `x-goog-api-key`, não na URL:
 * URL costuma parar em log.
 */
export async function listGeminiModels(apiKey: string, timeoutMs = 15_000): Promise<GeminiModelOption[]> {
  const raw: RawModel[] = [];
  let pageToken: string | undefined;
  // Poucas páginas bastam; o teto impede laço se a API repetir o token.
  for (let page = 0; page < 5; page += 1) {
    const url = new URL(`${env.geminiNativeUrl.replace(/\/+$/, "")}/models`);
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "x-goog-api-key": apiKey, accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new GeminiListError(`Não foi possível alcançar o Google: ${(err as Error).message}`, null);
    }
    const text = await res.text();
    if (!res.ok) {
      const invalidKey = /API[ _]?key not valid|API_KEY_INVALID/i.test(text);
      throw new GeminiListError(
        invalidKey
          ? "O Google recusou a chave (API key not valid). Confira se copiou a chave inteira do AI Studio."
          : res.status === 403
            ? "O Google negou acesso (403). Chave do tipo padrão sem restrição é recusada pela API do Gemini: crie uma chave nova no AI Studio (já sai do tipo auth) ou restrinja a atual a 'Gemini API only'."
            : `O Google respondeu ${res.status} ao listar os modelos.`,
        res.status,
      );
    }
    const data = JSON.parse(text) as { models?: RawModel[]; nextPageToken?: string };
    raw.push(...(data.models ?? []));
    if (!data.nextPageToken || data.nextPageToken === pageToken) break;
    pageToken = data.nextPageToken;
  }
  return toModelOptions(raw);
}
