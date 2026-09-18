import { fail, handleError, json, readJson, requireAuth } from "@/lib/api";
import { clearApiKey, credentialStatus, saveApiKey } from "@/lib/settings";

/** Guarda a chave criptografada. A resposta devolve apenas o valor mascarado. */
export async function POST(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  try {
    const { apiKey } = await readJson<{ apiKey?: string }>(request);
    if (!apiKey?.trim()) return fail("Informe a chave.");
    return json({ credential: saveApiKey(apiKey) });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE() {
  const denied = await requireAuth();
  if (denied) return denied;
  clearApiKey();
  return json({ credential: credentialStatus() });
}
