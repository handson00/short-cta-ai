import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, json, fail, handleError } from "@/lib/api";
import { getVideo } from "@/lib/repo";
import {
  createEditorJob,
  getEditorTemplate,
  getVideoCrop,
  listEditorJobsByVideo,
  updateEditorJobStatus,
} from "@/lib/editorRepo";
import { renderVideo, cancelExport, ExportError } from "@/lib/editor/export";
import { resolveEncoder, type EncoderMode } from "@/lib/editor/encoder";

export const dynamic = "force-dynamic";
export const maxDuration = 3600;

const schema = z.object({
  videoIds: z.array(z.string().min(1)).min(1).max(100),
  templateId: z.string().min(1).optional(),
  fps: z.number().int().min(1).max(60).default(30),
  encoderMode: z.enum(["auto", "nvenc", "qsv", "amf", "cpu"]).default("auto"),
});

export async function GET(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const videoId = req.nextUrl.searchParams.get("videoId");
  if (!videoId) return fail("Parâmetro 'videoId' ausente.", 400);
  return json({ jobs: listEditorJobsByVideo(videoId) });
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Requisição inválida.", 422);
    }
    const { videoIds, templateId, fps, encoderMode } = parsed.data;

    let encoder: string;
    try {
      encoder = await resolveEncoder(encoderMode as EncoderMode);
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Nenhum encoder disponível.", 409);
    }

    // Sequencial de propósito: vinte FFmpegs ao mesmo tempo deixariam a
    // máquina inutilizável e cada um mais lento que todos em fila (§56).
    const results = [];
    for (const videoId of videoIds) {
      const video = getVideo(videoId);
      if (!video) {
        results.push({ videoId, error: "Vídeo não encontrado." });
        continue;
      }

      const template = templateId ? getEditorTemplate(templateId) : null;
      if (templateId && !template) {
        results.push({ videoId, error: "Template não encontrado." });
        continue;
      }
      if (!template) {
        results.push({ videoId, error: "Nenhum template escolhido para este vídeo." });
        continue;
      }

      const crop = getVideoCrop(videoId);
      const job = createEditorJob({ videoId, templateId: template.id, crop: crop ?? undefined });
      updateEditorJobStatus(job.id, "processing", { progress: 0 });

      try {
        const out = await renderVideo(
          {
            videoId,
            sourcePath: video.path,
            originalName: video.originalName,
            sourceWidth: video.width ?? 0,
            sourceHeight: video.height ?? 0,
            durationSeconds: video.durationSeconds ?? 0,
            hasAudio: video.hasAudio,
            crop,
            template: template.config,
            fps,
            encoder,
          },
          (snap) => {
            if (snap.percent != null) {
              updateEditorJobStatus(job.id, "processing", { progress: Math.round(snap.percent) });
            }
          },
        );

        updateEditorJobStatus(job.id, "completed", { progress: 100, outputPath: out.outputPath });
        results.push({ videoId, jobId: job.id, outputPath: out.outputPath, bytes: out.bytes, error: null });
      } catch (err) {
        const message =
          err instanceof ExportError ? err.message : err instanceof Error ? err.message : "Falha ao exportar.";
        const cancelled = message.includes("cancelada");
        updateEditorJobStatus(job.id, cancelled ? "cancelled" : "failed", { errorMessage: message });
        results.push({ videoId, jobId: job.id, error: message });
      }
    }

    return json({ ok: true, encoder, results });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const videoId = req.nextUrl.searchParams.get("videoId");
  if (!videoId) return fail("Parâmetro 'videoId' ausente.", 400);
  // Sem processo em andamento não é erro: o usuário pode ter clicado depois de
  // a renderização já ter terminado.
  return json({ ok: true, cancelled: cancelExport(videoId) });
}
