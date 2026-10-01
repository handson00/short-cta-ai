import fs from "node:fs";
import path from "node:path";
import { db, newId, nowIso, parseJson, toBool } from "./db";
import { env } from "./env";
import type {
  Confidence,
  CtaStyle,
  ExistingCtaDetection,
  JobMode,
  JobStatus,
  SceneAnalysis,
  Transcript,
  TranscriptSegment,
  VisibleText,
  VisualAnalysis,
  WorkIdentification,
} from "./types";

// --------------------------------- Videos -----------------------------------

export interface VideoRecord {
  id: string;
  originalName: string;
  storedName: string;
  path: string;
  hash: string;
  bytes: number;
  mime: string | null;
  container: string | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  aspectRatio: string | null;
  hasAudio: boolean;
  thumbnailPath: string | null;
  sourceFolder: string | null;
  tiktokUsername: string | null;
  videoDate: string | null;
  platform: string | null;
  platformVideoId: string | null;
  originalUrl: string | null;
  createdAt: string;
}

interface VideoRow {
  id: string;
  original_name: string;
  stored_name: string;
  path: string;
  hash: string;
  bytes: number;
  mime: string | null;
  container: string | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  aspect_ratio: string | null;
  has_audio: number;
  source_folder: string | null;
  tiktok_username: string | null;
  video_date: string | null;
  platform: string | null;
  platform_video_id: string | null;
  original_url: string | null;
  thumbnail_path: string | null;
  created_at: string;
}

function mapVideo(row: VideoRow): VideoRecord {
  return {
    id: row.id,
    originalName: row.original_name,
    storedName: row.stored_name,
    path: row.path,
    hash: row.hash,
    bytes: row.bytes,
    mime: row.mime,
    container: row.container,
    durationSeconds: row.duration_seconds,
    width: row.width,
    height: row.height,
    aspectRatio: row.aspect_ratio,
    hasAudio: toBool(row.has_audio),
    sourceFolder: row.source_folder,
    tiktokUsername: row.tiktok_username,
    videoDate: row.video_date,
    platform: row.platform,
    platformVideoId: row.platform_video_id,
    originalUrl: row.original_url,
    thumbnailPath: row.thumbnail_path,
    createdAt: row.created_at,
  };
}

