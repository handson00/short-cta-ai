import { fail, json, readJson, requireAuth } from "@/lib/api";
import * as repo from "@/lib/repo";
import type { Confidence } from "@/lib/types";

interface Body {
  title?: string | null;
  year?: number | null;
  mediaType?: "movie" | "series" | null;
  confidence?: Confidence;
}

/** Correcao manual da obra identificada. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!repo.getVideo(id)) return fail("Vídeo não encontrado.", 404);

  const body = await readJson<Body>(request);
  const title = body.title?.trim() || null;

  repo.saveWork(
    id,
    {
      title,
      originalTitle: null,
      year: body.year ?? null,
      mediaType: body.mediaType ?? null,
      confidence: title ? (body.confidence ?? "high") : "low",
      evidence: title ? ["Informado manualmente pelo usuário."] : [],
      sources: [],
      status: title ? "identified" : "not_identified_safely",
    },
    true,
  );

  return json({ work: repo.getWork(id) });
}
