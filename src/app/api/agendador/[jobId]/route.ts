import fs from "node:fs";
import { z } from "zod";
import { fail, handleError, json, readJson, requireAuth } from "@/lib/api";
import { emitirIngresso } from "@/lib/agendador";
import { BLOCOS, hashtagsOferecidas, montarPost } from "@/lib/agendadorPost";
import { env } from "@/lib/env";
import { getExport } from "@/lib/exportsData";
import { probe } from "@/lib/media/ffmpeg";
import { run } from "@/lib/media/run";

export const dynamic = "force-dynamic";

/**
 * Prepara o post de uma exportação para a extensão "Agendador IG".
 *
 * Não envia nada: devolve o post montado e o link do vídeo, e quem entrega à
 * extensão é a própria página (a extensão só conversa com o navegador). O
 * recibo é gravado depois, em `confirmar`, quando a extensão disser que
 * recebeu.
 */

const Corpo = z.object({
  blocos: z.array(z.enum(BLOCOS)).max(BLOCOS.length),
  hashtags: z.array(z.string().max(200)).max(60),
});

/** A extensão só tem permissão para estes endereços (manifest, `host_permissions`). */
const HOSTS_DA_EXTENSAO = new Set(["localhost", "127.0.0.1"]);

/** Miniatura no formato do painel da extensão: JPEG 180×320, em data URL. */
async function miniatura(arquivo: string, duracao: number): Promise<string> {
  try {
    const { stdoutBuffer } = await run(
      env.ffmpegPath,
      [
        "-v", "error", "-ss", String(Math.min(1, duracao / 3)), "-i", arquivo, "-frames:v", "1",
        "-vf", "scale=180:320:force_original_aspect_ratio=decrease,pad=180:320:(ow-iw)/2:(oh-ih)/2",
        "-f", "image2", "-c:v", "mjpeg", "-q:v", "5", "pipe:1",
      ],
      { timeoutMs: 20_000, binaryStdout: true },
    );
    return stdoutBuffer.length > 0 ? `data:image/jpeg;base64,${stdoutBuffer.toString("base64")}` : "";
  } catch {
    // Sem miniatura o post entra igual: o painel da extensão também a deixa
    // vazia quando não consegue gerar.
    return "";
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const { jobId } = await ctx.params;
    const corpo = Corpo.safeParse(await readJson(request));
    if (!corpo.success) return fail("Pedido inválido.", 400);

    // O endereço que o NAVEGADOR usou (cabeçalho Host), não o que o servidor
    // escuta: com `next start -H 0.0.0.0`, `request.url` pode não ser o mesmo.
    // É desse endereço que a extensão vai baixar o vídeo.
    const origem = new URL(`http://${request.headers.get("host") ?? new URL(request.url).host}`);
    if (!HOSTS_DA_EXTENSAO.has(origem.hostname)) {
      return fail(
        `A extensão só fala com o sistema aberto em http://localhost:${origem.port || 3000}. Abra por esse endereço para enviar.`,
        409,
        { code: "host" },
      );
    }

    const item = getExport(jobId);
    if (!item) return fail("Exportação não encontrada.", 404);
    if (item.fileMissing) return fail("O arquivo deste vídeo não está mais na pasta de saída. Exporte de novo.", 409);

    // Só as hashtags que a página oferece para este vídeo: o envio não aceita
    // texto solto que a tela não mostrou.
    const oferecidas = new Set(hashtagsOferecidas(item).map((t) => t.toLocaleLowerCase("pt-BR")));
    const hashtags = corpo.data.hashtags.filter((t) => oferecidas.has(t.toLocaleLowerCase("pt-BR")));

    const post = montarPost(item, { blocos: corpo.data.blocos, hashtags });
    if (post.problemas.length > 0) return fail(post.problemas.join(" "), 422);

    const midia = await probe(item.outputPath);
    const tamanho = fs.statSync(item.outputPath).size;

    return json({
      post: {
        exportJobId: item.jobId,
        videoId: item.videoId,
        fileName: item.fileName,
        mime: "video/mp4",
        size: tamanho,
        duration: midia.durationSeconds,
        width: midia.width ?? 1080,
        height: midia.height ?? 1920,
        thumb: await miniatura(item.outputPath, midia.durationSeconds),
        caption: post.caption,
        hashtags: post.hashtags,
      },
      textoFinal: post.textoFinal,
      videoUrl: `${origem.origin}/api/agendador/video?t=${encodeURIComponent(emitirIngresso(item.jobId))}`,
    });
  } catch (err) {
    return handleError(err);
  }
}
