import { fail, json, requireAuth } from "@/lib/api";
import * as repo from "@/lib/repo";

/**
 * Nova tentativa de um item com erro ou cancelado.
 *
 * Repete o MESMO modo do job que falhou: um vídeo importado (só parte local)
 * que falhou não pode, ao tentar de novo, gastar chamadas pagas sem o usuário
 * ter pedido.
 */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await ctx.params;
  const video = repo.getVideo(id);
  if (!video) return fail("Vídeo não encontrado.", 404);
  const { queued, skipped } = repo.requestReanalysis([id], repo.latestJob(id)?.mode ?? "full");
  if (queued.length === 0) return fail(skipped[0]?.reason ?? "Não foi possível enfileirar.", 409);
  return json({ ok: true });
}
