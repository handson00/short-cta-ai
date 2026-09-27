import { z } from "zod";
import { fail, json, readJson } from "@/lib/api";
import { env } from "@/lib/env";
import { parsePostUrl } from "@/lib/postUrl";
import * as repo from "@/lib/repo";

/**
 * Recebe os comentarios coletados pela extensao.
 *
 * Esta rota NAO usa a sessao do navegador: a extensao roda na aba do Instagram
 * ou do TikTok e nao tem o cookie desta aplicacao. Quem autoriza e um token
 * proprio (`COMMENTS_INGEST_TOKEN`), enviado no cabecalho Authorization.
 *
 * Sobre o CORS liberado abaixo: ele nao e a protecao desta rota - o token e.
 * CORS so decide quem o NAVEGADOR deixa ler a resposta; qualquer programa fora
 * do navegador ignora isso. Por isso a resposta nunca inclui credenciais e o
 * token e obrigatorio. Sem token configurado, a rota recusa tudo.
 */

const MAX_COMENTARIOS = 200;

const Comentario = z.object({
  externalId: z.string().max(120).nullish(),
  parentExternalId: z.string().max(120).nullish(),
  author: z.string().max(200).nullish(),
  text: z.string().min(1).max(4000),
  likeCount: z.number().int().min(0).max(100_000_000).nullish(),
  publishedLabel: z.string().max(60).nullish(),
});

const Hashtags = z.object({
  doVideo: z.array(z.string()).default([]),
  nosComentarios: z.array(z.object({ tag: z.string(), vezes: z.number() })).default([]),
  todas: z.array(z.string()).default([]),
}).optional();

const Payload = z.object({
  postUrl: z.string().min(5).max(2048),
  comments: z.array(Comentario).max(MAX_COMENTARIOS),
  hashtags: Hashtags,
});

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-max-age": "86400",
  };
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function tokenValido(request: Request): boolean {
  const esperado = env.commentsIngestToken;
  if (!esperado) return false;
  const header = request.headers.get("authorization") ?? "";
  const recebido = header.replace(/^Bearer\s+/i, "").trim();
  if (recebido.length !== esperado.length) return false;
  // Comparacao de tempo constante: evita distinguir o token por quanto demora.
  let diff = 0;
  for (let i = 0; i < esperado.length; i += 1) diff |= esperado.charCodeAt(i) ^ recebido.charCodeAt(i);
  return diff === 0;
}

export async function POST(request: Request) {
  if (!env.commentsIngestToken) {
    return json(
      { error: "Ingestão de comentários desativada: defina COMMENTS_INGEST_TOKEN no .env.local." },
      { status: 503, headers: corsHeaders() },
    );
  }
  if (!tokenValido(request)) {
    return json({ error: "Token de ingestão inválido." }, { status: 401, headers: corsHeaders() });
  }

  let corpo: unknown;
  try {
    corpo = await readJson(request);
  } catch {
    return json({ error: "Corpo da requisição não é JSON válido." }, { status: 400, headers: corsHeaders() });
  }

  const parsed = Payload.safeParse(corpo);
  if (!parsed.success) {
    const problemas = parsed.error.issues.slice(0, 8).map((i: any) => ({
      caminho: i.path.join("."),
      mensagem: i.message,
      recebido: i.received,
    }));
    return json(
      { error: "Formato inesperado.", problemas },
      { status: 422, headers: corsHeaders() },
    );
  }

  const ref = parsePostUrl(parsed.data.postUrl);
  if (!ref) {
    return json(
      { error: "Não reconheci este link como post do Instagram ou do TikTok." },
      { status: 422, headers: corsHeaders() },
    );
  }

  const video = repo.findVideoByPlatformId(ref.platform, ref.platformVideoId);
  if (!video) {
    // Nao e erro do coletor: o usuario pode estar num post que nunca importou.
    return json(
      {
        error: "Nenhum vídeo importado corresponde a este post.",
        platform: ref.platform,
        platformVideoId: ref.platformVideoId,
      },
      { status: 404, headers: corsHeaders() },
    );
  }

  const gravados = repo.replaceComments(video.id, ref.platform, parsed.data.comments);

  // Salvar hashtags se fornecidas
  if (parsed.data.hashtags) {
    repo.saveVideoHashtags(video.id, parsed.data.hashtags);
  }

  return json({ ok: true, videoId: video.id, gravados }, { headers: corsHeaders() });
}
