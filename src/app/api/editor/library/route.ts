import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

interface LibraryVideo {
  id: string;
  originalName: string;
  thumbnailPath: string | null;
  width: number | null;
  height: number | null;
  aspectRatio: string | null;
  durationSeconds: number | null;
  hasCta: boolean;
  ctaText: string | null;
  commentCount: number;
  hashtagCount: number;
  hasAnalysis: boolean;
  status: string;
  templateId: string | null;
}

/**
 * Vídeos que estão na fase de edição.
 *
 * Só entra aqui o que foi promovido explicitamente pela Fila (`editor_videos`).
 *
 * Todo dado agregado vem de subconsulta, nunca de `LEFT JOIN`: um vídeo
 * reanalisado tem várias linhas em `scene_analyses`, e o JOIN multiplicava o
 * vídeo por quantas análises ele tivesse — 98 vídeos apareciam como 109 cards.
 */
export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const rows = db()
    .prepare(
      `SELECT
         v.id,
         v.original_name,
         v.thumbnail_path,
         v.width,
         v.height,
         v.aspect_ratio,
         v.duration_seconds,
         (SELECT us.edited_text FROM user_selections us WHERE us.video_id = v.id LIMIT 1) AS edited_text,
         (SELECT CASE WHEN us.chosen_cta_id IS NOT NULL OR us.edited_text IS NOT NULL THEN 1 ELSE 0 END
            FROM user_selections us WHERE us.video_id = v.id LIMIT 1) AS has_selection,
         (SELECT cs.text FROM cta_suggestions cs
            WHERE cs.video_id = v.id AND cs.is_recommended = 1 LIMIT 1) AS recommended_cta,
         (SELECT COUNT(*) FROM post_comments pc WHERE pc.video_id = v.id) AS comment_count,
         (SELECT json_array_length(pk.hashtags_json) FROM publish_kits pk
            WHERE pk.video_id = v.id LIMIT 1) AS hashtag_count,
         EXISTS(SELECT 1 FROM scene_analyses sa WHERE sa.video_id = v.id) AS has_analysis,
         (SELECT aj.status FROM analysis_jobs aj
            WHERE aj.video_id = v.id ORDER BY aj.created_at DESC LIMIT 1) AS job_status,
         ev.template_id
       FROM videos v
       JOIN editor_videos ev ON ev.video_id = v.id
       WHERE v.purged_at IS NULL
       ORDER BY ev.added_at DESC`,
    )
    .all() as Array<{
    id: string;
    original_name: string;
    thumbnail_path: string | null;
    width: number | null;
    height: number | null;
    aspect_ratio: string | null;
    duration_seconds: number | null;
    edited_text: string | null;
    has_selection: number | null;
    recommended_cta: string | null;
    comment_count: number;
    hashtag_count: number | null;
    has_analysis: number;
    job_status: string | null;
    template_id: string | null;
  }>;

  const videos: LibraryVideo[] = rows.map((r) => ({
    id: r.id,
    originalName: r.original_name,
    thumbnailPath: r.thumbnail_path,
    width: r.width,
    height: r.height,
    aspectRatio: r.aspect_ratio,
    durationSeconds: r.duration_seconds,
    hasCta: Boolean(r.has_selection || r.recommended_cta),
    ctaText: r.edited_text ?? r.recommended_cta ?? null,
    commentCount: r.comment_count,
    hashtagCount: r.hashtag_count ?? 0,
    hasAnalysis: Boolean(r.has_analysis),
    status: r.job_status ?? "queued",
    templateId: r.template_id,
  }));

  return NextResponse.json({ videos });
}
