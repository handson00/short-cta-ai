import * as repo from "./repo";
import { queueCounts } from "./queue";
import { STATUS_LABEL, type CtaStyle, type JobStatus } from "./types";
import { buildEmbedUrl } from "./source";
import type { QueueOverview, VideoDetail, VideoSummary } from "./viewTypes";

export type { QueueOverview, VideoDetail, VideoSummary, SuggestionView, SelectionView } from "./viewTypes";


export function videoSummary(video: repo.VideoRecord, job: repo.JobRecord | undefined): VideoSummary {
  const analysis = repo.latestSceneAnalysis(video.id);
  const visual = repo.getVisualAnalysis(video.id);
  const existing = repo.effectiveExistingCta(visual);
  const work = repo.getWork(video.id);
  const suggestions = repo.listSuggestions(video.id);
  const selection = repo.getSelection(video.id);
  const status = (job?.status ?? "queued") as JobStatus;

  return {
    id: video.id,
    name: video.originalName,
    bytes: video.bytes,
    durationSeconds: video.durationSeconds,
    aspectRatio: video.aspectRatio,
    hasThumbnail: Boolean(video.thumbnailPath),
    status,
    statusLabel: STATUS_LABEL[status] ?? status,
    errorMessage: job?.errorMessage ?? null,
    errorCode: job?.errorCode ?? null,
    attempts: job?.attempts ?? 0,
    maxAttempts: job?.maxAttempts ?? 3,
    sceneSummary: analysis?.sceneSummary ?? null,
    recommendedCta: analysis?.recommended ?? null,
    existingCta: existing
      ? {
          text: existing.text,
          confidence: existing.confidence,
          firstSeenAtSeconds: existing.firstSeenAtSeconds,
        }
      : null,
    existingCtaReview: analysis?.existingCta
      ? { strength: analysis.existingCta.strength, improvement: analysis.existingCta.possibleImprovement }
      : null,
    work: {
      label:
        work?.status === "identified" && work.title
          ? `${work.title}${work.year ? ` (${work.year})` : ""}`
          : "Obra não identificada com segurança",
      confidence: work?.confidence ?? "low",
      identified: work?.status === "identified" && Boolean(work.title),
    },
    suggestionCount: suggestions.length,
    chosenText:
      selection.editedText ?? suggestions.find((s) => s.id === selection.chosenCtaId)?.text ?? null,
    favorite: selection.favorite,
    createdAt: video.createdAt,
    source: {
      folder: video.sourceFolder,
      username: video.tiktokUsername,
      videoDate: video.videoDate,
      platform: video.platform,
      platformVideoId: video.platformVideoId,
      originalUrl: video.originalUrl,
      embedUrl: buildEmbedUrl(video.platform, video.platformVideoId),
      identified: Boolean(video.originalUrl),
    },
  };
}

export function listSummaries(): VideoSummary[] {
  const jobs = repo.latestJobsByVideo();
  return repo.listVideos().map((v) => videoSummary(v, jobs.get(v.id)));
}


export function queueOverview(): QueueOverview {
  const byStatus = queueCounts();
  const sum = (keys: string[]) => keys.reduce((acc, k) => acc + (byStatus[k] ?? 0), 0);
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  return {
    total,
    done: byStatus.done ?? 0,
    queued: byStatus.queued ?? 0,
    error: byStatus.error ?? 0,
    canceled: byStatus.canceled ?? 0,
    active: sum(["extracting_media", "transcribing", "reading_text", "analyzing_scene", "identifying_work", "generating_ctas"]),
    byStatus,
  };
}


export function videoDetail(id: string): VideoDetail | null {
  const video = repo.getVideo(id);
  if (!video) return null;
  const job = repo.latestJob(id) ?? undefined;
  const base = videoSummary(video, job);

  const suggestions = repo.listSuggestions(id);
  const grouped = new Map<CtaStyle, repo.StoredSuggestion[]>();
  for (const s of suggestions) {
    const list = grouped.get(s.style) ?? [];
    list.push(s);
    grouped.set(s.style, list);
  }

  const transcript = repo.getTranscript(id);
  const visual = repo.getVisualAnalysis(id);
  const analysis = repo.latestSceneAnalysis(id);
  const work = repo.getWork(id);

  const limitations = Array.from(
    new Set([...(analysis?.analysisLimitations ?? []), ...(visual?.limitations ?? []), ...(transcript?.warnings ?? [])]),
  );

  return {
    ...base,
    suggestions,
    suggestionsByStyle: Array.from(grouped.entries()).map(([style, items]) => ({ style, items })),
    transcript: transcript
      ? {
          hasSpeech: transcript.hasSpeech,
          language: transcript.language,
          provider: transcript.provider,
          warnings: transcript.warnings,
          segments: transcript.segments,
        }
      : null,
    visibleText: (visual?.visibleText ?? []).map((t) => ({
      text: t.text,
      timestampSeconds: t.timestampSeconds,
      region: t.region,
      type: t.type,
      ocrConfidence: t.ocrConfidence,
    })),
    limitations,
    frames: repo.listFrames(id).map((f) => ({ id: f.id, timestampSeconds: f.timestampSeconds })),
    workDetail: work
      ? {
          title: work.title,
          year: work.year,
          mediaType: work.mediaType,
          confidence: work.confidence,
          evidence: work.evidence,
          sources: work.sources,
          status: work.status,
          manuallyCorrected: Boolean(work.manuallyCorrected),
        }
      : null,
    selection: repo.getSelection(id),
    analysisMeta: analysis
      ? { promptVersion: analysis.promptVersion, model: analysis.model, createdAt: analysis.createdAt }
      : null,
    manualCtaText: visual?.manualCtaText ?? null,
  };
}
