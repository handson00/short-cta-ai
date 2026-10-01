import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, json, fail, handleError } from "@/lib/api";
import { applySourceProfile } from "@/lib/editor/profileApply";

export const dynamic = "force-dynamic";

const schema = z.object({
  profileId: z.string().min(1),
  videoIds: z.array(z.string().min(1)).min(1).max(500),
  /** Em lote fica falso: recorte manual é trabalho do usuário e não some por baixo. */
  replaceManual: z.boolean().default(false),
});

/** Aplica o recorte de um perfil aos vídeos; o relatório diz quem ficou de fora e por quê. */
export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Dados inválidos.", 422);

    const { profileId, videoIds, replaceManual } = parsed.data;
    const result = applySourceProfile(profileId, videoIds, { replaceManual });
    if (!result) return fail("Perfil não encontrado.", 404);
    return json({ ok: true, ...result });
  } catch (err) {
    return handleError(err);
  }
}
