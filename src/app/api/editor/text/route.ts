import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, json, fail, handleError } from "@/lib/api";
import { setVideoTextOverride } from "@/lib/editorRepo";

export const dynamic = "force-dynamic";

const schema = z.object({
  videoId: z.string().regex(/^vid_[a-z0-9]+$/),
  /** Vazio ou nulo volta a usar o CTA da análise. */
  text: z.string().max(500).nullable(),
});

/**
 * Texto próprio do vídeo no editor.
 *
 * Não altera a escolha feita na Fila: é uma camada por cima dela. Apagar o
 * texto próprio devolve o vídeo ao CTA da análise.
 */
export async function PUT(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Dados inválidos.", 422);
    setVideoTextOverride(parsed.data.videoId, parsed.data.text);
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
