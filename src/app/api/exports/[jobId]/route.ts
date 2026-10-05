import { fail, handleError, json, requireAuth } from "@/lib/api";
import { removerDoHistorico } from "@/lib/videoRemoval";

export const dynamic = "force-dynamic";

/**
 * Remove uma exportação do histórico.
 *
 * `?apagarArquivo=1` apaga também o MP4 da pasta de saída; sem isso, o arquivo
 * fica onde está. Se o vídeo já tinha saído da Fila e esta era a última
 * exportação dele, ele sai de vez (HISTORICO §47).
 */
export async function DELETE(request: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const { jobId } = await ctx.params;
    const apagarArquivo = new URL(request.url).searchParams.get("apagarArquivo") === "1";
    const resultado = removerDoHistorico(jobId, { apagarArquivo });
    if (!resultado) return fail("Exportação não encontrada no histórico.", 404);
    return json(resultado);
  } catch (err) {
    return handleError(err);
  }
}
