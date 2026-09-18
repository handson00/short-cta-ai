import { fail, handleError, json, requireAuth } from "@/lib/api";
import { getApiKey, getSettings } from "@/lib/settings";
import { testConnection } from "@/lib/providers/ai";

/**
 * Teste feito pelo backend com o modelo configurado. Devolve status, modelo e
 * mensagem segura — jamais a chave.
 */
export async function POST() {
  const denied = await requireAuth();
  if (denied) return denied;
  try {
    const apiKey = getApiKey();
    if (!apiKey) return fail("Nenhuma credencial configurada.", 409, { code: "not_configured" });
    const result = await testConnection({ settings: getSettings(), apiKey });
    return json(result, result.ok ? 200 : 502);
  } catch (err) {
    return handleError(err);
  }
}
