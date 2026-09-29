import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, json, fail, handleError } from "@/lib/api";
import { addVideosToEditor, removeVideoFromEditor, listEditorVideoIds } from "@/lib/editorRepo";

export const dynamic = "force-dynamic";

const promoteSchema = z.object({
  videoIds: z.array(z.string().min(1)).min(1),
});

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  return json({ videoIds: listEditorVideoIds() });
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const parsed = promoteSchema.safeParse(await req.json());
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Lista de vídeos inválida.", 422);
    }
    const result = addVideosToEditor(parsed.data.videoIds);
    return json({ ok: true, ...result });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const videoId = req.nextUrl.searchParams.get("videoId");
  if (!videoId) return fail("Parâmetro 'videoId' ausente.", 400);
  removeVideoFromEditor(videoId);
  return json({ ok: true });
}
