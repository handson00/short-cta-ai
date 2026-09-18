import { fail, json, readJson, requireAuth } from "@/lib/api";
import * as repo from "@/lib/repo";

/** Correcao manual da leitura do OCR. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!repo.getVisualAnalysis(id)) return fail("Este vídeo ainda não passou pela leitura de texto.", 409);

  const body = await readJson<{ text?: string | null }>(request);
  repo.setManualCta(id, body.text ?? null);
  const visual = repo.getVisualAnalysis(id);
  return json({ existingCta: repo.effectiveExistingCta(visual) });
}
