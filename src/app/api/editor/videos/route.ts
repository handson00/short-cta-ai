import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

interface VideoWithDetails {
  id: string;
  originalName: string;
  thumbnailPath: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  hasCta: boolean;
  ctaText: string | null;
  commentCount: number;
  hashtagCount: number;
  hasAnalysis: boolean;
}

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const rows = db().prepare(`
    SELECT
      v.id,
      v.original_name,
      v.thumbnail_path,
      v.width,
      v.height,
      v.duration_seconds,
      CASE WHEN us.chosen_cta_id IS NOT NULL OR us.edited_text IS NOT NULL THEN 1 ELSE 0 END as has_selection,
      us.edited_text,
      (SELECT cs.text FROM cta_suggestions cs WHERE cs.video_id = v.id AND cs.is_recommended = 1 LIMIT 1) as recommended_cta,
      (SELECT COUNT(*) FROM post_comments pc WHERE pc.video_id = v.id) as comment_count,
      (SELECT COUNT(*) FROM publish_kits pk WHERE pk.video_id = v.id) as has_publish_kit,
      (SELECT json_array_length(pk.hashtags_json) FROM publish_kits pk WHERE pk.video_id = v.id LIMIT 1) as hashtag_count,
      CASE WHEN sa.id IS NOT NULL THEN 1 ELSE 0 END as has_analysis
    FROM videos v
    LEFT JOIN user_selections us ON us.video_id = v.id
    LEFT JOIN scene_analyses sa ON sa.video_id = v.id
    WHERE v.purged_at IS NULL
    ORDER BY v.created_at DESC
    LIMIT 200
  `).all() as Array<{
    id: string;
    original_name: string;
    thumbnail_path: string | null;
    width: number | null;
    height: number | null;
    duration_seconds: number | null;
    has_selection: number;
    edited_text: string | null;
    recommended_cta: string | null;
    comment_count: number;
    has_publish_kit: number;
    hashtag_count: number | null;
    has_analysis: number;
  }>;

  const videos: VideoWithDetails[] = rows.map((r) => ({
    id: r.id,
    originalName: r.original_name,
    thumbnailPath: r.thumbnail_path,
    width: r.width,
    height: r.height,
    durationSeconds: r.duration_seconds,
    hasCta: Boolean(r.has_selection || r.recommended_cta),
    ctaText: r.edited_text ?? r.recommended_cta ?? null,
    commentCount: r.comment_count,
    hashtagCount: r.hashtag_count ?? 0,
    hasAnalysis: Boolean(r.has_analysis),
  }));

  return NextResponse.json({ videos });
}