export function createVideo(input: {
  originalName: string;
  storedName: string;
  path: string;
  hash: string;
  bytes: number;
  mime: string | null;
  source?: {
    sourceFolder: string | null;
    tiktokUsername: string | null;
    videoDate: string | null;
    platform: string | null;
    platformVideoId: string | null;
    originalUrl: string | null;
  };
}): VideoRecord {
  const id = newId("vid");
  db()
    .prepare(
      `INSERT INTO videos (id, original_name, stored_name, path, hash, bytes, mime, created_at,
        source_folder, tiktok_username, video_date, platform, platform_video_id, original_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id, input.originalName, input.storedName, input.path, input.hash, input.bytes, input.mime, nowIso(),
      input.source?.sourceFolder ?? null,
      input.source?.tiktokUsername ?? null,
      input.source?.videoDate ?? null,
      input.source?.platform ?? null,
      input.source?.platformVideoId ?? null,
      input.source?.originalUrl ?? null,
    );
  return getVideo(id)!;
}

export function updateVideoMedia(
  id: string,
  media: {
    container: string | null;
    durationSeconds: number;
    width: number | null;
    height: number | null;
    aspectRatio: string | null;
    hasAudio: boolean;
    thumbnailPath: string | null;
  },
): void {
  db()
    .prepare(
      `UPDATE videos SET container = ?, duration_seconds = ?, width = ?, height = ?,
       aspect_ratio = ?, has_audio = ?, thumbnail_path = ? WHERE id = ?`,
    )
    .run(
      media.container,
      media.durationSeconds,
      media.width,
      media.height,
      media.aspectRatio,
      media.hasAudio ? 1 : 0,
      media.thumbnailPath,
      id,
    );
}

export function getVideo(id: string): VideoRecord | null {
  const row = db().prepare("SELECT * FROM videos WHERE id = ?").get(id) as VideoRow | undefined;
  return row ? mapVideo(row) : null;
}

export function findVideoByHash(hash: string): VideoRecord | null {
  const row = db().prepare("SELECT * FROM videos WHERE hash = ? ORDER BY created_at DESC LIMIT 1").get(hash) as
    | VideoRow
    | undefined;
  return row ? mapVideo(row) : null;
}

export function listVideos(): VideoRecord[] {
  const rows = db().prepare("SELECT * FROM videos ORDER BY created_at DESC").all() as VideoRow[];
  return rows.map(mapVideo);
}

export function deleteVideo(id: string): void {
  const video = getVideo(id);
  if (!video) return;
  removeFiles(video);
  db().prepare("DELETE FROM videos WHERE id = ?").run(id);
}

function removeFiles(video: VideoRecord): void {
  fs.rmSync(video.path, { force: true });
  if (video.thumbnailPath) fs.rmSync(video.thumbnailPath, { force: true });
  fs.rmSync(path.join(env.artifactsDir, video.id), { recursive: true, force: true });
}

// ---------------------------------- Jobs ------------------------------------

export interface JobRecord {
  id: string;
  videoId: string;
  status: JobStatus;
  stage: string;
  attempts: number;
  maxAttempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  retryable: boolean;
  cancelRequested: boolean;
  reuseScene: boolean;
  mode: JobMode;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

interface JobRow {
  id: string;
  video_id: string;
  status: string;
  stage: string;
  attempts: number;
  max_attempts: number;
  error_code: string | null;
  error_message: string | null;
  retryable: number;
  cancel_requested: number;
  reuse_scene: number;
  mode: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
}

function mapJob(row: JobRow): JobRecord {
  return {
    id: row.id,
    videoId: row.video_id,
    status: row.status as JobStatus,
    stage: row.stage,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    retryable: toBool(row.retryable),
    cancelRequested: toBool(row.cancel_requested),
    reuseScene: toBool(row.reuse_scene),
    mode: row.mode === "local" || row.mode === "ai" ? row.mode : "full",
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
  };
}

export function createJob(
  videoId: string,
  options: { reuseScene?: boolean; mode?: JobMode } = {},
): JobRecord {
  const id = newId("job");
  const now = nowIso();
  db()
    .prepare(
      `INSERT INTO analysis_jobs (id, video_id, status, stage, reuse_scene, mode, created_at, updated_at)
       VALUES (?, ?, 'queued', 'queued', ?, ?, ?, ?)`,
    )
    .run(id, videoId, options.reuseScene ? 1 : 0, options.mode ?? "full", now, now);
  return getJob(id)!;
}

/** Status em que o vídeo já tem análise na fila ou rodando. */
const OPEN_JOB_STATUSES = [
  "queued",
  "extracting_media",
  "transcribing",
  "reading_text",
  "analyzing_scene",
  "identifying_work",
  "generating_ctas",
];

/**
 * "Analisar novamente" para vários vídeos, sem nunca enfileirar em dobro.
 *
 * Um vídeo que já está na fila ou em análise é pulado: dois jobs do mesmo
 * vídeo rodariam ao mesmo tempo sobre os mesmos frames, áudio e transcrição, e
 * o resultado dependeria de quem terminasse por último. Checar e criar numa
 * transação só é o que faz um duplo clique no lote não passar pela checagem.
 */
export function requestReanalysis(ids: string[], mode: JobMode = "full"): {
  queued: string[];
  skipped: { id: string; reason: string }[];
} {
  const database = db();
  const queued: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  // "Existe job aberto?", e não "o último job está aberto?": `latestJob` ordena
  // por created_at, e dois jobs criados no mesmo milissegundo empatam — o teste
  // do duplo clique pegou o empate devolvendo o job antigo e enfileirando de novo.
  const hasOpenJob = database.prepare(
    `SELECT 1 FROM analysis_jobs WHERE video_id = ? AND status IN (${OPEN_JOB_STATUSES.map(() => "?").join(",")}) LIMIT 1`,
  );
  database.transaction(() => {
    for (const id of [...new Set(ids)]) {
      if (!getVideo(id)) {
        skipped.push({ id, reason: "Vídeo não encontrado." });
        continue;
      }
      if (hasOpenJob.get(id, ...OPEN_JOB_STATUSES)) {
        skipped.push({ id, reason: "Já está na fila de análise." });
        continue;
      }
      createJob(id, { reuseScene: false, mode });
      queued.push(id);
    }
  })();
  return { queued, skipped };
}

export function getJob(id: string): JobRecord | null {
  const row = db().prepare("SELECT * FROM analysis_jobs WHERE id = ?").get(id) as JobRow | undefined;
  return row ? mapJob(row) : null;
}

/**
 * O job mais recente do vídeo. Desempate pela ordem de inserção (`rowid`):
 * dois jobs criados no mesmo milissegundo empatam em `created_at`, e o empate
 * devolvia às vezes o ANTIGO — status errado na Fila, modo errado no "Tentar
 * novamente". Os testes pegavam isso de forma intermitente.
 */
export function latestJob(videoId: string): JobRecord | null {
  const row = db()
    .prepare("SELECT * FROM analysis_jobs WHERE video_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(videoId) as JobRow | undefined;
  return row ? mapJob(row) : null;
}

export function latestJobsByVideo(): Map<string, JobRecord> {
  // Mesmo desempate de `latestJob`: com JOIN por MAX(created_at), um empate
  // trazia duas linhas do vídeo e a última lida vencia, qualquer que fosse.
  const rows = db()
    .prepare(
      `SELECT j.* FROM analysis_jobs j
       WHERE j.rowid = (SELECT j2.rowid FROM analysis_jobs j2 WHERE j2.video_id = j.video_id
                        ORDER BY j2.created_at DESC, j2.rowid DESC LIMIT 1)`,
    )
    .all() as JobRow[];
  const map = new Map<string, JobRecord>();
  for (const row of rows) map.set(row.video_id, mapJob(row));
  return map;
}

export function setJobStatus(
  id: string,
  status: JobStatus,
  patch: { errorCode?: string | null; errorMessage?: string | null; retryable?: boolean } = {},
): void {
  const finished = ["done", "error", "canceled", "awaiting_ai"].includes(status);
  db()
    .prepare(
      `UPDATE analysis_jobs SET status = ?, stage = ?, error_code = ?, error_message = ?,
        retryable = ?, updated_at = ?, finished_at = CASE WHEN ? = 1 THEN ? ELSE finished_at END
       WHERE id = ?`,
    )
    .run(
      status,
      status,
      patch.errorCode ?? null,
      patch.errorMessage ? patch.errorMessage.slice(0, 500) : null,
      patch.retryable === false ? 0 : 1,
      nowIso(),
      finished ? 1 : 0,
      nowIso(),
      id,
    );
}

export function requestCancel(videoId: string): boolean {
  const job = latestJob(videoId);
  if (!job) return false;
  if (job.status === "queued") {
    setJobStatus(job.id, "canceled");
    releaseLease(job.id);
    return true;
  }
  if (["done", "error", "canceled", "awaiting_ai"].includes(job.status)) return false;
  db().prepare("UPDATE analysis_jobs SET cancel_requested = 1, updated_at = ? WHERE id = ?").run(nowIso(), job.id);
  return true;
}

export function isCancelRequested(jobId: string): boolean {
  const row = db().prepare("SELECT cancel_requested FROM analysis_jobs WHERE id = ?").get(jobId) as
    | { cancel_requested: number }
    | undefined;
  return toBool(row?.cancel_requested);
}

export function releaseLease(jobId: string): void {
  db().prepare("UPDATE analysis_jobs SET lease_owner = NULL, lease_expires_at = NULL WHERE id = ?").run(jobId);
}

// -------------------------------- Frames ------------------------------------

export function replaceFrames(videoId: string, frames: { path: string; timestampSeconds: number; phash: string }[]): void {
  const database = db();
  const tx = database.transaction(() => {
    database.prepare("DELETE FROM frames WHERE video_id = ?").run(videoId);
    const insert = database.prepare(
      "INSERT INTO frames (id, video_id, path, timestamp_seconds, phash, kept, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)",
    );
    for (const frame of frames) {
      insert.run(newId("frm"), videoId, frame.path, frame.timestampSeconds, frame.phash, nowIso());
    }
  });
  tx();
}

export function listFrames(videoId: string): { id: string; path: string; timestampSeconds: number }[] {
  const rows = db()
    .prepare("SELECT id, path, timestamp_seconds FROM frames WHERE video_id = ? ORDER BY timestamp_seconds")
    .all(videoId) as { id: string; path: string; timestamp_seconds: number }[];
  return rows.map((r: any) => ({ id: r.id, path: r.path, timestampSeconds: r.timestamp_seconds }));
}

// ------------------------------ Transcricao ---------------------------------

export function saveTranscript(videoId: string, transcript: Transcript): void {
  db()
    .prepare(
      `INSERT INTO transcripts (id, video_id, provider, language, text, segments_json, has_speech, low_confidence, warnings_json, created_at)
       VALUES (@id, @videoId, @provider, @language, @text, @segments, @hasSpeech, @lowConfidence, @warnings, @createdAt)
       ON CONFLICT(video_id) DO UPDATE SET provider = excluded.provider, language = excluded.language,
         text = excluded.text, segments_json = excluded.segments_json, has_speech = excluded.has_speech,
         low_confidence = excluded.low_confidence, warnings_json = excluded.warnings_json, created_at = excluded.created_at`,
    )
    .run({
      id: newId("trs"),
      videoId,
      provider: transcript.provider,
      language: transcript.language,
      text: transcript.text,
      segments: JSON.stringify(transcript.segments),
      hasSpeech: transcript.hasSpeech ? 1 : 0,
      lowConfidence: transcript.lowConfidence ? 1 : 0,
      warnings: JSON.stringify(transcript.warnings),
      createdAt: nowIso(),
    });
}

export function getTranscript(videoId: string): Transcript | null {
  const row = db().prepare("SELECT * FROM transcripts WHERE video_id = ?").get(videoId) as
    | {
        provider: string;
        language: string | null;
        text: string;
        segments_json: string;
        has_speech: number;
        low_confidence: number;
        warnings_json: string;
      }
    | undefined;
  if (!row) return null;
  return {
    provider: row.provider,
    language: row.language,
    text: row.text,
    segments: parseJson<TranscriptSegment[]>(row.segments_json, []),
    hasSpeech: toBool(row.has_speech),
    lowConfidence: toBool(row.low_confidence),
    warnings: parseJson<string[]>(row.warnings_json, []),
  };
}

// ------------------------------ Analise visual ------------------------------

export function saveVisualAnalysis(videoId: string, analysis: VisualAnalysis): void {
  db()
    .prepare(
      `INSERT INTO visual_analyses (id, video_id, provider, visible_text_json, scene_description, visual_clues_json,
         existing_cta_text, existing_cta_confidence, existing_cta_first_seen, existing_cta_reasons_json,
         limitations_json, created_at)
       VALUES (@id, @videoId, @provider, @visibleText, @sceneDescription, @clues, @ctaText, @ctaConfidence,
               @ctaFirstSeen, @ctaReasons, @limitations, @createdAt)
       ON CONFLICT(video_id) DO UPDATE SET provider = excluded.provider, visible_text_json = excluded.visible_text_json,
         scene_description = excluded.scene_description, visual_clues_json = excluded.visual_clues_json,
         existing_cta_text = excluded.existing_cta_text, existing_cta_confidence = excluded.existing_cta_confidence,
         existing_cta_first_seen = excluded.existing_cta_first_seen, existing_cta_reasons_json = excluded.existing_cta_reasons_json,
         limitations_json = excluded.limitations_json, created_at = excluded.created_at`,
    )
    .run({
      id: newId("vis"),
      videoId,
      provider: analysis.provider,
      visibleText: JSON.stringify(analysis.visibleText),
      sceneDescription: analysis.sceneDescription,
      clues: JSON.stringify(analysis.visualClues),
      ctaText: analysis.existingCta?.text ?? null,
      ctaConfidence: analysis.existingCta?.confidence ?? null,
      ctaFirstSeen: analysis.existingCta?.firstSeenAtSeconds ?? null,
      ctaReasons: JSON.stringify(analysis.existingCta?.reasons ?? []),
      limitations: JSON.stringify(analysis.limitations),
      createdAt: nowIso(),
    });
}

export interface StoredVisualAnalysis extends VisualAnalysis {
  manualCtaText: string | null;
}

export function getVisualAnalysis(videoId: string): StoredVisualAnalysis | null {
  const row = db().prepare("SELECT * FROM visual_analyses WHERE video_id = ?").get(videoId) as
    | {
        provider: string;
        visible_text_json: string;
        scene_description: string | null;
        visual_clues_json: string;
        existing_cta_text: string | null;
        existing_cta_confidence: string | null;
        existing_cta_first_seen: number | null;
        existing_cta_reasons_json: string;
        manual_cta_text: string | null;
        limitations_json: string;
      }
    | undefined;
  if (!row) return null;

  const existingCta: ExistingCtaDetection | null = row.existing_cta_text
    ? {
        text: row.existing_cta_text,
        confidence: (row.existing_cta_confidence as Confidence) ?? "low",
        firstSeenAtSeconds: row.existing_cta_first_seen ?? 0,
        reasons: parseJson<string[]>(row.existing_cta_reasons_json, []),
      }
    : null;

  return {
    provider: row.provider,
    visibleText: parseJson<VisibleText[]>(row.visible_text_json, []),
    sceneDescription: row.scene_description,
    visualClues: parseJson<string[]>(row.visual_clues_json, []),
    existingCta,
    limitations: parseJson<string[]>(row.limitations_json, []),
    manualCtaText: row.manual_cta_text,
  };
}

/** Correcao manual da leitura do OCR. */
export function setManualCta(videoId: string, text: string | null): void {
  db()
    .prepare("UPDATE visual_analyses SET manual_cta_text = ? WHERE video_id = ?")
    .run(text && text.trim() ? text.trim() : null, videoId);
}

/** O CTA que a aplicacao considera existente: correcao manual tem precedencia. */
export function effectiveExistingCta(visual: StoredVisualAnalysis | null): ExistingCtaDetection | null {
  if (!visual) return null;
  if (visual.manualCtaText) {
    return {
      text: visual.manualCtaText,
      confidence: "high",
      firstSeenAtSeconds: visual.existingCta?.firstSeenAtSeconds ?? 0,
      reasons: ["Corrigido manualmente pelo usuário."],
    };
  }
  return visual.existingCta;
}

// ------------------------------ Identificacao -------------------------------

export function saveWork(videoId: string, work: WorkIdentification, manuallyCorrected = false): void {
  db()
    .prepare(
      `INSERT INTO work_identifications (id, video_id, title, original_title, year, media_type, confidence,
         evidence_json, sources_json, status, manually_corrected, created_at)
       VALUES (@id, @videoId, @title, @originalTitle, @year, @mediaType, @confidence, @evidence, @sources, @status, @manual, @createdAt)
       ON CONFLICT(video_id) DO UPDATE SET title = excluded.title, original_title = excluded.original_title,
         year = excluded.year, media_type = excluded.media_type, confidence = excluded.confidence,
         evidence_json = excluded.evidence_json, sources_json = excluded.sources_json, status = excluded.status,
         manually_corrected = excluded.manually_corrected, created_at = excluded.created_at`,
    )
    .run({
      id: newId("wrk"),
      videoId,
      title: work.title,
      originalTitle: work.originalTitle,
      year: work.year,
      mediaType: work.mediaType,
      confidence: work.confidence,
      evidence: JSON.stringify(work.evidence),
      sources: JSON.stringify(work.sources),
      status: work.status,
      manual: manuallyCorrected ? 1 : 0,
      createdAt: nowIso(),
    });
}

export function getWork(videoId: string): WorkIdentification | null {
  const row = db().prepare("SELECT * FROM work_identifications WHERE video_id = ?").get(videoId) as
    | {
        title: string | null;
        original_title: string | null;
        year: number | null;
        media_type: string | null;
        confidence: string;
        evidence_json: string;
        sources_json: string;
        status: string;
        manually_corrected: number;
      }
    | undefined;
  if (!row) return null;
  return {
    title: row.title,
    originalTitle: row.original_title,
    year: row.year,
    mediaType: (row.media_type as "movie" | "series" | null) ?? null,
    confidence: row.confidence as Confidence,
    evidence: parseJson<string[]>(row.evidence_json, []),
    sources: parseJson<string[]>(row.sources_json, []),
    status: row.status === "identified" ? "identified" : "not_identified_safely",
    manuallyCorrected: toBool(row.manually_corrected),
  };
}

// ------------------------------ Analise da cena -----------------------------

export interface StoredSceneAnalysis extends SceneAnalysis {
  id: string;
  promptVersion: string;
  model: string | null;
  createdAt: string;
  recommended: { text: string; reason: string } | null;
  /** Impressão digital do que a análise enviou à IA (ver `pipeline/aiCache.ts`). */
  inputHash: string | null;
  /** Idem, da última geração de CTAs feita sobre esta análise. */
  ctasInputHash: string | null;
}

export function saveSceneAnalysis(
  videoId: string,
  analysis: SceneAnalysis,
  meta: {
    promptVersion: string;
    model: string;
    recommended?: { text: string; reason: string } | null;
    inputHash?: string | null;
  },
): string {
  const id = newId("scn");
  db()
    .prepare(
      `INSERT INTO scene_analyses (id, video_id, summary, limitations_json, conflict, curiosity, withhold,
         speculation_json, existing_cta_strength, existing_cta_improvement, recommended_text, recommended_reason,
         raw_json, prompt_version, model, input_hash, created_at)
       VALUES (@id, @videoId, @summary, @limitations, @conflict, @curiosity, @withhold, @speculation,
               @strength, @improvement, @recommendedText, @recommendedReason, @raw, @promptVersion, @model,
               @inputHash, @createdAt)`,
    )
    .run({
      id,
      videoId,
      summary: analysis.sceneSummary,
      limitations: JSON.stringify(analysis.analysisLimitations),
      conflict: analysis.conflict,
      curiosity: analysis.curiosity,
      withhold: analysis.withhold,
      speculation: JSON.stringify(analysis.speculation),
      strength: analysis.existingCta?.strength ?? null,
      improvement: analysis.existingCta?.possibleImprovement ?? null,
      recommendedText: meta.recommended?.text ?? null,
      recommendedReason: meta.recommended?.reason ?? null,
      raw: JSON.stringify({ ...analysis, context: undefined }),
      promptVersion: meta.promptVersion,
      model: meta.model,
      inputHash: meta.inputHash ?? null,
      createdAt: nowIso(),
    });
  return id;
}

/** Marca a impressão digital da geração de CTAs feita sobre esta análise. */
export function setCtasInputHash(analysisId: string, hash: string): void {
  db().prepare("UPDATE scene_analyses SET ctas_input_hash = ? WHERE id = ?").run(hash, analysisId);
}

export function updateSceneRecommendation(analysisId: string, recommended: { text: string; reason: string }): void {
  db()
    .prepare("UPDATE scene_analyses SET recommended_text = ?, recommended_reason = ? WHERE id = ?")
    .run(recommended.text, recommended.reason, analysisId);
}

export function latestSceneAnalysis(videoId: string): StoredSceneAnalysis | null {
  const row = db()
    .prepare("SELECT * FROM scene_analyses WHERE video_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(videoId) as
    | {
        id: string;
        summary: string;
        limitations_json: string;
        conflict: string | null;
        curiosity: string | null;
        withhold: string | null;
        speculation_json: string;
        existing_cta_strength: string | null;
        existing_cta_improvement: string | null;
        recommended_text: string | null;
        recommended_reason: string | null;
        raw_json: string;
        prompt_version: string;
        model: string | null;
        input_hash: string | null;
        ctas_input_hash: string | null;
        created_at: string;
      }
    | undefined;
  if (!row) return null;

  const raw = parseJson<SceneAnalysis>(row.raw_json, {
    sceneSummary: row.summary,
    plot: null,
    keyLines: [],
    analysisLimitations: [],
    conflict: row.conflict,
    curiosity: row.curiosity,
    withhold: row.withhold,
    speculation: [],
    existingCta: null,
    work: null,
  });

  return {
    ...raw,
    sceneSummary: row.summary,
    // Análises anteriores ao enredo pela fala (prompt 2026-09-29) não têm estes
    // campos no raw_json; sem enredo é nulo, não string vazia.
    plot: raw.plot ?? null,
    keyLines: Array.isArray(raw.keyLines) ? raw.keyLines : [],
    evidenceBasis: raw.evidenceBasis,
    analysisLimitations: parseJson<string[]>(row.limitations_json, []),
    conflict: row.conflict,
    curiosity: row.curiosity,
    withhold: row.withhold,
    speculation: parseJson<string[]>(row.speculation_json, []),
    id: row.id,
    promptVersion: row.prompt_version,
    model: row.model,
    createdAt: row.created_at,
    recommended: row.recommended_text ? { text: row.recommended_text, reason: row.recommended_reason ?? "" } : null,
    inputHash: row.input_hash ?? null,
    ctasInputHash: row.ctas_input_hash ?? null,
  };
}

// -------------------------------- Sugestoes ---------------------------------

export interface StoredSuggestion {
  id: string;
  text: string;
  style: CtaStyle;
  reason: string | null;
  isRecommended: boolean;
  origin: "generated" | "original" | "manual";
  position: number;
}

export function replaceSuggestions(
  videoId: string,
  analysisId: string,
  items: { text: string; style: CtaStyle; reason?: string | null; isRecommended?: boolean; origin?: StoredSuggestion["origin"] }[],
): void {
  const database = db();
  const tx = database.transaction(() => {
    database.prepare("UPDATE user_selections SET chosen_cta_id = NULL WHERE video_id = ?").run(videoId);
    database.prepare("DELETE FROM cta_suggestions WHERE video_id = ?").run(videoId);
    const insert = database.prepare(
      `INSERT INTO cta_suggestions (id, video_id, analysis_id, text, style, reason, is_recommended, origin, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    items.forEach((item, index) => {
      insert.run(
        newId("cta"),
        videoId,
        analysisId,
        item.text,
        item.style,
        item.reason ?? null,
        item.isRecommended ? 1 : 0,
        item.origin ?? "generated",
        index,
        nowIso(),
      );
    });
  });
  tx();
}

