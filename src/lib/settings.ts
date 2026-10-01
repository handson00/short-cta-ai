import { db, nowIso, parseJson } from "./db";
import { canEncrypt, decryptSecret, encryptSecret, maskSecret } from "./crypto";
import { env } from "./env";

/** Provedores de IA. Os dois falam Chat Completions: muda endereço, chave e modelo. */
export const AI_PROVIDERS = ["ghostcli", "gemini"] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];

export const AI_PROVIDER_LABEL: Record<AiProviderId, string> = {
  ghostcli: "GhostCLI",
  gemini: "Google Gemini",
};

export interface AppSettings {
  /**
   * Qual provedor atende a análise e a geração. A troca é sempre explícita:
   * o sistema nunca passa para outro provedor sozinho quando um falha — isso
   * gastaria chamada paga sem o usuário pedir.
   */
  ai: { provider: AiProviderId };
  gemini: {
    analysisModel: string;
    generationModel: string;
    timeoutMs: number;
    maxRetries: number;
  };
  ghostcli: {
    baseUrl: string;
    analysisModel: string;
    generationModel: string;
    timeoutMs: number;
    maxRetries: number;
    authHeader: "authorization" | "x-api-key";
  };
  generation: {
    ctaCount: number;
    language: string;
    creativity: number; // 0..1, traduzido para temperature quando o modelo aceitar
  };
  toggles: {
    externalSearch: boolean;
    analyzeExistingCta: boolean;
    useExistingCtaAsReference: boolean;
    spoilerPrevention: boolean;
    identifyWork: boolean;
    /**
     * Gerar CTAs sozinho logo após importar. Desligado = a importação faz só a
     * parte local (transcrição, OCR) e as chamadas pagas esperam o usuário
     * selecionar os vídeos que vai usar.
     */
    aiOnImport: boolean;
  };
  queue: {
    /** Vídeos transcrevendo ao mesmo tempo (CPU). */
    concurrency: number;
    /** Vídeos em "Gerar CTAs" ao mesmo tempo (só rede; não disputa a CPU). */
    aiConcurrency: number;
  };
  limits: {
    maxFileSizeMb: number;
    maxDurationSeconds: number;
    maxFramesPerVideo: number;
  };
  retention: {
    videoDays: number;
    transcriptDays: number;
    resultDays: number;
  };
  paths: {
    /** Pasta dos MP4 exportados. Vazio = a padrão (`EDITOR_OUTPUT_DIR`/`data/output`). */
    outputDir: string;
  };
  publish: {
    /**
     * Gerar também uma legenda em japonês na página de Exportações, aberta pela
     * hashtag fixa. É uma tática de alcance escolhida pelo usuário (2026-09-30).
     */
    japaneseCaption: boolean;
    /** A hashtag que abre a legenda japonesa e nunca pode faltar. */
    japaneseHashtag: string;
  };
}

/**
 * Valores iniciais conservadores: refletem o que uma maquina local costuma
 * aguentar. Ajuste em Configuracoes depois de medir na sua maquina.
 */
export const DEFAULT_SETTINGS: AppSettings = {
  ai: { provider: "ghostcli" },
  gemini: {
    // O recomendado para as duas etapas (`recommendedFor` em geminiModels.ts):
    // o mais leve, mais rápido e de maior cota gratuita — medido em 2026-09-30.
    analysisModel: "gemini-3.5-flash-lite",
    generationModel: "gemini-3.5-flash-lite",
    timeoutMs: 90_000,
    maxRetries: 2,
  },
  ghostcli: {
    baseUrl: env.ghostcliBaseUrl || "https://ghostcli.dev/v1",
    analysisModel: "claude-sonnet-5",
    generationModel: "claude-sonnet-5",
    timeoutMs: 60_000,
    maxRetries: 2,
    authHeader: env.ghostcliAuthHeader === "x-api-key" ? "x-api-key" : "authorization",
  },
  generation: { ctaCount: 10, language: "pt-BR", creativity: 0.7 },
  toggles: {
    externalSearch: false,
    analyzeExistingCta: true,
    useExistingCtaAsReference: true,
    spoilerPrevention: true,
    identifyWork: true,
    // Pedido do usuário (2026-09-29): pagar só pelos vídeos que ele vai usar.
    aiOnImport: false,
  },
  queue: { concurrency: 2, aiConcurrency: 3 },
  limits: { maxFileSizeMb: 300, maxDurationSeconds: 300, maxFramesPerVideo: 12 },
  retention: { videoDays: 30, transcriptDays: 30, resultDays: 180 },
  paths: { outputDir: "" },
  publish: { japaneseCaption: true, japaneseHashtag: "#tvアニメ" },
};

const SETTINGS_KEY = "app_settings";
const CREDENTIAL_KEY = "ghostcli_credential";

interface StoredCredential {
  encrypted: string;
  mask: string;
  updatedAt: string;
}

function readRaw<T>(key: string): T | null {
  const row = db().prepare("SELECT value_json FROM app_settings WHERE key = ?").get(key) as
    | { value_json: string }
    | undefined;
  if (!row) return null;
  return parseJson<T | null>(row.value_json, null);
}

