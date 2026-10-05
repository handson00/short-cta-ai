import { z } from "zod";
import { fail, handleError, json, readJson, requireAuth } from "@/lib/api";
import { registrarEnvio } from "@/lib/agendador";
import { getExport } from "@/lib/exportsData";

export const dynamic = "force-dynamic";

/**
 * Grava o recibo de um envio que a extensão confirmou.
 *
 * Separado da preparação de propósito: o recibo só existe se a extensão disse
 * "recebi". Um envio que falhou no meio não pode aparecer como enviado.
 */

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^\d{2}:\d{2}$/;

const Corpo = z.object({
  extPostId: z.string().min(1).max(120),
  data: z.string().regex(DATA).nullable(),
  hora: z.string().regex(HORA).nullable(),
  texto: z.string().max(10_000),
});

export async function POST(request: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const { jobId } = await ctx.params;
    const corpo = Corpo.safeParse(await readJson(request));
    if (!corpo.success) return fail("Pedido inválido.", 400);

    const item = getExport(jobId);
    if (!item) return fail("Exportação não encontrada.", 404);

    const { extPostId, data, hora, texto } = corpo.data;
    const envio = registrarEnvio({
      exportJobId: jobId,
      videoId: item.videoId,
      extPostId,
      data: data ?? null,
      hora: hora ?? null,
      texto,
    });
    return json({ envio });
  } catch (err) {
    return handleError(err);
  }
}