export function listSuggestions(videoId: string): StoredSuggestion[] {
  const rows = db()
    .prepare("SELECT * FROM cta_suggestions WHERE video_id = ? ORDER BY position")
    .all(videoId) as {
    id: string;
    text: string;
    style: string;
    reason: string | null;
    is_recommended: number;
    origin: string;
    position: number;
  }[];
  return rows.map((r: any) => ({
    id: r.id,
    text: r.text,
    style: r.style as CtaStyle,
    reason: r.reason,
    isRecommended: toBool(r.is_recommended),
    origin: r.origin as StoredSuggestion["origin"],
    position: r.position,
  }));
}

// -------------------------------- Selecao -----------------------------------

export interface Selection {
  chosenCtaId: string | null;
  editedText: string | null;
  favorite: boolean;
  updatedAt: string | null;
}

export function getSelection(videoId: string): Selection {
  const row = db().prepare("SELECT * FROM user_selections WHERE video_id = ?").get(videoId) as
    | { chosen_cta_id: string | null; edited_text: string | null; favorite: number; updated_at: string }
    | undefined;
  if (!row) return { chosenCtaId: null, editedText: null, favorite: false, updatedAt: null };
  return {
    chosenCtaId: row.chosen_cta_id,
    editedText: row.edited_text,
    favorite: toBool(row.favorite),
    updatedAt: row.updated_at,
  };
}

