import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, json, fail, handleError } from "@/lib/api";
import { getVideo } from "@/lib/repo";
import {
  createSourceProfile,
  deleteSourceProfile,
  listSourceProfiles,
  sourceProfileUsage,
  updateSourceProfile,
} from "@/lib/editorRepo";
import { aspectOf, originKeyOf, originLabel, profileCropError } from "@/lib/editor/profile";
import { profileVideoOf } from "@/lib/editor/profileApply";

export const dynamic = "force-dynamic";

/** Mesmo contrato do recorte (`/api/editor/crop`): só números, nunca filtro. */
const rectSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().gt(0).max(1),
    height: z.number().gt(0).max(1),
  })
  .refine((r) => r.x + r.width <= 1.0001, { message: "O recorte ultrapassa a borda direita do vídeo." })
  .refine((r) => r.y + r.height <= 1.0001, { message: "O recorte ultrapassa a borda inferior do vídeo." });

const createSchema = z.object({
  /** O vídeo em que o recorte foi desenhado: dele saem a página e a proporção. */
  videoId: z.string().min(1),
  crop: rectSchema,
  name: z.string().trim().min(1).max(80).optional(),
});

const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80).optional(),
  /** Trocar o recorte exige o vídeo em que ele foi desenhado (a proporção muda junto). */
  videoId: z.string().min(1).optional(),
  crop: rectSchema.optional(),
});

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  const usage = sourceProfileUsage();
  return json({
    profiles: listSourceProfiles().map((p) => ({
      ...p,
      originLabel: originLabel(p.originKey),
      videoCount: usage[p.id] ?? 0,
    })),
  });
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Dados inválidos.", 422);

    const { videoId, crop, name } = parsed.data;
    const video = getVideo(videoId);
    if (!video) return fail("Vídeo não encontrado.", 404);
    const aspect = aspectOf(video.width, video.height);
    if (aspect === null) return fail("Resolução do vídeo desconhecida; rode a análise antes.", 422);
    const cropError = profileCropError(crop);
    if (cropError) return fail(cropError, 422);

    const originKey = originKeyOf(profileVideoOf(video));
    const profile = createSourceProfile({
      name: name ?? originLabel(originKey) ?? "Perfil sem página",
      crop,
      originKey,
      aspect,
    });
    return json({ ok: true, profile: { ...profile, originLabel: originLabel(originKey), videoCount: 0 } });
  } catch (err) {
    return handleError(err);
  }
}

export async function PUT(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Dados inválidos.", 422);

    const { id, name, videoId, crop } = parsed.data;
    let aspect: number | undefined;
    if (crop) {
      if (!videoId) return fail("Informe o vídeo em que o recorte foi desenhado.", 422);
      const video = getVideo(videoId);
      if (!video) return fail("Vídeo não encontrado.", 404);
      const a = aspectOf(video.width, video.height);
      if (a === null) return fail("Resolução do vídeo desconhecida; rode a análise antes.", 422);
      const cropError = profileCropError(crop);
      if (cropError) return fail(cropError, 422);
      aspect = a;
    }

    const updated = updateSourceProfile(id, { name, crop, aspect });
    if (!updated) return fail("Perfil não encontrado.", 404);
    return json({
      ok: true,
      profile: { ...updated, originLabel: originLabel(updated.originKey), videoCount: sourceProfileUsage()[id] ?? 0 },
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return fail("Parâmetro 'id' ausente.", 400);
  // Os vídeos com o recorte deste perfil mantêm o recorte; só perdem o vínculo.
  deleteSourceProfile(id);
  return json({ ok: true });
}
