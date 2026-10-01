import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, json, fail, handleError } from "@/lib/api";
import { getVideoCrop, listVideoCrops, saveVideoCrops, deleteVideoCrop } from "@/lib/editorRepo";
import type { EditorCrop } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * O cliente envia so o retangulo. Os argumentos do FFmpeg sao montados no
 * servidor (spec §83): string de filtro vinda do navegador nunca e aceita.
 */
const cropSchema = z
  .object({
    videoIds: z.array(z.string().min(1)).min(1),
    crop: z.object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().gt(0).max(1),
      height: z.number().gt(0).max(1),
      // "profile" não entra por aqui: um recorte só vira "do perfil" pela rota
      // /api/editor/profiles/apply, que confere página e proporção.
      source: z.enum(["auto", "manual"]).default("manual"),
      confidence: z.number().min(0).max(100).optional(),
    }),
  })
  .refine((v) => v.crop.x + v.crop.width <= 1.0001, {
    message: "O recorte ultrapassa a borda direita do vídeo.",
  })
  .refine((v) => v.crop.y + v.crop.height <= 1.0001, {
    message: "O recorte ultrapassa a borda inferior do vídeo.",
  });

export async function GET(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const videoId = req.nextUrl.searchParams.get("videoId");
  if (videoId) return json({ crop: getVideoCrop(videoId) });
  return json({ crops: listVideoCrops() });
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const parsed = cropSchema.safeParse(await req.json());
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Recorte inválido.", 422);
    }

    const { videoIds, crop } = parsed.data;
    const record: EditorCrop = { ...crop, normalized: true };
    const saved = saveVideoCrops(videoIds, record);
    return json({ ok: true, saved });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const videoId = req.nextUrl.searchParams.get("videoId");
  if (!videoId) return fail("Parâmetro 'videoId' ausente.", 400);
  deleteVideoCrop(videoId);
  return json({ ok: true });
}
