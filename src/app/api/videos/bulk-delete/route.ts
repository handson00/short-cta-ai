import { fail, handleError, json, readJson, requireAuth } from "@/lib/api";
import * as repo from "@/lib/repo";
import { tirarDaFila } from "@/lib/videoRemoval";

/**
 * Exclusão em lote.
 *
 * Uma requisição por vídeo faria o navegador abrir dezenas de conexões e
 * deixaria a lista meio apagada se uma delas falhasse. Aqui o servidor
 * percorre a lista e devolve o que apagou e o que não conseguiu.
 *
 * "Apagar" aqui é tirar da Fila: o vídeo que tem exportação vai para o
 * histórico de Exportações (arquivado), não some (HISTORICO §47).
 */
export async function POST(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const { ids } = await readJson<{ ids?: unknown }>(request);
    if (!Array.isArray(ids) || ids.length === 0) return fail("Nenhum vídeo selecionado.");
    if (ids.length > 500) return fail("Selecione no máximo 500 vídeos por vez.");

    const deleted: string[] = [];
    /** Saíram da Fila mas ficaram no histórico de Exportações. */
    const archived: string[] = [];
    const failed: { id: string; reason: string }[] = [];

    for (const raw of ids) {
      const id = String(raw);
      try {
        if (!repo.getVideo(id)) {
          failed.push({ id, reason: "Vídeo não encontrado." });
          continue;
        }
        // Cancela análise e exportação antes de os arquivos sumirem.
        const resultado = tirarDaFila(id);
        deleted.push(id);
        if (resultado === "arquivado") archived.push(id);
      } catch (err) {
        failed.push({ id, reason: (err as Error).message });
      }
    }

    return json({ deleted, archived, failed, deletedCount: deleted.length });
  } catch (err) {
    return handleError(err);
  }
}
