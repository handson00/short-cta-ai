import { NextResponse } from "next/server";
import * as repo from "@/lib/repo";

/**
 * Endpoint público para a extensão listar vídeos que possuem URL de origem
 * do TikTok e precisam de captura de comentários.
 *
 * Não exige autenticação de sessão (a extensão não tem cookie do app).
 * Usa NextResponse.json diretamente para evitar qualquer guarda de auth
 * que possa ser aplicada pelo helper json() de @/lib/api.
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

  const pendentes = videos
    .filter((v) => v.platform === "tiktok" && v.originalUrl && /^https:\/\/www\.tiktok\.com\/@[^/]+\/video\/\d+/.test(v.originalUrl))
    .map((v) => ({
      id: v.id,
      originalUrl: v.originalUrl,
      name: v.originalName,
      hasComments: false,
    }));

  for (const p of pendentes) {
    const comments = repo.getComments(p.id);
    p.hasComments = comments.length > 0;
  }

  return NextResponse.json({ videos: pendentes }, { headers: corsHeaders() });
}