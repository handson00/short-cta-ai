import { fail, handleError, json, readJson, requireAuth } from "@/lib/api";
import { activeProvider, clearApiKey, parseProvider, saveApiKey } from "@/lib/settings";

/**
 * Guarda a chave criptografada. A resposta devolve apenas o valor mascarado.
 * `provider` diz de qual provedor é a chave; ausente, vale o ativo.
 */
export async function POST(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  try {
    const { apiKey, provider } = await readJson<{ apiKey?: string; provider?: unknown }>(request);
    if (!apiKey?.trim()) return fail("Informe a chave.");
    if (provider !== undefined && !parseProvider(provider)) return fail("Provedor desconhecido.", 422);
    return json({ credential: saveApiKey(apiKey, parseProvider(provider) ?? activeProvider()) });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  const raw = new URL(request.url).searchParams.get("provider");
  if (raw !== null && !parseProvider(raw)) return fail("Provedor desconhecido.", 422);
  return json({ credential: clearApiKey(parseProvider(raw) ?? activeProvider()) });
}
