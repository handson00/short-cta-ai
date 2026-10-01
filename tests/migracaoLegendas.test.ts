import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * `video_jp_captions` (só japonês) virou `video_captions` (português e
 * japonês). O banco do usuário já tem legendas geradas lá, e cada uma custou
 * uma chamada paga: a migração precisa trazê-las inteiras.
 *
 * O teste monta um banco no FORMATO ANTIGO e abre pelo caminho de produção —
 * o mesmo método de `captureQueue.test.ts`. Um teste que não percorre o código
 * de produção não prova nada sobre ele (HANDOFF §5.1).
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shortcta-migracao-"));
const dbPath = path.join(tmpDir, "antigo.db");

let repo: typeof import("../src/lib/repo");
let dbMod: typeof import("../src/lib/db");

beforeAll(async () => {
  // Banco no formato de antes: a tabela antiga, com duas legendas dentro.
  const antigo = new Database(dbPath);
  antigo.exec(`
    CREATE TABLE videos (id TEXT PRIMARY KEY, original_name TEXT NOT NULL, stored_name TEXT NOT NULL,
      path TEXT NOT NULL, hash TEXT NOT NULL, bytes INTEGER NOT NULL, has_audio INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL);
    CREATE TABLE video_jp_captions (video_id TEXT PRIMARY KEY, text TEXT NOT NULL, hashtag TEXT NOT NULL,
      updated_at TEXT NOT NULL);
    INSERT INTO videos (id, original_name, stored_name, path, hash, bytes, created_at)
      VALUES ('v1', 'a.mp4', 'a.mp4', '/a.mp4', 'h1', 1, '2026-09-30T00:00:00.000Z'),
             ('v2', 'b.mp4', 'b.mp4', '/b.mp4', 'h2', 1, '2026-09-30T00:00:00.000Z');
    INSERT INTO video_jp_captions VALUES
      ('v1', '#tvアニメ 午前2時、奇妙なことが起きた…。', '#tvアニメ', '2026-09-30T01:00:00.000Z'),
      ('v2', '#tvアニメ 深夜のラーメン店…', '#TVアニメ', '2026-09-30T02:00:00.000Z');
  `);
  antigo.close();

  process.env.DATA_DIR = tmpDir;
  process.env.DATABASE_PATH = dbPath;
  vi.resetModules();
  dbMod = await import("../src/lib/db");
  repo = await import("../src/lib/repo");
  dbMod.db(); // aqui a migração roda
});

afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Windows pode segurar o banco; a pasta é temporária.
  }
});

describe("migração das legendas", () => {
  it("traz as legendas já geradas, com a hashtag de cada uma", () => {
    expect(repo.getCaptions("v1")).toEqual({
      pt: null,
      ja: "#tvアニメ 午前2時、奇妙なことが起きた…。",
      jaHashtag: "#tvアニメ",
    });
    expect(repo.getCaptions("v2").jaHashtag).toBe("#TVアニメ");
  });

  it("a tabela antiga sai: ninguém mais a lê, e deixá-la confundiria", () => {
    const existe = dbMod
      .db()
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'video_jp_captions'")
      .get();
    expect(existe).toBeUndefined();
  });

  it("rodar de novo não quebra nada (a abertura do banco é idempotente)", () => {
    expect(() => dbMod.db()).not.toThrow();
    expect(repo.getCaptions("v1").ja).toContain("午前2時");
  });

  it("a legenda em português entra ao lado, sem apagar a japonesa", () => {
    repo.saveCaptions("v1", { pt: "A legenda principal." });
    const c = repo.getCaptions("v1");
    expect(c.pt).toBe("A legenda principal.");
    expect(c.ja).toContain("午前2時");
  });

  it("vídeo sem legenda nenhuma devolve tudo nulo, não quebra", () => {
    expect(repo.getCaptions("inexistente")).toEqual({ pt: null, ja: null, jaHashtag: null });
  });
});
