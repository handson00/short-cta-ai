// Gerado a partir de schema.sql. Editar aqui e a fonte de verdade.
export const SCHEMA_SQL = `PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  path TEXT NOT NULL,
  hash TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  mime TEXT,
  container TEXT,
  duration_seconds REAL,
  width INTEGER,
  height INTEGER,
  aspect_ratio TEXT,
  has_audio INTEGER NOT NULL DEFAULT 0,
  thumbnail_path TEXT,
  source_folder TEXT,
  tiktok_username TEXT,
  video_date TEXT,
  platform TEXT,
  platform_video_id TEXT,
  original_url TEXT,
  created_at TEXT NOT NULL,
  purged_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_videos_hash ON videos(hash);
CREATE INDEX IF NOT EXISTS idx_videos_created ON videos(created_at DESC);

-- Fila persistente. Um job por analise; "Analisar novamente" cria um novo job.
CREATE TABLE IF NOT EXISTS analysis_jobs (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  stage TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  error_code TEXT,
  error_message TEXT,
  retryable INTEGER NOT NULL DEFAULT 1,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  reuse_scene INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON analysis_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_video ON analysis_jobs(video_id, created_at DESC);

CREATE TABLE IF NOT EXISTS frames (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  timestamp_seconds REAL NOT NULL,
  phash TEXT,
  kept INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_frames_video ON frames(video_id, timestamp_seconds);

CREATE TABLE IF NOT EXISTS transcripts (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  language TEXT,
  text TEXT NOT NULL DEFAULT '',
  segments_json TEXT NOT NULL DEFAULT '[]',
  has_speech INTEGER NOT NULL DEFAULT 0,
  low_confidence INTEGER NOT NULL DEFAULT 0,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transcripts_video ON transcripts(video_id);

CREATE TABLE IF NOT EXISTS visual_analyses (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  visible_text_json TEXT NOT NULL DEFAULT '[]',
  scene_description TEXT,
  visual_clues_json TEXT NOT NULL DEFAULT '[]',
  existing_cta_text TEXT,
  existing_cta_confidence TEXT,
  existing_cta_first_seen REAL,
  existing_cta_reasons_json TEXT NOT NULL DEFAULT '[]',
  manual_cta_text TEXT,
  limitations_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_visual_video ON visual_analyses(video_id);

CREATE TABLE IF NOT EXISTS work_identifications (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  title TEXT,
  original_title TEXT,
  year INTEGER,
  media_type TEXT,
  confidence TEXT NOT NULL DEFAULT 'low',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  sources_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'not_identified_safely',
  manually_corrected INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_video ON work_identifications(video_id);

CREATE TABLE IF NOT EXISTS scene_analyses (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  limitations_json TEXT NOT NULL DEFAULT '[]',
  conflict TEXT,
  curiosity TEXT,
  withhold TEXT,
  speculation_json TEXT NOT NULL DEFAULT '[]',
  existing_cta_strength TEXT,
  existing_cta_improvement TEXT,
  recommended_text TEXT,
  recommended_reason TEXT,
  raw_json TEXT NOT NULL DEFAULT '{}',
  prompt_version TEXT NOT NULL,
  model TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scene_video ON scene_analyses(video_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cta_suggestions (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  analysis_id TEXT REFERENCES scene_analyses(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  style TEXT NOT NULL,
  reason TEXT,
  is_recommended INTEGER NOT NULL DEFAULT 0,
  origin TEXT NOT NULL DEFAULT 'generated',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cta_video ON cta_suggestions(video_id, position);

CREATE TABLE IF NOT EXISTS user_selections (
  video_id TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
  chosen_cta_id TEXT REFERENCES cta_suggestions(id) ON DELETE SET NULL,
  edited_text TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_request_logs (
  id TEXT PRIMARY KEY,
  video_id TEXT,
  job_id TEXT,
  operation TEXT NOT NULL,
  model TEXT,
  status TEXT NOT NULL,
  http_status INTEGER,
  duration_ms INTEGER,
  attempt INTEGER NOT NULL DEFAULT 1,
  error_code TEXT,
  error_message TEXT,
  prompt_version TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ailog_created ON ai_request_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS style_examples (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_captures (
  video_id TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  author_name TEXT,
  author_url TEXT,
  title TEXT,
  thumbnail_url TEXT,
  raw_json TEXT NOT NULL DEFAULT '{}',
  captured_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;
