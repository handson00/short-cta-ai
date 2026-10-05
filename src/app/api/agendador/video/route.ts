import fs from "node:fs";
import { NextResponse } from "next/server";
import { fail } from "@/lib/api";
import { conferirIngresso } from "@/lib/agendador";
import { getEditorJob } from "@/lib/editorRepo";

export const dynamic = "force-dynamic";

/**
 * Entrega o MP4 exportado à extensão "Agendador IG".
 *
 * Esta rota NÃO usa a sessão: quem baixa é a extensão, que não tem o cookie
 * desta aplicação. Autoriza o ingresso (`lib/agendador.ts`): assinado, de um
 * vídeo só e com prazo curto. O caminho do arquivo vem do job no banco, nunca
 * do pedido — o ingresso diz QUAL exportação, não ONDE ler.
 */
export async function GET(request: Request) {
  const jobId = conferirIngresso(new URL(request.url).searchParams.get("t"));
  if (!jobId) return fail("Link do vídeo inválido ou vencido. Clique em enviar de novo.", 403);

  const job = getEditorJob(jobId);
  if (!job || job.status !== "completed" || !job.outputPath) return fail("Exportação não encontrada.", 404);
  if (!fs.existsSync(job.outputPath)) return fail("O arquivo não está mais na pasta de saída.", 404);

  const tamanho = fs.statSync(job.outputPath).size;
  const stream = fs.createReadStream(job.outputPath);
  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      "content-type": "video/mp4",
      // A extensão confere o tamanho recebido contra este: download cortado
      // não pode virar post com vídeo pela metade.
      "content-length": String(tamanho),
      "cache-control": "no-store",
    },
  });
}
