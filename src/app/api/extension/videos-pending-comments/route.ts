import { json } from "@/lib/api";
import * as repo from "@/lib/repo";

/**
 * Endpoint público para a extensão listar vídeos que possuem URL de origem
 * do TikTok e precisam de captura de comentários.
 * 
 * Não exige autenticação de sessão (a extensão não tem cookie do app).
 * A segurança está no fato de ser localhost e só retornar URLs públicas.
 */

const corsHeaders = () => ({
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-max-age": "86400",
});

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET() {
  const videos = repo.listVideos();
  
  // Filtra apenas vídeos do TikTok com URL de origem válida
  const pendentes = videos
    .filter((v) => v.platform === "tiktok" && v.originalUrl && /^https:\/\/www\.tiktok\.com\/@[^/]+\/video\/\d+/.test(v.originalUrl))
    .map((v) => ({
      id: v.id,
      originalUrl: v.originalUrl,
      name: v.originalName,
      hasComments: false, // Será verificado abaixo
    }));

  // Verifica quais já têm comentários capturados
  for (const p of pendentes) {
    const comments = repo.getComments(p.id);
    p.hasComments = comments.length > 0;
  }

  return json({ videos: pendentes }, { headers: corsHeaders() });
}