import { json, requireAuth } from "@/lib/api";
import * as repo from "@/lib/repo";

export const dynamic = "force-dynamic";

/** Comentários já capturados para este vídeo. Leitura, exige sessão. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await params;
  return json({
    comments: repo.getComments(id),
    capturedAt: repo.getCommentsCapturedAt(id),
    hashtags: repo.getVideoHashtags(id),
  });
}
