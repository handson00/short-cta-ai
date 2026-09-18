import { json, requireAuth } from "@/lib/api";
import { configWarnings } from "@/lib/env";
import { credentialStatus, getSettings } from "@/lib/settings";
import { transcriptionStatus } from "@/lib/providers/transcription";
import { visionStatus } from "@/lib/providers/vision";
import { searchStatus } from "@/lib/providers/search";
import { ffmpegAvailable } from "@/lib/media/ffmpeg";
import { activeJobCount, workerRunning } from "@/lib/queue";
import { queueOverview } from "@/lib/view";
import { db } from "@/lib/db";
import { MODEL_NOTE, MODEL_SUGGESTIONS } from "@/lib/models";

export const dynamic = "force-dynamic";

interface UsageRow {
  operation: string;
  model: string | null;
  status: string;
  total: number;
  avg_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
}

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  const [transcription, vision, media] = await Promise.all([
    transcriptionStatus(),
    visionStatus(),
    ffmpegAvailable(),
  ]);

  const usage = db()
    .prepare(
      `SELECT operation, model, status, COUNT(*) AS total, AVG(duration_ms) AS avg_ms,
              SUM(prompt_tokens) AS prompt_tokens, SUM(completion_tokens) AS completion_tokens
       FROM ai_request_logs GROUP BY operation, model, status ORDER BY total DESC LIMIT 50`,
    )
    .all() as UsageRow[];

  const recentErrors = db()
    .prepare(
      `SELECT operation, model, error_code, error_message, created_at FROM ai_request_logs
       WHERE status = 'error' ORDER BY created_at DESC LIMIT 20`,
    )
    .all();

  return json({
    warnings: configWarnings(),
    credential: credentialStatus(),
    settings: getSettings(),
    models: { suggestions: MODEL_SUGGESTIONS, note: MODEL_NOTE },
    providers: {
      transcription,
      vision,
      search: searchStatus(),
      media: { ffmpeg: media.ffmpeg, ffprobe: media.ffprobe },
    },
    worker: { running: workerRunning(), active: activeJobCount() },
    queue: queueOverview(),
    usage,
    recentErrors,
  });
}