export function updateSelection(videoId: string, patch: Partial<Selection>): Selection {
  const current = getSelection(videoId);
  const next: Selection = {
    chosenCtaId: patch.chosenCtaId !== undefined ? patch.chosenCtaId : current.chosenCtaId,
    editedText: patch.editedText !== undefined ? patch.editedText : current.editedText,
    favorite: patch.favorite !== undefined ? patch.favorite : current.favorite,
    updatedAt: nowIso(),
  };
  const now = nowIso();
  db()
    .prepare(
      `INSERT INTO user_selections (video_id, chosen_cta_id, edited_text, favorite, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(video_id) DO UPDATE SET chosen_cta_id = excluded.chosen_cta_id,
         edited_text = excluded.edited_text, favorite = excluded.favorite, updated_at = excluded.updated_at`,
    )
    .run(videoId, next.chosenCtaId, next.editedText, next.favorite ? 1 : 0, now, now);
  return next;
}

// ------------------------------ Meu estilo ----------------------------------

export interface StyleExample {
  id: string;
  text: string;
  note: string | null;
  createdAt: string;
}

export function listStyleExamples(): StyleExample[] {
  const rows = db().prepare("SELECT * FROM style_examples ORDER BY created_at DESC").all() as {
    id: string;
    text: string;
    note: string | null;
    created_at: string;
  }[];
  return rows.map((r: any) => ({ id: r.id, text: r.text, note: r.note, createdAt: r.created_at }));
}

