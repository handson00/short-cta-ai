import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, json, fail, handleError } from "@/lib/api";
import { getVideo } from "@/lib/repo";
import { saveVideoCrops } from "@/lib/editorRepo";
import { analyzeSmartCrop, SmartCropError } from "@/lib/editor/smartCrop";
import { confidenceLevel } from "@/lib/editor/motion";

export const dynamic = "force-dynamic";

const schema = z.object({
  videoIds: z.array(z.string().min(1)).min(1).max(50),
  /** Spec §22: detectar nunca aplica sozinho — o usuário decide. */
  save: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Requisição inválida.", 422);
    }

    const results = [];
    for (const videoId of parsed.data.videoIds) {
      const video = getVideo(videoId);
      if (!video) {
        results.push({ videoId, error: "Vídeo não encontrado." });
        continue;
      }

      try {
        const analysis = await analyzeSmartCrop(
          video.path,
          video.width ?? 0,
          video.height ?? 0,
          video.durationSeconds ?? 0,
        );

        // Um vídeo sem moldura não tem recorte a propor. Gravar o quadro
        // inteiro como "detecção" faria uma não-descoberta parecer resultado.
        if (parsed.data.save && analysis.hasBorder) {
          saveVideoCrops([videoId], {
            ...analysis.rect,
            normalized: true,
            source: "auto",
            confidence: analysis.confidence,
          });
        }

        results.push({
          videoId,
          rect: analysis.rect,
          confidence: analysis.confidence,
          level: confidenceLevel(analysis.confidence),
          hasBorder: analysis.hasBorder,
          framesAnalyzed: analysis.framesAnalyzed,
          saved: parsed.data.save && analysis.hasBorder,
          error: null,
        });
      } catch (err) {
        results.push({
          videoId,
          error:
            err instanceof SmartCropError
              ? err.message
              : err instanceof Error
                ? err.message
                : "Falha ao analisar o vídeo.",
        });
      }
    }

    return json({ ok: true, results });
  } catch (err) {
    return handleError(err);
  }
}
