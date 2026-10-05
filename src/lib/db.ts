import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { env } from "./env";
import { SCHEMA_SQL } from "./schema";

let instance: Database.Database | null = null;

export function db(): Database.Database {
  if (instance) return instance;

  fs.mkdirSync(env.uploadsDir, { recursive: true });
  fs.mkdirSync(env.artifactsDir, { recursive: true });
  fs.mkdirSync(env.templatesDir, { recursive: true });
  fs.mkdirSync(env.textLayersDir, { recursive: true });
  fs.mkdirSync(path.dirname(env.databasePath), { recursive: true });

  const handle = new Database(env.databasePath);
  handle.pragma("journal_mode = WAL");
  handle.pragma("busy_timeout = 5000");
  handle.pragma("foreign_keys = ON");
  handle.exec(SCHEMA_SQL);

  migrateTiktokColumns(handle);
  migrateEditorColumns(handle);
  migrateSourceProfileColumns(handle);
  migrateAiOnDemandColumns(handle);
  migrateAiProviderColumn(handle);
  migrateCaptionsTable(handle);
  migrateCaptureQueueUnique(handle);
  migrateArchivedColumn(handle);

  instance = handle;
  return handle;
}

/**
 * Um pedido de captura aberto por video.
 *
 * O `INSERT OR IGNORE` de `addToCaptureQueue` prometia ignorar duplicatas, mas
 * sem restricao de unicidade nao havia o que ignorar: cada clique em "Capturar
 * comentarios" enfileirava o video de novo, e a extensao visitaria o mesmo
 * post duas vezes. Bancos antigos chegam com essas duplicatas; elas saem antes
 * do indice, que nao poderia ser criado com elas presentes.
 */