/** Limite deliberado: o contexto e curadoria, nao um deposito. */
export const MAX_STYLE_EXAMPLES = 20;

export function addStyleExample(text: string, note?: string | null): StyleExample[] {
  const trimmed = text.trim().slice(0, 200);
  if (!trimmed) return listStyleExamples();
  const existing = listStyleExamples();
  if (existing.some((e: any) => e.text === trimmed)) return existing;
  db()
    .prepare("INSERT INTO style_examples (id, text, note, created_at) VALUES (?, ?, ?, ?)")
    .run(newId("sty"), trimmed, note?.slice(0, 200) ?? null, nowIso());
  const all = listStyleExamples();
  for (const extra of all.slice(MAX_STYLE_EXAMPLES)) {
    db().prepare("DELETE FROM style_examples WHERE id = ?").run(extra.id);
  }
  return listStyleExamples();
}

export function removeStyleExample(id: string): void {
  db().prepare("DELETE FROM style_examples WHERE id = ?").run(id);
}

// -------------------------------- Retencao ----------------------------------

export interface RetentionReport {
  videosPurged: number;
  transcriptsPurged: number;
  resultsPurged: number;
}

export function applyRetention(policy: { videoDays: number; transcriptDays: number; resultDays: number }): RetentionReport {
  const report: RetentionReport = { videosPurged: 0, transcriptsPurged: 0, resultsPurged: 0 };
  const cutoff = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

  if (policy.transcriptDays > 0) {
    const info = db().prepare("DELETE FROM transcripts WHERE created_at < ?").run(cutoff(policy.transcriptDays));
    report.transcriptsPurged = info.changes;
  }
  if (policy.videoDays > 0) {
    const rows = db().prepare("SELECT * FROM videos WHERE created_at < ?").all(cutoff(policy.videoDays)) as VideoRow[];
    for (const row of rows) {
      removeFiles(mapVideo(row));
      db().prepare("UPDATE videos SET purged_at = ? WHERE id = ?").run(nowIso(), row.id);
      report.videosPurged += 1;
    }
  }
  if (policy.resultDays > 0) {
    const info = db().prepare("DELETE FROM scene_analyses WHERE created_at < ?").run(cutoff(policy.resultDays));
    report.resultsPurged = info.changes;
  }
  return report;
}


