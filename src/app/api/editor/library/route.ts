import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** De onde veio o CTA que o vídeo vai mostrar. */
type CtaSource = "editado" | "escolhido" | "recomendado" | null;

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
  ctaSource: CtaSource;
  /** Texto próprio definido no editor; vence o CTA da análise. */
  textOverride: string | null;
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
 *
 * O CTA segue a mesma regra da Fila (`view.ts`): o texto editado, senão a
 * sugestão escolhida. Só na falta das duas entra a recomendada pela análise —
 * e a origem vai junto, para a tela não apresentar uma recomendação como se
 * fosse escolha do usuário.
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
         (SELECT cs.text FROM user_selections us JOIN cta_suggestions cs ON cs.id = us.chosen_cta_id
            WHERE us.video_id = v.id LIMIT 1) AS chosen_cta,
         (SELECT cs.text FROM cta_suggestions cs
            WHERE cs.video_id = v.id AND cs.is_recommended = 1 LIMIT 1) AS recommended_cta,
         (SELECT t.text FROM editor_video_texts t WHERE t.video_id = v.id) AS text_override,
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
    chosen_cta: string | null;
    recommended_cta: string | null;
    text_override: string | null;
    comment_count: number;
    hashtag_count: number | null;
    has_analysis: number;
    job_status: string | null;
    template_id: string | null;
  }>;

  const videos: LibraryVideo[] = rows.map((r) => {
    const [ctaText, ctaSource]: [string | null, CtaSource] = r.edited_text
      ? [r.edited_text, "editado"]
      : r.chosen_cta
        ? [r.chosen_cta, "escolhido"]
        : r.recommended_cta
          ? [r.recommended_cta, "recomendado"]
          : [null, null];
    return {
      id: r.id,
      originalName: r.original_name,
      thumbnailPath: r.thumbnail_path,
      width: r.width,
      height: r.height,
      aspectRatio: r.aspect_ratio,
      durationSeconds: r.duration_seconds,
      hasCta: ctaText !== null,
      ctaText,
      ctaSource,
      textOverride: r.text_override,
      commentCount: r.comment_count,
      hashtagCount: r.hashtag_count ?? 0,
      hasAnalysis: Boolean(r.has_analysis),
      status: r.job_status ?? "queued",
      templateId: r.template_id,
    };
  });

  return NextResponse.json({ videos });
}
