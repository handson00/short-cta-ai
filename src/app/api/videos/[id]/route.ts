import { fail, handleError, json, requireAuth } from "@/lib/api";
import { videoDetail } from "@/lib/view";
import { tirarDaFila } from "@/lib/videoRemoval";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await params;
  const detail = videoDetail(id);
  if (!detail) return fail("Vídeo não encontrado.", 404);
  return json(detail);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const { id } = await params;
    // Cancela análise e exportação em andamento antes de os arquivos sumirem.
    // Com exportação no histórico, o vídeo é arquivado, não apagado (§47).
    const resultado = tirarDaFila(id);
    if (!resultado) return fail("Vídeo não encontrado.", 404);
    return json({ deleted: id, resultado });
  } catch (err) {
    return handleError(err);
  }
}
