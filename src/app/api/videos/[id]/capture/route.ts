import { fail, handleError, json, requireAuth } from "@/lib/api";
import * as repo from "@/lib/repo";
import { capturePostMetadata } from "@/lib/capture";

/**
 * Busca os dados públicos do post de origem.
 *
 * A leitura acontece no servidor porque o iframe do embed é de outro domínio:
 * o JavaScript da página não consegue ler nada de dentro dele.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const { id } = await params;
    const video = repo.getVideo(id);
    if (!video) return fail("Vídeo não encontrado.", 404);
    if (!video.originalUrl || !video.platform) {
      return fail("Este vídeo não tem origem identificada.", 409);
    }

    const result = await capturePostMetadata(video.platform, video.originalUrl);
    if (!result.ok) return json({ ok: false }, 502);

    repo.saveSourceCapture(id, result.data);
    return json({ ok: true, capture: repo.getSourceCapture(id) });
  } catch (err) {
    return handleError(err);
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await params;
  return json({ capture: repo.getSourceCapture(id) });
}
