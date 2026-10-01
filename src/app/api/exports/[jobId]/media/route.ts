import fs from "node:fs";
import { NextResponse } from "next/server";
import { fail, requireAuth } from "@/lib/api";
import { getEditorJob } from "@/lib/editorRepo";

/**
 * Serve o MP4 exportado para o preview da página de Exportações.
 *
 * O caminho vem do JOB, nunca do cliente: o navegador manda só o id, e o
 * servidor lê `output_path` do banco. Aceitar um caminho do navegador serviria
 * qualquer arquivo da máquina.
 *
 * Responde a `Range` porque o player pede o vídeo em pedaços — sem isso, um
 * MP4 de 70 MB só começaria a tocar depois de baixar inteiro.
 */
export async function GET(request: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { jobId } = await ctx.params;
  const job = getEditorJob(jobId);
  if (!job || job.status !== "completed" || !job.outputPath) return fail("Exportação não encontrada.", 404);
  if (!fs.existsSync(job.outputPath)) return fail("O arquivo não está mais na pasta de saída.", 404);

  const stat = fs.statSync(job.outputPath);
  const range = request.headers.get("range");

  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start = match && match[1] ? Number(match[1]) : 0;
    const end = match && match[2] ? Number(match[2]) : Math.min(stat.size - 1, start + 2 * 1024 * 1024);
    if (start >= stat.size) return fail("Faixa inválida.", 416);

    const stream = fs.createReadStream(job.outputPath, { start, end });
    return new NextResponse(stream as unknown as ReadableStream, {
      status: 206,
      headers: {
        "content-type": "video/mp4",
        "content-length": String(end - start + 1),
        "content-range": `bytes ${start}-${end}/${stat.size}`,
        "accept-ranges": "bytes",
      },
    });
  }

  const stream = fs.createReadStream(job.outputPath);
  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      "content-type": "video/mp4",
      "content-length": String(stat.size),
      "accept-ranges": "bytes",
    },
  });
}
