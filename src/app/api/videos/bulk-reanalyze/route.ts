import { fail, handleError, json, readJson, requireAuth } from "@/lib/api";
import * as repo from "@/lib/repo";

/**
 * "Analisar novamente" em lote, a partir da seleção da Fila.
 *
 * Um pedido só, como a exclusão em lote: o servidor percorre a lista e devolve
 * quem entrou na fila e quem ficou de fora, com o motivo. Vídeo que já está em
 * análise é pulado (`requestReanalysis`) — dois jobs do mesmo vídeo rodariam
 * juntos sobre os mesmos arquivos.
 */
export async function POST(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const { ids, mode } = await readJson<{ ids?: unknown; mode?: unknown }>(request);
    if (!Array.isArray(ids) || ids.length === 0) return fail("Nenhum vídeo selecionado.");
    if (ids.length > 500) return fail("Selecione no máximo 500 vídeos por vez.");
    // "ai" = Gerar CTAs sobre a parte local já feita; padrão = analisar tudo de novo.
    if (mode !== undefined && mode !== "full" && mode !== "ai") return fail("Modo inválido.", 422);

    const result = repo.requestReanalysis(ids.map(String), mode === "ai" ? "ai" : "full");
    return json({ ...result, queuedCount: result.queued.length });
  } catch (err) {
    return handleError(err);
  }
}
