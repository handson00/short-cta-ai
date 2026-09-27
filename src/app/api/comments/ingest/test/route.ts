import { json } from "@/lib/api";
import { env } from "@/lib/env";
import * as repo from "@/lib/repo";

export const dynamic = "force-dynamic";
// cache-bust: list-videos-action-v2

const corsHeaders = () => ({
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age": "86400",
});

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function tokenValido(request: Request): boolean {
  const esperado = env.commentsIngestToken;
  if (!esperado) return false;
  const header = request.headers.get("authorization") ?? "";
  const recebido = header.replace(/^Bearer\s+/i, "").trim();
  if (recebido.length !== esperado.length) return false;
  let diff = 0;
  for (let i = 0; i < esperado.length; i += 1) diff |= esperado.charCodeAt(i) ^ recebido.charCodeAt(i);
  return diff === 0;
}

/**
 * GET: Lista vídeos do TikTok pendentes de captura de comentários.
 * Usado pela extensão para captura em lote.
 */
export async function GET(request: Request) {
  if (!env.commentsIngestToken) {
    return json(
      { error: "COMMENTS_INGEST_TOKEN não definido no servidor." },
      { status: 503, headers: corsHeaders() },
    );
  }

  if (!tokenValido(request)) {
    return json({ error: "Token inválido." }, { status: 401, headers: corsHeaders() });
  }

  const videos = repo.listVideos();
  const pendentes = videos
    .filter((v) => v.platform === "tiktok" && v.originalUrl && /^https:\/\/www\.tiktok\.com\/@[^/]+\/video\/\d+/.test(v.originalUrl))
    .map((v) => ({
      id: v.id,
      originalUrl: v.originalUrl,
      name: v.originalName,
      hasComments: repo.getComments(v.id).length > 0,
    }));

  return json({ videos: pendentes }, { headers: corsHeaders() });
}

/**
 * POST: Endpoint multifuncional para a extensão.
 * - Sem body ou body vazio: valida o token ({ ok: true })
 * - Com { action: "list-videos" }: retorna lista de vídeos do TikTok pendentes
 * Não exige autenticação de sessão (a extensão não tem cookie do app).
 */
export async function POST(request: Request) {
 const auth = request.headers.get("authorization") ?? "";
 const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

 if (!env.commentsIngestToken) {
 return json(
 { error: "COMMENTS_INGEST_TOKEN não definido no servidor." },
 { status: 503, headers: corsHeaders() },
 );
 }

 if (!tokenValido(request)) {
 return json({ error: "Token inválido." }, { status: 401, headers: corsHeaders() });
 }

 // Tenta ler o body para verificar se é uma requisição de listagem
 let body: unknown = null;
 try {
 const text = await request.text();
 if (text.trim()) body = JSON.parse(text);
 } catch { /* body vazio ou inválido = validação simples */ }

 if (body && typeof body === "object" && (body as Record<string, unknown>).action === "list-videos") {
 const videos = repo.listVideos();
 const pendentes = videos
 .filter((v) => v.platform === "tiktok" && v.originalUrl && /^https:\/\/www\.tiktok\.com\/@[^/]+\/video\/\d+/.test(v.originalUrl))
 .map((v) => ({
 id: v.id,
 originalUrl: v.originalUrl,
 name: v.originalName,
 hasComments: repo.getComments(v.id).length > 0,
 }));
 return json({ videos: pendentes }, { headers: corsHeaders() });
 }

 return json({ ok: true }, { headers: corsHeaders() });
}