function migrateCaptureQueueUnique(handle: Database.Database): void {
  const open = "status IN ('pending', 'processing')";
  handle.transaction(() => {
    handle.exec(`
      DELETE FROM capture_queue
      WHERE ${open}
        AND rowid NOT IN (SELECT MIN(rowid) FROM capture_queue WHERE ${open} GROUP BY video_id)
    `);
    handle.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_capture_queue_one_open ON capture_queue(video_id) WHERE ${open}`,
    );
  })();
}

/** Bancos que já tinham `editor_videos` antes do template ganham a coluna aqui. */
function migrateEditorColumns(handle: Database.Database): void {
  const columns = new Set(
    (handle.pragma("table_info(editor_videos)") as { name: string }[]).map((c: any) => c.name),
  );
  if (columns.size > 0 && !columns.has("template_id")) {
    // Sem REFERENCES: o SQLite não cria chave estrangeira por ALTER TABLE.
    // Por isso `deleteEditorTemplate` limpa as referências explicitamente.
    handle.exec("ALTER TABLE editor_videos ADD COLUMN template_id TEXT");
  }
}

/**
 * Fase 9: página e proporção do perfil, e o perfil de origem de cada recorte.
 *
 * Como em `template_id`, a coluna que entra por ALTER não ganha a chave
 * estrangeira: `deleteSourceProfile` limpa `profile_id` explicitamente.
 */
function migrateSourceProfileColumns(handle: Database.Database): void {
  const cols = (table: string) =>
    new Set((handle.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name));

  const profiles = cols("source_profiles");
  if (!profiles.has("origin_key")) handle.exec("ALTER TABLE source_profiles ADD COLUMN origin_key TEXT");
  if (!profiles.has("aspect")) handle.exec("ALTER TABLE source_profiles ADD COLUMN aspect REAL");

  if (!cols("editor_video_crops").has("profile_id")) {
    handle.exec("ALTER TABLE editor_video_crops ADD COLUMN profile_id TEXT");
  }
}

/**
 * IA sob demanda: modo do job e a impressão digital do que foi enviado à IA.
 * Jobs antigos ficam como 'full', que é o que eles de fato fizeram.
 */
function migrateAiOnDemandColumns(handle: Database.Database): void {
  const cols = (table: string) =>
    new Set((handle.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name));
  if (!cols("analysis_jobs").has("mode")) {
    handle.exec("ALTER TABLE analysis_jobs ADD COLUMN mode TEXT NOT NULL DEFAULT 'full'");
  }
  const scene = cols("scene_analyses");
  if (!scene.has("input_hash")) handle.exec("ALTER TABLE scene_analyses ADD COLUMN input_hash TEXT");
  if (!scene.has("ctas_input_hash")) handle.exec("ALTER TABLE scene_analyses ADD COLUMN ctas_input_hash TEXT");
}

/**
 * Qual provedor atendeu cada chamada (GhostCLI ou Gemini). Sem esta coluna o
 * INSERT de `logAiRequest` falharia — e ele engole o erro de propósito, então
 * "Uso da IA" pararia de registrar sem ninguém perceber.
 */
/** Vídeo que saiu da Fila mas ficou no histórico de Exportações (HISTORICO §47). */
function migrateArchivedColumn(handle: Database.Database): void {
  const cols = new Set((handle.pragma("table_info(videos)") as { name: string }[]).map((c) => c.name));
  if (!cols.has("archived_at")) handle.exec("ALTER TABLE videos ADD COLUMN archived_at TEXT");
}

function migrateAiProviderColumn(handle: Database.Database): void {
  const cols = new Set((handle.pragma("table_info(ai_request_logs)") as { name: string }[]).map((c) => c.name));
  if (!cols.has("provider")) handle.exec("ALTER TABLE ai_request_logs ADD COLUMN provider TEXT");

  // Hashtags sugeridas pela IA, ao lado das capturadas pela extensão.
  const tags = new Set((handle.pragma("table_info(video_hashtags)") as { name: string }[]).map((c) => c.name));
  if (tags.size > 0 && !tags.has("ia_json")) {
    handle.exec("ALTER TABLE video_hashtags ADD COLUMN ia_json TEXT NOT NULL DEFAULT '[]'");
  }
  if (tags.size > 0 && !tags.has("ia_ja_json")) {
    handle.exec("ALTER TABLE video_hashtags ADD COLUMN ia_ja_json TEXT NOT NULL DEFAULT '[]'");
  }
}

/**
 * `video_jp_captions` (só japonês) virou `video_captions` (português e
 * japonês), quando a legenda principal passou a ser a em português.
 *
 * Copia e só então remove a antiga, numa transação: ou as legendas já geradas
 * sobrevivem inteiras, ou nada acontece. Perder uma legenda gerada custaria
 * uma chamada paga para refazer.
 */
function migrateCaptionsTable(handle: Database.Database): void {
  const antiga = handle
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'video_jp_captions'")
    .get();
  if (!antiga) return;

  handle.transaction(() => {
    handle.exec(`
      INSERT INTO video_captions (video_id, pt_text, ja_text, ja_hashtag, updated_at)
      SELECT video_id, NULL, text, hashtag, updated_at FROM video_jp_captions
      WHERE video_id NOT IN (SELECT video_id FROM video_captions)
    `);
    handle.exec("DROP TABLE video_jp_captions");
  })();
}

/** Bancos criados antes da funcionalidade TikTok ganham as colunas novas aqui. */
function migrateTiktokColumns(handle: Database.Database): void {
  const columns = new Set(
    (handle.pragma("table_info(videos)") as { name: string }[]).map((c: any) => c.name),
  );
  const additions: [string, string][] = [
    ["source_folder", "TEXT"],
    ["tiktok_username", "TEXT"],
    ["video_date", "TEXT"],
    ["platform", "TEXT"],
    ["platform_video_id", "TEXT"],
    ["original_url", "TEXT"],
  ];
  for (const [col, type] of additions) {
    if (!columns.has(col)) {
      handle.exec(`ALTER TABLE videos ADD COLUMN ${col} ${type}`);
    }
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

/** Converte 0/1 do SQLite em boolean. */
export function toBool(value: unknown): boolean {
  return value === 1 || value === true;
}

export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || raw.length === 0) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
