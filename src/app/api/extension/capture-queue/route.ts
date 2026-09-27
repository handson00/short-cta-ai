import { fail, json, requireAuth } from "@/lib/api";
import * as repo from "@/lib/repo";

export const dynamic = "force-dynamic";

/**
 * Adiciona vídeos à fila de captura automática de comentários.
 * Body: { videos: Array<{ videoId: string; url: string }> }
 */
export async function POST(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const body = (await request.json()) as {
      videos?: Array<{ videoId: string; url: string }>;
    };

    if (!Array.isArray(body.videos) || body.videos.length === 0) {
      return fail("Lista de vídeos vazia ou inválida.", 400);
    }

    // Filtra apenas itens com URL válida
    const validItems = body.videos.filter(
      (v): v is { videoId: string; url: string } =>
        typeof v.videoId === "string" &&
        typeof v.url === "string" &&
        v.url.length > 0,
    );

    if (validItems.length === 0) {
      return fail("Nenhum vídeo com URL válida fornecido.", 400);
    }

    const added = repo.addToCaptureQueue(validItems);
    const summary = repo.captureQueueSummary();

    return json({
      ok: true,
      added,
      total: validItems.length,
      queue: summary,
    });
  } catch (err) {
    return fail(
      err instanceof Error ? err.message : "Erro ao adicionar à fila.",
      500,
    );
  }
}