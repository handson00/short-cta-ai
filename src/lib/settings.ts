import { db, nowIso, parseJson } from "./db";
import { canEncrypt, decryptSecret, encryptSecret, maskSecret } from "./crypto";
import { env } from "./env";

export interface AppSettings {
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
  };
  queue: {
    concurrency: number;
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
}

/**
 * Valores iniciais conservadores: refletem o que uma maquina local costuma
 * aguentar. Ajuste em Configuracoes depois de medir na sua maquina.
 */
export const DEFAULT_SETTINGS: AppSettings = {
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
  },
  queue: { concurrency: 2 },
  limits: { maxFileSizeMb: 300, maxDurationSeconds: 300, maxFramesPerVideo: 12 },
  retention: { videoDays: 30, transcriptDays: 30, resultDays: 180 },
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
    queue: { concurrency: Math.round(clamp(s.queue.concurrency, 1, 8, 2)) },
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

/**
 * A variavel de ambiente tem precedencia e nunca e gravada no banco.
 * A chave so sai daqui para o cliente HTTP do servidor — nunca para respostas.
 */
export function getApiKey(): string | null {
  if (env.ghostcliApiKey) return env.ghostcliApiKey;
  const stored = readRaw<StoredCredential>(CREDENTIAL_KEY);
  if (!stored?.encrypted) return null;
  try {
    return decryptSecret(stored.encrypted);
  } catch {
    return null;
  }
}

export function credentialStatus(): CredentialStatus {
  if (env.ghostcliApiKey) {
    return {
      source: "env",
      mask: maskSecret(env.ghostcliApiKey),
      updatedAt: null,
      canStoreInDatabase: canEncrypt(),
    };
  }
  const stored = readRaw<StoredCredential>(CREDENTIAL_KEY);
  if (stored?.encrypted) {
    return { source: "database", mask: stored.mask, updatedAt: stored.updatedAt, canStoreInDatabase: canEncrypt() };
  }
  return { source: "none", mask: null, updatedAt: null, canStoreInDatabase: canEncrypt() };
}

export function saveApiKey(plain: string): CredentialStatus {
  const trimmed = plain.trim();
  if (!trimmed) throw new Error("Chave vazia");
  if (!canEncrypt()) {
    throw new Error("SECRETS_MASTER_KEY nao configurada: defina GHOSTCLI_API_KEY por variavel de ambiente.");
  }
  const payload: StoredCredential = {
    encrypted: encryptSecret(trimmed),
    mask: maskSecret(trimmed),
    updatedAt: nowIso(),
  };
  writeRaw(CREDENTIAL_KEY, payload);
  return credentialStatus();
}

export function clearApiKey(): CredentialStatus {
  db().prepare("DELETE FROM app_settings WHERE key = ?").run(CREDENTIAL_KEY);
  return credentialStatus();
}
