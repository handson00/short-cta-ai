import { fail, json, requireAuth } from "@/lib/api";
import * as repo from "@/lib/repo";

/**
 * Analisar novamente refaz extracao e interpretacao do video. Com
 * `{ "mode": "ai" }` no corpo, e "Gerar CTAs": so a IA, sobre a parte local ja
 * feita.
 *
 * Mesma regra do lote: com o video ja em analise, nao cria um segundo job — os
 * dois rodariam juntos sobre os mesmos arquivos.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { mode?: unknown };
  const { queued, skipped } = repo.requestReanalysis([id], body.mode === "ai" ? "ai" : "full");
  if (queued.length === 0) {
    const reason = skipped[0]?.reason ?? "Não foi possível enfileirar.";
    return fail(reason, reason === "Vídeo não encontrado." ? 404 : 409);
  }
  return json({ ok: true });
}
