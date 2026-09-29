import { db, newId, nowIso, parseJson, toBool } from "./db";
import type {
  EditorCrop,
  EditorJob,
  EditorJobStatus,
  EditorTemplate,
  EditorTemplateConfig,
  EditorAudioSettings,
  EditorExportSettings,
  SourceProfile,
} from "./types";

// =============================== TEMPLATES ==================================

interface TemplateRow {
  id: string;
  name: string;
  config_json: string;
  created_at: string;
  updated_at: string;
}

function mapTemplate(row: TemplateRow): EditorTemplate {
  return {
    id: row.id,
    name: row.name,
    config: parseJson<EditorTemplateConfig>(row.config_json, {
      canvasWidth: 1080,
      canvasHeight: 1920,
      videoX: 0,
      videoY: 0,
      videoWidth: 1080,
      videoHeight: 1920,
      fitMode: "fit",
    }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listEditorTemplates(): EditorTemplate[] {
  const rows = db()
    .prepare("SELECT * FROM editor_templates ORDER BY created_at DESC")
    .all() as TemplateRow[];
  return rows.map(mapTemplate);
}

export function getEditorTemplate(id: string): EditorTemplate | null {
  const row = db()
    .prepare("SELECT * FROM editor_templates WHERE id = ?")
    .get(id) as TemplateRow | undefined;
  return row ? mapTemplate(row) : null;
}

export function createEditorTemplate(
  name: string,
  config: EditorTemplateConfig,
): EditorTemplate {
  const id = newId("tpl");
  const now = nowIso();
  db()
    .prepare(
      `INSERT INTO editor_templates (id, name, config_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, name, JSON.stringify(config), now, now);
  return getEditorTemplate(id)!;
}

export function updateEditorTemplate(
  id: string,
  patch: { name?: string; config?: EditorTemplateConfig },
): EditorTemplate | null {
  const existing = getEditorTemplate(id);
  if (!existing) return null;
  const name = patch.name ?? existing.name;
  const config = patch.config ?? existing.config;
  const now = nowIso();
  db()
    .prepare(
      `UPDATE editor_templates SET name = ?, config_json = ?, updated_at = ? WHERE id = ?`,
    )
    .run(name, JSON.stringify(config), now, id);
  return getEditorTemplate(id);
}

/**
 * Apaga o template e desliga quem apontava para ele.
 *
 * A limpeza e explicita, e nao confiada ao `ON DELETE SET NULL`: em bancos que
 * ja existiam, `template_id` entrou por `ALTER TABLE ADD COLUMN`, que no SQLite
 * nao cria a chave estrangeira. Sem isso o video ficava apontando para um
 * template apagado e a interface mostrava "Template" num video sem template.
 */
export function deleteEditorTemplate(id: string): void {
  db().transaction(() => {
    db().prepare("UPDATE editor_videos SET template_id = NULL WHERE template_id = ?").run(id);
    db().prepare("DELETE FROM editor_templates WHERE id = ?").run(id);
  })();
}

// ============================ SOURCE PROFILES ===============================

interface ProfileRow {
  id: string;
  name: string;
  crop_x: number;
  crop_y: number;
  crop_w: number;
  crop_h: number;
  created_at: string;
  updated_at: string;
}

function mapProfile(row: ProfileRow): SourceProfile {
  return {
    id: row.id,
    name: row.name,
    cropX: row.crop_x,
    cropY: row.crop_y,
    cropW: row.crop_w,
    cropH: row.crop_h,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listSourceProfiles(): SourceProfile[] {
  const rows = db()
    .prepare("SELECT * FROM source_profiles ORDER BY created_at DESC")
    .all() as ProfileRow[];
  return rows.map(mapProfile);
}

export function getSourceProfile(id: string): SourceProfile | null {
  const row = db()
    .prepare("SELECT * FROM source_profiles WHERE id = ?")
    .get(id) as ProfileRow | undefined;
  return row ? mapProfile(row) : null;
}

export function createSourceProfile(
  name: string,
  crop: { x: number; y: number; w: number; h: number },
): SourceProfile {
  const id = newId("prf");
  const now = nowIso();
  db()
    .prepare(
      `INSERT INTO source_profiles (id, name, crop_x, crop_y, crop_w, crop_h, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, name, crop.x, crop.y, crop.w, crop.h, now, now);
  return getSourceProfile(id)!;
}

export function deleteSourceProfile(id: string): void {
  db().prepare("DELETE FROM source_profiles WHERE id = ?").run(id);
}

// ====================== VÍDEOS PROMOVIDOS PARA A EDIÇÃO =====================

/**
 * Promove videos da analise para a edicao.
 *
 * `INSERT OR IGNORE` porque mandar o mesmo video duas vezes e um gesto normal
 * do usuario ("selecionar todos" depois de ja ter mandado alguns), nao um erro.
 * Devolve quantos entraram de fato, para a interface poder dizer a diferenca.
 */
export function addVideosToEditor(videoIds: string[]): { added: number; alreadyThere: number } {
  const stmt = db().prepare(
    "INSERT OR IGNORE INTO editor_videos (video_id, added_at) VALUES (?, ?)",
  );
  const now = nowIso();
  const apply = db().transaction((ids: string[]) => {
    let added = 0;
    for (const id of ids) {
      added += stmt.run(id, now).changes;
    }
    return added;
  });
  const added = apply(videoIds);
  return { added, alreadyThere: videoIds.length - added };
}

/** Atribui (ou tira, com `null`) um template a vários vídeos de uma vez. */
export function setVideoTemplate(videoIds: string[], templateId: string | null): number {
  const stmt = db().prepare("UPDATE editor_videos SET template_id = ? WHERE video_id = ?");
  const apply = db().transaction((ids: string[]) => {
    let changed = 0;
    for (const id of ids) changed += stmt.run(templateId, id).changes;
    return changed;
  });
  return apply(videoIds);
}

export function removeVideoFromEditor(videoId: string): void {
  db().prepare("DELETE FROM editor_videos WHERE video_id = ?").run(videoId);
}

export function listEditorVideoIds(): string[] {
  const rows = db()
    .prepare("SELECT video_id FROM editor_videos ORDER BY added_at DESC")
    .all() as Array<{ video_id: string }>;
  return rows.map((r) => r.video_id);
}

// =========================== RECORTE POR VÍDEO ==============================

interface CropRow {
  video_id: string;
  crop_x: number;
  crop_y: number;
  crop_w: number;
  crop_h: number;
  confidence: number | null;
  source: string;
  updated_at: string;
}

function mapCrop(row: CropRow): EditorCrop {
  return {
    x: row.crop_x,
    y: row.crop_y,
    width: row.crop_w,
    height: row.crop_h,
    normalized: true,
    confidence: row.confidence ?? undefined,
    source: row.source as EditorCrop["source"],
  };
}

export function getVideoCrop(videoId: string): EditorCrop | null {
  const row = db()
    .prepare("SELECT * FROM editor_video_crops WHERE video_id = ?")
    .get(videoId) as CropRow | undefined;
  return row ? mapCrop(row) : null;
}

export function listVideoCrops(): Record<string, EditorCrop> {
  const rows = db().prepare("SELECT * FROM editor_video_crops").all() as CropRow[];
  const out: Record<string, EditorCrop> = {};
  for (const row of rows) out[row.video_id] = mapCrop(row);
  return out;
}

/**
 * Grava o recorte de varios videos de uma vez.
 *
 * E uma transacao porque "aplicar a todos" sobre dezenas de videos ou grava
 * tudo ou nao grava nada: um lote pela metade deixaria o usuario sem saber
 * quais videos ficaram com o recorte antigo.
 */
export function saveVideoCrops(videoIds: string[], crop: EditorCrop): number {
  const stmt = db().prepare(
    `INSERT INTO editor_video_crops (video_id, crop_x, crop_y, crop_w, crop_h, confidence, source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(video_id) DO UPDATE SET
       crop_x = excluded.crop_x,
       crop_y = excluded.crop_y,
       crop_w = excluded.crop_w,
       crop_h = excluded.crop_h,
       confidence = excluded.confidence,
       source = excluded.source,
       updated_at = excluded.updated_at`,
  );
  const now = nowIso();
  const apply = db().transaction((ids: string[]) => {
    for (const id of ids) {
      stmt.run(id, crop.x, crop.y, crop.width, crop.height, crop.confidence ?? null, crop.source, now);
    }
    return ids.length;
  });
  return apply(videoIds);
}

export function deleteVideoCrop(videoId: string): void {
  db().prepare("DELETE FROM editor_video_crops WHERE video_id = ?").run(videoId);
}

// ============================== EDITOR JOBS =================================

interface JobRow {
  id: string;
  video_id: string;
  template_id: string | null;
  profile_id: string | null;
  crop_json: string;
  audio_json: string;
  export_json: string;
  status: string;
  progress: number;
  output_path: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

const DEFAULT_CROP: EditorCrop = {
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  normalized: true,
  source: "manual",
};

const DEFAULT_AUDIO: EditorAudioSettings = {
  mode: "original",
  originalVolume: 1,
  musicVolume: 0,
};

const DEFAULT_EXPORT: EditorExportSettings = {
  width: 1080,
  height: 1920,
  fps: 30,
  videoCodec: "libx264",
  audioCodec: "aac",
  encoderMode: "auto",
};

function mapJob(row: JobRow): EditorJob {
  return {
    id: row.id,
    videoId: row.video_id,
    templateId: row.template_id,
    profileId: row.profile_id,
    crop: parseJson<EditorCrop>(row.crop_json, DEFAULT_CROP),
    audio: parseJson<EditorAudioSettings>(row.audio_json, DEFAULT_AUDIO),
    exportSettings: parseJson<EditorExportSettings>(row.export_json, DEFAULT_EXPORT),
    status: row.status as EditorJobStatus,
    progress: row.progress,
    outputPath: row.output_path,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export function createEditorJob(input: {
  videoId: string;
  templateId?: string | null;
  profileId?: string | null;
  crop?: EditorCrop;
  audio?: EditorAudioSettings;
  exportSettings?: EditorExportSettings;
}): EditorJob {
  const id = newId("ejb");
  const now = nowIso();
  db()
    .prepare(
      `INSERT INTO editor_jobs (id, video_id, template_id, profile_id, crop_json, audio_json, export_json, status, progress, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?)`,
    )
    .run(
      id,
      input.videoId,
      input.templateId ?? null,
      input.profileId ?? null,
      JSON.stringify(input.crop ?? DEFAULT_CROP),
      JSON.stringify(input.audio ?? DEFAULT_AUDIO),
      JSON.stringify(input.exportSettings ?? DEFAULT_EXPORT),
      now,
    );
  return getEditorJob(id)!;
}

export function getEditorJob(id: string): EditorJob | null {
  const row = db()
    .prepare("SELECT * FROM editor_jobs WHERE id = ?")
    .get(id) as JobRow | undefined;
  return row ? mapJob(row) : null;
}

export function listEditorJobsByVideo(videoId: string): EditorJob[] {
  const rows = db()
    .prepare("SELECT * FROM editor_jobs WHERE video_id = ? ORDER BY created_at DESC")
    .all(videoId) as JobRow[];
  return rows.map(mapJob);
}

export function listPendingEditorJobs(limit: number = 10): EditorJob[] {
  const rows = db()
    .prepare(
      `SELECT * FROM editor_jobs WHERE status IN ('pending', 'analyzing', 'ready')
       ORDER BY created_at ASC LIMIT ?`,
    )
    .all(limit) as JobRow[];
  return rows.map(mapJob);
}

export function updateEditorJobStatus(
  id: string,
  status: EditorJobStatus,
  patch: { progress?: number; outputPath?: string; errorMessage?: string } = {},
): void {
  const now = nowIso();
  const started = status === "processing" ? now : undefined;
  const completed = ["completed", "failed", "cancelled"].includes(status) ? now : undefined;
  db()
    .prepare(
      `UPDATE editor_jobs SET status = ?, progress = COALESCE(?, progress),
        output_path = COALESCE(?, output_path), error_message = COALESCE(?, error_message),
        started_at = COALESCE(?, started_at), completed_at = COALESCE(?, completed_at)
       WHERE id = ?`,
    )
    .run(
      status,
      patch.progress ?? null,
      patch.outputPath ?? null,
      patch.errorMessage ?? null,
      started ?? null,
      completed ?? null,
      id,
    );
}

export function deleteEditorJob(id: string): void {
  db().prepare("DELETE FROM editor_jobs WHERE id = ?").run(id);
}