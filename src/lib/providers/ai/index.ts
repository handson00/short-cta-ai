import { getApiKey, getSettings } from "../../settings";
import { AiError } from "./errors";
import { GhostCliProvider, type ProviderContext } from "./ghostcli";
import type { AIProvider } from "../../types";

export function aiProvider(scope: { videoId?: string | null; jobId?: string | null } = {}): AIProvider {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new AiError("not_configured", "Nenhuma credencial do GhostCLI está configurada.");
  }
  const ctx: ProviderContext = { settings: getSettings(), apiKey, ...scope };
  return new GhostCliProvider(ctx);
}

export function aiConfigured(): boolean {
  return Boolean(getApiKey());
}

export { AiError } from "./errors";
export { testConnection } from "./ghostcli";
