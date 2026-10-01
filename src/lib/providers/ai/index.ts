import { AI_PROVIDER_LABEL, getApiKey, getSettings, resolveAiProfile, type AiProviderId } from "../../settings";
import { AiError } from "./errors";
import { ChatCompletionsProvider, testConnection as testWith, type ConnectionTestResult } from "./ghostcli";
import type { AIProvider } from "../../types";

/**
 * O provedor escolhido em Configurações. Sem chave para ele, erro explícito —
 * nunca troca para o outro provedor por conta própria: isso gastaria chamada
 * paga (GhostCLI) ou cota (Gemini) sem o usuário ter pedido.
 */
export function aiProvider(scope: { videoId?: string | null; jobId?: string | null } = {}): AIProvider {
  const settings = getSettings();
  const profile = resolveAiProfile(settings);
  const apiKey = getApiKey(profile.provider);
  if (!apiKey) {
    throw new AiError(
      "not_configured",
      `Nenhuma chave do ${profile.label} está configurada. Salve a chave em Configurações ou troque o provedor de IA.`,
    );
  }
  return new ChatCompletionsProvider({ settings, profile, apiKey, ...scope });
}

export function aiConfigured(): boolean {
  return Boolean(getApiKey());
}

/** Testa um provedor — não necessariamente o ativo: dá para testar o Gemini antes de trocar. */
export async function testProviderConnection(provider: AiProviderId): Promise<ConnectionTestResult | null> {
  const apiKey = getApiKey(provider);
  if (!apiKey) return null;
  const settings = getSettings();
  return testWith({ settings, profile: resolveAiProfile(settings, provider), apiKey });
}

export { AiError } from "./errors";
export { AI_PROVIDER_LABEL };
