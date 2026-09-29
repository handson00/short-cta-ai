import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, json, fail, handleError } from "@/lib/api";
import { getEditorTemplate, listRecentEditorJobs, clearFinishedEditorJobs } from "@/lib/editorRepo";
import {
  cancelAllEditorJobs,
  cancelEditorJob,
  enqueueExports,
  exportQueueInfo,
} from "@/lib/editor/exportQueue";

export const dynamic = "force-dynamic";

const schema = z.object({
  videoIds: z.array(z.string().min(1)).min(1).max(500),
  /** Reserva para vídeos sem template aplicado; quem tem um usa o seu. */
  templateId: z.string().min(1).nullable().optional(),
  fps: z.number().int().min(1).max(60).default(30),
  encoderMode: z.enum(["auto", "nvenc", "qsv", "amf", "cpu"]).default("auto"),
  /** Camadas de texto já enviadas por /api/editor/text-layer, por vídeo. */
  textLayers: z.record(z.string(), z.string().max(80)).optional(),
});

/** Estado da fila: a tela consulta isto enquanto houver job em andamento. */
export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  return json({ queue: exportQueueInfo(), jobs: listRecentEditorJobs() });
}

/**
 * Enfileira e responde na hora.
 *
 * Renderizar dentro da requisicao prendia a conexao pelo lote inteiro: com 30
 * videos, o navegador ou o proxy desistiam antes do fim, e o usuario nao via
 * progresso nenhum.
 */
export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Requisição inválida.", 422);
    }
    const { videoIds, templateId, fps, encoderMode, textLayers } = parsed.data;
    if (templateId && !getEditorTemplate(templateId)) return fail("Template não encontrado.", 404);

    const result = enqueueExports(videoIds, {
      fallbackTemplateId: templateId,
      fps,
      encoderMode,
      textLayers,
    });
    if (result.jobIds.length === 0) {
      return fail(
        "Nenhum dos vídeos tem template aplicado. Aplique um template ou abra um no painel.",
        422,
        { skipped: result.skipped },
      );
    }
    return json({ ok: true, ...result, queue: exportQueueInfo() });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * `?jobId=` cancela um; `?all=1` cancela todos; `?clear=1` limpa os que ja
 * terminaram da lista (os arquivos gerados continuam no disco).
 */
export async function DELETE(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const params = req.nextUrl.searchParams;
  if (params.get("clear") === "1") return json({ ok: true, cleared: clearFinishedEditorJobs() });
  if (params.get("all") === "1") return json({ ok: true, cancelled: cancelAllEditorJobs() });

  const jobId = params.get("jobId");
  if (!jobId) return fail("Informe 'jobId', 'all=1' ou 'clear=1'.", 400);
  // Job que já terminou não é erro: o clique pode ter chegado depois do fim.
  return json({ ok: true, cancelled: cancelEditorJob(jobId) });
}
