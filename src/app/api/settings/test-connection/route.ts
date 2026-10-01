import { fail, handleError, json, requireAuth } from "@/lib/api";
import { activeProvider, AI_PROVIDER_LABEL, parseProvider } from "@/lib/settings";
import { testProviderConnection } from "@/lib/providers/ai";

/**
 * Teste feito pelo backend com o modelo de análise configurado. Devolve status,
 * modelo e mensagem segura — jamais a chave. Com `{ "provider": "gemini" }` no
 * corpo testa esse provedor mesmo que ele ainda não seja o ativo.
 */
export async function POST(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  try {
    const body = (await request.json().catch(() => ({}))) as { provider?: unknown };
    const provider = parseProvider(body.provider) ?? activeProvider();
    const result = await testProviderConnection(provider);
    if (!result) {
      return fail(`Nenhuma chave do ${AI_PROVIDER_LABEL[provider]} configurada.`, 409, { code: "not_configured" });
    }
    return json(result, result.ok ? 200 : 502);
  } catch (err) {
    return handleError(err);
  }
}