// --------------------------- Captura da origem ------------------------------

/**
 * Comentario do post de origem, coletado pela extensao (ver HANDOFF, §10).
 *
 * ATENCAO: `author` e `text` sao conteudo de terceiros vindo da internet. Se um
 * dia alimentarem o modelo, precisam ir delimitados como dado, igual ao OCR e a
 * transcricao - um comentario pode dizer "ignore as instrucoes anteriores".
 */
export interface PostComment {
  id: string;
  externalId: string | null;
  parentExternalId: string | null;
  author: string | null;
  text: string;
  likeCount: number | null;
  publishedLabel: string | null;
  position: number;
}

export interface CommentInput {
  externalId?: string | null;
  parentExternalId?: string | null;
  author?: string | null;
  text: string;
  likeCount?: number | null;
  publishedLabel?: string | null;
}

/**
 * Substitui os comentarios do video pelos recem-capturados.
 *
 * Substituir, e nao acumular: o pedido e "os 20 ultimos comentarios", entao uma
 * nova captura representa o estado atual do post. Acumular produziria uma
 * mistura de leituras de datas diferentes sem como distinguir uma da outra.
 */
export function replaceComments(
  videoId: string,
  platform: string,
  comments: CommentInput[],
  opts: { append?: boolean } = {},
): number {
  const agora = nowIso();
  const apagar = db().prepare("DELETE FROM post_comments WHERE video_id = ?");
  // `append`: continuação da MESMA captura, mandada em pedaços. Sem isto, cada
  // pedaço apagava o anterior e um vídeo com mais de 200 comentários ficava só
  // com os do último pedaço.
  const inicio = opts.append
    ? (((db().prepare("SELECT MAX(position) AS p FROM post_comments WHERE video_id = ?").get(videoId) as
        | { p: number | null }
        | undefined)?.p ?? -1) + 1)
    : 0;
  const inserir = db().prepare(
    `INSERT INTO post_comments
       (id, video_id, platform, external_id, parent_external_id, author, text, like_count, published_label, position, captured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const tx = db().transaction((items: CommentInput[]) => {
    if (!opts.append) apagar.run(videoId);
    let n = 0;
    for (const [i, c] of items.entries()) {
      const texto = (c.text ?? "").trim();
      if (!texto) continue;
      inserir.run(
        newId("cmt"),
        videoId,
        platform,
        c.externalId ?? null,
        c.parentExternalId ?? null,
        c.author ?? null,
        texto,
        typeof c.likeCount === "number" ? c.likeCount : null,
        c.publishedLabel ?? null,
        inicio + i,
        agora,
      );
      n += 1;
    }
    return n;
  });

  return tx(comments) as number;
}

export function getComments(videoId: string): PostComment[] {
  const rows = db()
    .prepare("SELECT * FROM post_comments WHERE video_id = ? ORDER BY position")
    .all(videoId) as Array<{
      id: string;
      external_id: string | null;
      parent_external_id: string | null;
      author: string | null;
      text: string;
      like_count: number | null;
      published_label: string | null;
      position: number;
    }>;

  return rows.map((r: any) => ({
    id: r.id,
    externalId: r.external_id,
    parentExternalId: r.parent_external_id,
    author: r.author,
    text: r.text,
    likeCount: r.like_count,
    publishedLabel: r.published_label,
    position: r.position,
  }));
}

export function getCommentsCapturedAt(videoId: string): string | null {
  const row = db()
    .prepare("SELECT captured_at FROM post_comments WHERE video_id = ? LIMIT 1")
    .get(videoId) as { captured_at: string } | undefined;
  return row?.captured_at ?? null;
}

/**
 * Salva as hashtags capturadas pela extensão para uso na geração de CTAs virais.
 * Substitui quaisquer hashtags anteriores do mesmo vídeo (mesma lógica dos comentários).
 */
export function saveVideoHashtags(
  videoId: string,
  hashtags: { doVideo?: string[]; nosComentarios?: Array<{ tag: string; vezes: number }>; todas?: string[] },
): void {
  const agora = nowIso();

  // A extensão manda os comentários em pedaços e só o primeiro traz as
  // hashtags; os seguintes vêm com as listas vazias. Gravar o vazio apagava as
  // hashtags do primeiro pedaço. Vazio aqui não é "o vídeo não tem hashtag":
  // é "este pedido não traz hashtag".
  const vazio =
    !(hashtags.doVideo?.length) && !(hashtags.nosComentarios?.length) && !(hashtags.todas?.length);
  if (vazio) return;

  const upsert = db().prepare(
    `INSERT INTO video_hashtags (video_id, do_video_json, nos_comentarios_json, todas_json, captured_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(video_id) DO UPDATE SET
       do_video_json = excluded.do_video_json,
       nos_comentarios_json = excluded.nos_comentarios_json,
       todas_json = excluded.todas_json,
       captured_at = excluded.captured_at`,
  );

  upsert.run(
    videoId,
    JSON.stringify(hashtags.doVideo ?? []),
    JSON.stringify(hashtags.nosComentarios ?? []),
    JSON.stringify(hashtags.todas ?? []),
    agora,
  );
}

/**
 * Hashtags sugeridas pela IA para o vídeo, com o motivo de cada uma.
 *
 * Ficam numa coluna à parte das capturadas: uma coisa é o que o post de origem
 * usou, outra é o que a IA sugeriu. Misturar as duas faria a tela apresentar
 * sugestão como fato observado.
 */
export function saveAiHashtags(videoId: string, tags: Array<{ tag: string; reason: string | null }>): void {
  db()
    .prepare(
      `INSERT INTO video_hashtags (video_id, do_video_json, nos_comentarios_json, todas_json, ia_json, captured_at)
       VALUES (?, '[]', '[]', '[]', ?, ?)
       ON CONFLICT(video_id) DO UPDATE SET ia_json = excluded.ia_json`,
    )
    .run(videoId, JSON.stringify(tags), nowIso());
}

/** Legenda em japonês do vídeo, com a hashtag que a abriu. */
export function saveJapaneseCaption(videoId: string, text: string, hashtag: string): void {
  db()
    .prepare(
      `INSERT INTO video_jp_captions (video_id, text, hashtag, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(video_id) DO UPDATE SET text = excluded.text, hashtag = excluded.hashtag,
         updated_at = excluded.updated_at`,
    )
    .run(videoId, text, hashtag, nowIso());
}

export function getJapaneseCaption(videoId: string): { text: string; hashtag: string } | null {
  const row = db().prepare("SELECT text, hashtag FROM video_jp_captions WHERE video_id = ?").get(videoId) as
    | { text: string; hashtag: string }
    | undefined;
  return row ?? null;
}

export function getVideoHashtags(videoId: string): {
  doVideo: string[];
  nosComentarios: Array<{ tag: string; vezes: number }>;
  todas: string[];
  ia: Array<{ tag: string; reason: string | null }>;
} | null {
  const row = db()
    .prepare("SELECT do_video_json, nos_comentarios_json, todas_json, ia_json FROM video_hashtags WHERE video_id = ?")
    .get(videoId) as
    | { do_video_json: string; nos_comentarios_json: string; todas_json: string; ia_json: string }
    | undefined;

  if (!row) return null;

  const parseJson = <T>(s: string, fallback: T): T => {
    try { return JSON.parse(s) as T; } catch { return fallback; }
  };

  return {
    doVideo: parseJson<string[]>(row.do_video_json, []),
    nosComentarios: parseJson<Array<{ tag: string; vezes: number }>>(row.nos_comentarios_json, []),
    todas: parseJson<string[]>(row.todas_json, []),
    ia: parseJson<Array<{ tag: string; reason: string | null }>>(row.ia_json, []),
  };
}

/** Acha o video pelo codigo do post, do jeito que a extensao conhece o video. */
export function findVideoByPlatformId(platform: string, platformVideoId: string): { id: string } | null {
  const row = db()
    .prepare("SELECT id FROM videos WHERE platform = ? AND platform_video_id = ? AND purged_at IS NULL LIMIT 1")
    .get(platform, platformVideoId) as { id: string } | undefined;
  return row ?? null;
}

/**
 * Grava os ganchos vindos dos comentarios SEM tocar nos de cena.
 *
 * `saveSuggestions` apaga tudo do video antes de inserir, porque uma nova
 * analise substitui a anterior. Aqui e diferente: os dois conjuntos coexistem
 * na tela, vem de evidencias diferentes e o usuario compara um com o outro.
 * Entao so os de origem "comments" sao substituidos.
 */
export function replaceCommentSuggestions(
  videoId: string,
  items: { text: string; style: string; reason: string | null }[],
): void {
  const database = db();
  const tx = database.transaction(() => {
    // Se o escolhido era um gancho de comentario, a escolha some junto - deixar
    // apontando para uma linha apagada quebraria a selecao do usuario.
    database
      .prepare(
        `UPDATE user_selections SET chosen_cta_id = NULL
         WHERE video_id = ? AND chosen_cta_id IN
           (SELECT id FROM cta_suggestions WHERE video_id = ? AND origin = 'comments')`,
      )
      .run(videoId, videoId);
    database.prepare("DELETE FROM cta_suggestions WHERE video_id = ? AND origin = 'comments'").run(videoId);

    const base = (database.prepare("SELECT MAX(position) AS p FROM cta_suggestions WHERE video_id = ?").get(videoId) as
      | { p: number | null }
      | undefined)?.p ?? -1;

    const insert = database.prepare(
      `INSERT INTO cta_suggestions (id, video_id, analysis_id, text, style, reason, is_recommended, origin, position, created_at)
       VALUES (?, ?, NULL, ?, ?, ?, 0, 'comments', ?, ?)`,
    );
    items.forEach((item, i) => {
      insert.run(newId("cta"), videoId, item.text, item.style, item.reason, base + 1 + i, nowIso());
    });
  });
  tx();
}

export interface PublishKit {
  description: string;
  hashtags: string[];
  sendTrigger: string | null;
  titleStrategy: string | null;
  audienceRead: string | null;
  createdAt: string;
}

export function savePublishKit(videoId: string, kit: Omit<PublishKit, "createdAt">): void {
  db()
    .prepare(
      `INSERT INTO publish_kits (video_id, description, hashtags_json, send_trigger, title_strategy, audience_read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(video_id) DO UPDATE SET description = excluded.description,
         hashtags_json = excluded.hashtags_json, send_trigger = excluded.send_trigger,
         title_strategy = excluded.title_strategy, audience_read = excluded.audience_read,
         created_at = excluded.created_at`,
    )
    .run(
      videoId,
      kit.description,
      JSON.stringify(kit.hashtags),
      kit.sendTrigger,
      kit.titleStrategy,
      kit.audienceRead,
      nowIso(),
    );
}

export function getPublishKit(videoId: string): PublishKit | null {
  const row = db().prepare("SELECT * FROM publish_kits WHERE video_id = ?").get(videoId) as
    | {
        description: string;
        hashtags_json: string;
        send_trigger: string | null;
        title_strategy: string | null;
        audience_read: string | null;
        created_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    description: row.description,
    hashtags: parseJson<string[]>(row.hashtags_json, []),
    sendTrigger: row.send_trigger,
    titleStrategy: row.title_strategy,
    audienceRead: row.audience_read,
    createdAt: row.created_at,
  };
}

export interface SourceCapture {
  platform: string;
  authorName: string | null;
  authorUrl: string | null;
  title: string | null;
  thumbnailUrl: string | null;
  capturedAt: string;
}

export function saveSourceCapture(
  videoId: string,
  data: { platform: string; authorName: string | null; authorUrl: string | null; title: string | null; thumbnailUrl: string | null; raw: unknown },
): void {
  db()
    .prepare(
      `INSERT INTO source_captures (video_id, platform, author_name, author_url, title, thumbnail_url, raw_json, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(video_id) DO UPDATE SET platform = excluded.platform, author_name = excluded.author_name,
         author_url = excluded.author_url, title = excluded.title, thumbnail_url = excluded.thumbnail_url,
         raw_json = excluded.raw_json, captured_at = excluded.captured_at`,
    )
    .run(videoId, data.platform, data.authorName, data.authorUrl, data.title, data.thumbnailUrl, JSON.stringify(data.raw ?? {}), nowIso());
}

export function getSourceCapture(videoId: string): SourceCapture | null {
  const row = db().prepare("SELECT * FROM source_captures WHERE video_id = ?").get(videoId) as
    | { platform: string; author_name: string | null; author_url: string | null; title: string | null; thumbnail_url: string | null; captured_at: string }
    | undefined;
  if (!row) return null;
  return {
    platform: row.platform,
    authorName: row.author_name,
    authorUrl: row.author_url,
    title: row.title,
    thumbnailUrl: row.thumbnail_url,
    capturedAt: row.captured_at,
  };
}

// ------------------------- Fila de Captura em Lote --------------------------

export interface CaptureQueueItem {
  id: string;
  videoId: string;
  url: string;
  status: "pending" | "processing" | "done" | "error";
  attempts: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/**
 * Adiciona vídeos à fila de captura e devolve quantos entraram de fato.
 *
 * Vídeo que já tem pedido aberto é ignorado: o índice único
 * `idx_capture_queue_one_open` (criado em db.ts) é o que faz o `OR IGNORE`
 * funcionar. Sem ele, cada clique enfileirava o vídeo de novo.
 */
export function addToCaptureQueue(items: Array<{ videoId: string; url: string }>): number {
  const agora = nowIso();
  let added = 0;
  const insert = db().prepare(
    `INSERT OR IGNORE INTO capture_queue (id, video_id, url, status, attempts, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', 0, ?, ?)`,
  );
  const tx = db().transaction(() => {
    for (const item of items) {
      const result = insert.run(newId("cq"), item.videoId, item.url, agora, agora);
      if (result.changes > 0) added++;
    }
  });
  tx();
  return added;
}

/** Retorna os próximos itens pendentes para a extensão processar. */
export function getPendingCaptures(limit: number = 5): CaptureQueueItem[] {
  const rows = db()
    .prepare(
      `SELECT id, video_id, url, status, attempts, created_at, updated_at, completed_at
       FROM capture_queue
       WHERE status = 'pending'
       ORDER BY created_at ASC
       LIMIT ?`,
    )
    .all(limit) as Array<{
    id: string;
    video_id: string;
    url: string;
    status: string;
    attempts: number;
    created_at: string;
    updated_at: string;
    completed_at: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    videoId: r.video_id,
    url: r.url,
    status: r.status as CaptureQueueItem["status"],
    attempts: r.attempts,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
  }));
}

/** Marca um item da fila como concluído. */
export function completeCaptureQueueItem(id: string): void {
  const agora = nowIso();
  db()
    .prepare(`UPDATE capture_queue SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ?`)
    .run(agora, agora, id);
}

/** Marca um item da fila como erro (incrementa tentativas). */
export function failCaptureQueueItem(id: string): void {
  const agora = nowIso();
  db()
    .prepare(
      `UPDATE capture_queue SET status = CASE WHEN attempts + 1 >= 3 THEN 'error' ELSE 'pending' END,
        attempts = attempts + 1, updated_at = ? WHERE id = ?`,
    )
    .run(agora, id);
}

/** Retorna resumo da fila para exibição na UI. */
export function captureQueueSummary(): { pending: number; processing: number; done: number; error: number } {
  const rows = db()
    .prepare(`SELECT status, COUNT(*) as n FROM capture_queue GROUP BY status`)
    .all() as Array<{ status: string; n: number }>;
  const summary = { pending: 0, processing: 0, done: 0, error: 0 };
  for (const r of rows) {
    if (r.status in summary) summary[r.status as keyof typeof summary] = r.n;
  }
  return summary;
}
