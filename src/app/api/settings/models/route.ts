import { fail, json, requireAuth } from "@/lib/api";
import { getApiKey, parseProvider } from "@/lib/settings";
import { MODEL_NOTE, MODEL_SUGGESTIONS } from "@/lib/models";
import {
  GEMINI_FREE_TIER_CHECKED_AT,
  GeminiListError,
  listGeminiModels,
  mainModelOptions,
} from "@/lib/providers/ai/geminiModels";

export const dynamic = "force-dynamic";

/**
 * Modelos para escolher em Configurações.
 *
 * Gemini: só os três principais (básico, médio, avançado). A conta é
 * consultada para dizer se cada um está disponível para a chave salva; se a
 * consulta falhar, os três aparecem assim mesmo e o motivo vai em `error` —
 * uma chave errada não pode parecer "modelo indisponível".
 */
export async function GET(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;

  const provider = parseProvider(new URL(request.url).searchParams.get("provider"));
  if (!provider) return fail("Informe provider=ghostcli ou provider=gemini.", 422);

  if (provider === "ghostcli") {
    return json({
      provider,
      models: MODEL_SUGGESTIONS.map((id) => ({ id, tier: "", displayName: id, hint: "", recommendedFor: [], freeTier: false, available: null })),
      note: MODEL_NOTE,
      error: null,
    });
  }

  const note = `"Gratuito" segue a página de preços do Google conferida em ${GEMINI_FREE_TIER_CHECKED_AT}. No plano gratuito o Google pode usar o conteúdo enviado para melhorar os produtos dele, com revisão humana.`;
  const apiKey = getApiKey("gemini");
  if (!apiKey) {
    return json({
      provider,
      models: mainModelOptions(null),
      note,
      error: "Salve a chave do Gemini para conferir quais modelos a sua conta oferece.",
    });
  }

  try {
    return json({ provider, models: mainModelOptions(await listGeminiModels(apiKey)), note, error: null });
  } catch (err) {
    const message = err instanceof GeminiListError ? err.message : (err as Error).message;
    return json({
      provider,
      models: mainModelOptions(null),
      note,
      error: `Não consegui conferir os modelos na sua conta: ${message}`,
    });
  }
}
