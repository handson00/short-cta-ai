import { db, newId, nowIso, parseJson } from "./db";
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
import { countEffects, normalizeEffects, type EditorEffects } from "./editor/effects";

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
  origin_key: string | null;
  aspect: number | null;
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
    originKey: row.origin_key,
    aspect: row.aspect,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listSourceProfiles(): SourceProfile[] {
  const rows = db()
    .prepare("SELECT * FROM source_profiles ORDER BY updated_at DESC")
    .all() as ProfileRow[];
  return rows.map(mapProfile);
}

export function getSourceProfile(id: string): SourceProfile | null {
  const row = db()
    .prepare("SELECT * FROM source_profiles WHERE id = ?")
    .get(id) as ProfileRow | undefined;
  return row ? mapProfile(row) : null;
}

export interface ProfileInput {
  name: string;
  crop: { x: number; y: number; width: number; height: number };
  originKey: string | null;
  aspect: number | null;
}

export function createSourceProfile(input: ProfileInput): SourceProfile {
  const id = newId("prf");
  const now = nowIso();
  const c = input.crop;
  db()
    .prepare(
      `INSERT INTO source_profiles (id, name, crop_x, crop_y, crop_w, crop_h, origin_key, aspect, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.name, c.x, c.y, c.width, c.height, input.originKey, input.aspect, now, now);
  return getSourceProfile(id)!;
}

/**
 * Atualiza nome e/ou recorte. Os vídeos que já receberam este perfil NÃO mudam:
 * o recorte aplicado é cópia. Trocar o recorte de dezenas de vídeos por baixo,
 * sem o usuário pedir, faria uma exportação já conferida sair diferente.
 */
export function updateSourceProfile(
  id: string,
  patch: { name?: string; crop?: ProfileInput["crop"]; aspect?: number | null },
): SourceProfile | null {
  const existing = getSourceProfile(id);
  if (!existing) return null;
  const c = patch.crop ?? { x: existing.cropX, y: existing.cropY, width: existing.cropW, height: existing.cropH };
  db()
    .prepare(
      `UPDATE source_profiles SET name = ?, crop_x = ?, crop_y = ?, crop_w = ?, crop_h = ?, aspect = ?,
         updated_at = ? WHERE id = ?`,
    )
    .run(
      patch.name ?? existing.name,
      c.x,
      c.y,
      c.width,
      c.height,
      patch.aspect !== undefined ? patch.aspect : existing.aspect,
      nowIso(),
      id,
    );
  return getSourceProfile(id);
}

/**
 * Apaga o perfil. Os recortes que vieram dele continuam valendo — o vídeo não
 * perde o recorte —, só deixam de apontar para um perfil que não existe mais.
 *
 * A limpeza é explícita pelo mesmo motivo de `deleteEditorTemplate`: em bancos
 * antigos, `editor_video_crops.profile_id` entrou por ALTER TABLE, sem FK.
 */
export function deleteSourceProfile(id: string): void {
  db().transaction(() => {
    db().prepare("UPDATE editor_video_crops SET profile_id = NULL WHERE profile_id = ?").run(id);
    db().prepare("DELETE FROM source_profiles WHERE id = ?").run(id);
  })();
}

/** Quantos vídeos na edição estão com o recorte de cada perfil. */
export function sourceProfileUsage(): Record<string, number> {
  const rows = db()
    .prepare(
      `SELECT c.profile_id AS id, COUNT(*) AS n FROM editor_video_crops c
       JOIN editor_videos ev ON ev.video_id = c.video_id
       WHERE c.profile_id IS NOT NULL GROUP BY c.profile_id`,
    )
    .all() as Array<{ id: string; n: number }>;
  return Object.fromEntries(rows.map((r) => [r.id, r.n]));
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

/** Template aplicado a cada vídeo (`null` = nenhum), na mesma ordem pedida. */
export function getVideoTemplateIds(videoIds: string[]): Map<string, string | null> {
  const stmt = db().prepare("SELECT template_id FROM editor_videos WHERE video_id = ?");
  const out = new Map<string, string | null>();
  for (const id of videoIds) {
    const row = stmt.get(id) as { template_id: string | null } | undefined;
    out.set(id, row?.template_id ?? null);
  }
  return out;
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

// ========================= TEXTO PRÓPRIO DO VÍDEO ===========================

/** Grava (ou, com texto vazio/nulo, apaga) o texto próprio de um vídeo. */
export function setVideoTextOverride(videoId: string, text: string | null): void {
  const clean = text?.trim() ?? "";
  if (!clean) {
    db().prepare("DELETE FROM editor_video_texts WHERE video_id = ?").run(videoId);
    return;
  }
  db()
    .prepare(
      `INSERT INTO editor_video_texts (video_id, text, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(video_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at`,
    )
    .run(videoId, clean, nowIso());
}

/**
 * Camadas de texto que um job ainda vai ler.
 *
 * Quem apaga versões antigas de camada consulta isto antes: um job pendente
 * que perdesse a camada sairia sem texto, ou falharia no meio do lote.
 */
export function textLayerFilesInUse(): Set<string> {
  const rows = db()
    .prepare("SELECT export_json FROM editor_jobs WHERE status IN ('pending', 'processing')")
    .all() as Array<{ export_json: string }>;
  const out = new Set<string>();
  for (const r of rows) {
    const layer = parseJson<{ textLayer?: string | null }>(r.export_json, {}).textLayer;
    if (layer) out.add(layer);
  }
  return out;
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
  profile_id: string | null;
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
    profileId: row.profile_id ?? null,
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
    `INSERT INTO editor_video_crops (video_id, crop_x, crop_y, crop_w, crop_h, confidence, source, profile_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(video_id) DO UPDATE SET
       crop_x = excluded.crop_x,
       crop_y = excluded.crop_y,
       crop_w = excluded.crop_w,
       crop_h = excluded.crop_h,
       confidence = excluded.confidence,
       source = excluded.source,
       profile_id = excluded.profile_id,
       updated_at = excluded.updated_at`,
  );
  const now = nowIso();
  // Recorte manual ou automático gravado por cima de um de perfil desfaz o
  // vínculo: a tela não pode continuar dizendo "do perfil X" depois do ajuste.
  const profileId = crop.source === "profile" ? (crop.profileId ?? null) : null;
  const apply = db().transaction((ids: string[]) => {
    for (const id of ids) {
      stmt.run(id, crop.x, crop.y, crop.width, crop.height, crop.confidence ?? null, crop.source, profileId, now);
    }
    return ids.length;
  });
  return apply(videoIds);
}

export function deleteVideoCrop(videoId: string): void {
  db().prepare("DELETE FROM editor_video_crops WHERE video_id = ?").run(videoId);
}

// =========================== EFEITOS POR VÍDEO ==============================

export function getVideoEffects(videoId: string): EditorEffects | null {
  const row = db().prepare("SELECT config_json FROM editor_video_effects WHERE video_id = ?").get(videoId) as
    | { config_json: string }
    | undefined;
  return row ? normalizeEffects(parseJson(row.config_json, {})) : null;
}

export function listVideoEffects(): Record<string, EditorEffects> {
  const rows = db().prepare("SELECT video_id, config_json FROM editor_video_effects").all() as Array<{
    video_id: string;
    config_json: string;
  }>;
  const out: Record<string, EditorEffects> = {};
  for (const r of rows) out[r.video_id] = normalizeEffects(parseJson(r.config_json, {}));
  return out;
}

/**
 * Grava os mesmos efeitos em vários vídeos ("Seleção" e "Todos"), numa
 * transação: ou o lote inteiro recebe, ou nenhum — como o recorte.
 * Efeitos todos desligados apagam a linha: "sem linha" é "sem efeito".
 */
export function saveVideoEffects(videoIds: string[], effects: EditorEffects): number {
  const fx = normalizeEffects(effects);
  const empty = countEffects(fx) === 0;
  const upsert = db().prepare(
    `INSERT INTO editor_video_effects (video_id, config_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(video_id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at`,
  );
  const remove = db().prepare("DELETE FROM editor_video_effects WHERE video_id = ?");
  const now = nowIso();
  const apply = db().transaction((ids: string[]) => {
    for (const id of ids) {
      if (empty) remove.run(id);
      else upsert.run(id, JSON.stringify(fx), now);
    }
    return ids.length;
  });
  return apply([...new Set(videoIds)]);
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
      // started_at/completed_at: o valor já gravado vence. Na ordem inversa,
      // cada atualização de progresso reescrevia a hora de início.
      `UPDATE editor_jobs SET status = ?, progress = COALESCE(?, progress),
        output_path = COALESCE(?, output_path), error_message = COALESCE(?, error_message),
        started_at = COALESCE(started_at, ?), completed_at = COALESCE(completed_at, ?)
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

// ========================== FILA DE EXPORTAÇÃO ==============================

/**
 * Pega o próximo job pendente e o marca como em processamento, numa transação.
 *
 * Ler e marcar em dois passos soltos deixaria dois workers pegarem o mesmo
 * job — e o mesmo vídeo seria renderizado duas vezes.
 */
export function claimNextEditorJob(): EditorJob | null {
  return db().transaction(() => {
    const row = db()
      .prepare("SELECT * FROM editor_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1")
      .get() as JobRow | undefined;
    if (!row) return null;
    db()
      .prepare(
        "UPDATE editor_jobs SET status = 'processing', progress = 0, started_at = ? WHERE id = ?",
      )
      .run(nowIso(), row.id);
    return mapJob({ ...row, status: "processing", progress: 0 });
  })();
}

/** Progresso só vale para job em andamento: não ressuscita um job cancelado. */
export function updateEditorJobProgress(id: string, progress: number): void {
  db()
    .prepare("UPDATE editor_jobs SET progress = ? WHERE id = ? AND status = 'processing'")
    .run(progress, id);
}

/** Cancela um job que ainda não começou. Devolve se havia algo para cancelar. */
export function cancelPendingEditorJob(id: string): boolean {
  return (
    db()
      .prepare(
        "UPDATE editor_jobs SET status = 'cancelled', completed_at = ? WHERE id = ? AND status = 'pending'",
      )
      .run(nowIso(), id).changes > 0
  );
}

export function cancelAllPendingEditorJobs(): number {
  return db()
    .prepare("UPDATE editor_jobs SET status = 'cancelled', completed_at = ? WHERE status = 'pending'")
    .run(nowIso()).changes;
}

export function listProcessingEditorJobIds(): string[] {
  return (
    db().prepare("SELECT id FROM editor_jobs WHERE status = 'processing'").all() as Array<{ id: string }>
  ).map((r) => r.id);
}

/**
 * Jobs que estavam rodando quando o servidor caiu voltam para a fila (§112).
 *
 * O FFmpeg morreu junto com o processo, então nada está de fato em andamento;
 * deixar como "processing" travaria o job para sempre.
 */
export function requeueInterruptedEditorJobs(): number {
  return db()
    .prepare(
      "UPDATE editor_jobs SET status = 'pending', progress = 0, started_at = NULL WHERE status = 'processing'",
    )
    .run().changes;
}

export interface EditorJobView {
  id: string;
  videoId: string;
  videoName: string;
  status: EditorJobStatus;
  progress: number;
  outputPath: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

/** Jobs recentes para a tela, com o nome do vídeo já resolvido. */
export function listRecentEditorJobs(limit = 200): EditorJobView[] {
  const rows = db()
    .prepare(
      `SELECT j.id, j.video_id, v.original_name, j.status, j.progress, j.output_path,
              j.error_message, j.created_at, j.started_at, j.completed_at
       FROM editor_jobs j JOIN videos v ON v.id = j.video_id
       ORDER BY j.created_at DESC LIMIT ?`,
    )
    .all(limit) as Array<{
    id: string;
    video_id: string;
    original_name: string;
    status: string;
    progress: number;
    output_path: string | null;
    error_message: string | null;
    created_at: string;
    started_at: string | null;
    completed_at: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    videoId: r.video_id,
    videoName: r.original_name,
    status: r.status as EditorJobStatus,
    progress: r.progress,
    outputPath: r.output_path,
    errorMessage: r.error_message,
    createdAt: r.created_at,
    startedAt: r.started_at,
    completedAt: r.completed_at,
  }));
}

/** Tira da lista os jobs que já terminaram; os arquivos gerados ficam no disco. */
export function clearFinishedEditorJobs(): number {
  return db()
    .prepare("DELETE FROM editor_jobs WHERE status IN ('completed', 'failed', 'cancelled')")
    .run().changes;
}