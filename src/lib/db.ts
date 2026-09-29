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
  migrateCaptureQueueUnique(handle);

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
