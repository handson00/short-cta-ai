import { fail, handleError, json, requireAuth } from "@/lib/api";
import * as repo from "@/lib/repo";

export const dynamic = "force-dynamic";

/**
 * Retoma os vídeos cujo ÚLTIMO job terminou com erro.
 *
 * Existe por causa da cota do plano gratuito: num lote de 98, os últimos
 * param com `quota_exhausted` e o usuário só precisa esperar a cota renovar
 * para terminar. Sem isto, seria achar os 11 na lista e selecionar um a um.
 *
 * Quem decide a lista é o SERVIDOR, não o navegador: a tela pode estar
 * filtrada ou desatualizada, e "os que falharam" tem que ser os que falharam.
 *
 * Cada vídeo volta no MODO do job que falhou (`local`, `ai` ou `full`): um
 * vídeo que falhou na parte local não pode, ao ser retomado, passar a gastar
 * chamadas de IA que ninguém pediu.
 */
export async function POST() {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const falhados = repo.listFailedVideos();
    if (falhados.length === 0) return fail("Nenhum vídeo com erro para retomar.", 400);

    const queued: string[] = [];
    const skipped: { id: string; reason: string }[] = [];

    // Um pedido por modo: `requestReanalysis` grava o modo em todos do lote.
    for (const mode of ["ai", "local", "full"] as const) {
      const ids = falhados.filter((v) => v.mode === mode).map((v) => v.id);
      if (ids.length === 0) continue;
      const r = repo.requestReanalysis(ids, mode);
      queued.push(...r.queued);
      skipped.push(...r.skipped);
    }

    return json({ ok: true, queued, queuedCount: queued.length, skipped });
  } catch (err) {
    return handleError(err);
  }
}
