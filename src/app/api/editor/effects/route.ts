import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, json, fail, handleError } from "@/lib/api";
import { listEditorVideoIds, listVideoEffects, saveVideoEffects } from "@/lib/editorRepo";
import { MAX_TRIM_SECONDS, normalizeEffects } from "@/lib/editor/effects";

export const dynamic = "force-dynamic";

/**
 * Efeitos por vídeo. Como o recorte, o cliente manda só valores — booleanos e
 * números com limite. O comando do FFmpeg é montado no servidor (§83).
 *
 * `scope: "all"` grava em todos os vídeos da edição, resolvidos AQUI, e não
 * numa lista mandada pelo navegador: a tela pode estar filtrada ou
 * desatualizada, e "todos" precisa ser todos.
 */
const effectsSchema = z.object({
  mirror: z.boolean(),
  trimStart: z.number().min(0).max(MAX_TRIM_SECONDS),
  trimEnd: z.number().min(0).max(MAX_TRIM_SECONDS),
  enhanceColor: z.boolean(),
  speed: z.number().min(1).max(1.25),
  zoom: z.number().min(1).max(1.2),
  enhanceAudio: z.boolean(),
});

const postSchema = z.union([
  z.object({ scope: z.literal("videos"), videoIds: z.array(z.string().min(1)).min(1).max(1000), effects: effectsSchema }),
  z.object({ scope: z.literal("all"), effects: effectsSchema }),
]);

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  return json({ effects: listVideoEffects() });
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const parsed = postSchema.safeParse(await req.json());
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Efeitos inválidos.", 422);

    const body = parsed.data;
    const ids = body.scope === "all" ? listEditorVideoIds() : body.videoIds;
    if (ids.length === 0) return fail("Nenhum vídeo na edição.", 400);
    const effects = normalizeEffects(body.effects);
    const saved = saveVideoEffects(ids, effects);
    return json({ ok: true, saved, videoIds: ids, effects });
  } catch (err) {
    return handleError(err);
  }
}
