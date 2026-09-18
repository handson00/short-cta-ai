import { fail, handleError, json, requireAuth } from "@/lib/api";
import * as repo from "@/lib/repo";
import { videoDetail } from "@/lib/view";

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
    // Pede o cancelamento antes de apagar: se o worker estiver no meio do
    // processamento, ele para em vez de continuar trabalhando em arquivos
    // que não existem mais.
    repo.requestCancel(id);
    repo.deleteVideo(id);
    return json({ deleted: id });
  } catch (err) {
    return handleError(err);
  }
}