function writeRaw(key: string, value: unknown): void {
  db()
    .prepare(
      `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    )
    .run(key, JSON.stringify(value), nowIso());
}

function mergeDeep<T>(base: T, patch: unknown): T {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (!(k in out)) continue;
    const current = out[k];
    if (current !== null && typeof current === "object" && !Array.isArray(current)) {
      out[k] = mergeDeep(current, v);
    } else if (v !== undefined && v !== null) {
      out[k] = v;
    }
  }
  return out as T;
}

export function getSettings(): AppSettings {
  return mergeDeep(DEFAULT_SETTINGS, readRaw<Partial<AppSettings>>(SETTINGS_KEY));
}

export function saveSettings(patch: unknown): AppSettings {
  const next = clampSettings(mergeDeep(getSettings(), patch));
  writeRaw(SETTINGS_KEY, next);
  return next;
}

function clampSettings(s: AppSettings): AppSettings {
  const clamp = (v: number, lo: number, hi: number, fallback: number) =>
    Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  return {
    ...s,
    ai: { provider: AI_PROVIDERS.includes(s.ai.provider) ? s.ai.provider : "ghostcli" },
    gemini: {
      analysisModel: cleanModel(s.gemini.analysisModel, DEFAULT_SETTINGS.gemini.analysisModel),
      generationModel: cleanModel(s.gemini.generationModel, DEFAULT_SETTINGS.gemini.generationModel),
      timeoutMs: clamp(s.gemini.timeoutMs, 5_000, 300_000, 90_000),
      maxRetries: clamp(s.gemini.maxRetries, 0, 5, 2),
    },
    ghostcli: {
      ...s.ghostcli,
      timeoutMs: clamp(s.ghostcli.timeoutMs, 5_000, 300_000, 60_000),
      maxRetries: clamp(s.ghostcli.maxRetries, 0, 5, 2),
      authHeader: s.ghostcli.authHeader === "x-api-key" ? "x-api-key" : "authorization",
    },
    generation: {
      ...s.generation,
      ctaCount: Math.round(clamp(s.generation.ctaCount, 3, 24, 10)),
      creativity: clamp(s.generation.creativity, 0, 1, 0.7),
    },
    queue: {
      concurrency: Math.round(clamp(s.queue.concurrency, 1, 8, 2)),
      aiConcurrency: Math.round(clamp(s.queue.aiConcurrency, 1, 8, 3)),
    },
    limits: {
      maxFileSizeMb: Math.round(clamp(s.limits.maxFileSizeMb, 1, 4096, 300)),
      maxDurationSeconds: Math.round(clamp(s.limits.maxDurationSeconds, 1, 7200, 300)),
      maxFramesPerVideo: Math.round(clamp(s.limits.maxFramesPerVideo, 2, 40, 12)),
    },
    retention: {
      videoDays: Math.round(clamp(s.retention.videoDays, 0, 3650, 30)),
      transcriptDays: Math.round(clamp(s.retention.transcriptDays, 0, 3650, 30)),
      resultDays: Math.round(clamp(s.retention.resultDays, 0, 3650, 180)),
    },
    paths: { outputDir: typeof s.paths.outputDir === "string" ? s.paths.outputDir.trim() : "" },
    publish: {
      japaneseCaption: s.publish.japaneseCaption !== false,
      // Sem hashtag não há a tática: campo vazio volta para a padrão.
      japaneseHashtag:
        (typeof s.publish.japaneseHashtag === "string" ? s.publish.japaneseHashtag.trim() : "") ||
        DEFAULT_SETTINGS.publish.japaneseHashtag,
    },
  };
}

// ------------------------------- Credencial ---------------------------------

export type CredentialSource = "env" | "database" | "none";

export interface CredentialStatus {
  source: CredentialSource;
  mask: string | null;
  updatedAt: string | null;
  canStoreInDatabase: boolean;
}

/** Cada provedor guarda a sua chave: trocar de provedor não apaga a do outro. */
const CREDENTIAL_KEYS: Record<AiProviderId, string> = {
  ghostcli: CREDENTIAL_KEY,
  gemini: "gemini_credential",
};

const ENV_KEY: Record<AiProviderId, { name: string; value: () => string }> = {
  ghostcli: { name: "GHOSTCLI_API_KEY", value: () => env.ghostcliApiKey },
  gemini: { name: "GEMINI_API_KEY", value: () => env.geminiApiKey },
};

export function activeProvider(): AiProviderId {
  return getSettings().ai.provider;
}

/** Aceita só um provedor conhecido; qualquer outra coisa vira nulo. */
export function parseProvider(raw: unknown): AiProviderId | null {
  return AI_PROVIDERS.includes(raw as AiProviderId) ? (raw as AiProviderId) : null;
}

/**
 * A variavel de ambiente tem precedencia e nunca e gravada no banco.
 * A chave so sai daqui para o cliente HTTP do servidor — nunca para respostas.
 */
export function getApiKey(provider: AiProviderId = activeProvider()): string | null {
  const fromEnv = ENV_KEY[provider].value();
  if (fromEnv) return fromEnv;
  const stored = readRaw<StoredCredential>(CREDENTIAL_KEYS[provider]);
  if (!stored?.encrypted) return null;
  try {
    return decryptSecret(stored.encrypted);
  } catch {
    return null;
  }
}

export function credentialStatus(provider: AiProviderId = activeProvider()): CredentialStatus {
  const fromEnv = ENV_KEY[provider].value();
  if (fromEnv) {
    return {
      source: "env",
      mask: maskSecret(fromEnv),
      updatedAt: null,
      canStoreInDatabase: canEncrypt(),
    };
  }
  const stored = readRaw<StoredCredential>(CREDENTIAL_KEYS[provider]);
  if (stored?.encrypted) {
    return { source: "database", mask: stored.mask, updatedAt: stored.updatedAt, canStoreInDatabase: canEncrypt() };
  }
  return { source: "none", mask: null, updatedAt: null, canStoreInDatabase: canEncrypt() };
}

export function saveApiKey(plain: string, provider: AiProviderId = activeProvider()): CredentialStatus {
  const trimmed = plain.trim();
  if (!trimmed) throw new Error("Chave vazia");
  if (!canEncrypt()) {
    throw new Error(`SECRETS_MASTER_KEY nao configurada: defina ${ENV_KEY[provider].name} por variavel de ambiente.`);
  }
  const payload: StoredCredential = {
    encrypted: encryptSecret(trimmed),
    mask: maskSecret(trimmed),
    updatedAt: nowIso(),
  };
  writeRaw(CREDENTIAL_KEYS[provider], payload);
  return credentialStatus(provider);
}

export function clearApiKey(provider: AiProviderId = activeProvider()): CredentialStatus {
  db().prepare("DELETE FROM app_settings WHERE key = ?").run(CREDENTIAL_KEYS[provider]);
  return credentialStatus(provider);
}

// ------------------------------ Perfil de IA --------------------------------

/** Tudo o que o cliente HTTP e o pipeline precisam saber do provedor em uso. */
export interface AiProfile {
  provider: AiProviderId;
  label: string;
  baseUrl: string;
  authHeader: "authorization" | "x-api-key";
  analysisModel: string;
  generationModel: string;
  timeoutMs: number;
  maxRetries: number;
  /**
   * Reservas, em ordem, para quando o escolhido está sobrecarregado, lento ou
   * sem cota; vale o primeiro diferente do escolhido. Só no Gemini: mesmo
   * provedor, gratuito. Vazio = sem reserva.
   */
  fallbackModels: string[];
  /** Nível de "raciocínio" pedido ao modelo; ausente = o padrão dele. */
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
}

/**
 * Reservas do Gemini: o Básico e, se o escolhido já é o Básico, o Médio. Cada
 * modelo tem cota e fila próprias no Google, então um cobre o outro. Medido em
 * 2026-09-30: flash-lite em 3–4 s enquanto o 3.8-flash devolvia 503.
 */
export const GEMINI_FALLBACK_MODELS = ["gemini-3.5-flash-lite", "gemini-3.8-flash"];

export function resolveAiProfile(settings: AppSettings, provider: AiProviderId = settings.ai.provider): AiProfile {
  if (provider === "gemini") {
    return {
      provider,
      label: AI_PROVIDER_LABEL.gemini,
      baseUrl: env.geminiBaseUrl,
      // O endpoint compatível do Google recebe a chave como Bearer.
      authHeader: "authorization",
      analysisModel: settings.gemini.analysisModel,
      generationModel: settings.gemini.generationModel,
      timeoutMs: settings.gemini.timeoutMs,
      maxRetries: settings.gemini.maxRetries,
      fallbackModels: GEMINI_FALLBACK_MODELS,
      // Ganchos curtos não precisam de raciocínio longo, e ele é a maior parte
      // do tempo de resposta desses modelos. "low" existe em todos os Gemini
      // 2.5 e 3.x (documentação de compatibilidade OpenAI do Google).
      reasoningEffort: "low",
    };
  }
  return {
    provider: "ghostcli",
    label: AI_PROVIDER_LABEL.ghostcli,
    baseUrl: settings.ghostcli.baseUrl,
    authHeader: settings.ghostcli.authHeader,
    analysisModel: settings.ghostcli.analysisModel,
    generationModel: settings.ghostcli.generationModel,
    timeoutMs: settings.ghostcli.timeoutMs,
    maxRetries: settings.ghostcli.maxRetries,
    // GhostCLI é pago: trocar de modelo sozinho mudaria o custo sem pedido.
    fallbackModels: [],
  };
}

/**
 * ID de modelo como a API espera. A lista do Google devolve "models/gemini-…";
 * o endpoint compatível quer só "gemini-…".
 */
function cleanModel(raw: unknown, fallback: string): string {
  const value = typeof raw === "string" ? raw.trim().replace(/^models\//, "") : "";
  return value || fallback;
}
