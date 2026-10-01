import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * "Terminar os N com erro" na Fila.
 *
 * Caso real que motivou isto (2026-10-01): um lote de 98 "Gerar CTAs" no
 * Gemini gratuito — 87 concluíram e 11 pararam com `quota_exhausted`. O
 * usuário espera a cota renovar e precisa retomar só aqueles 11.
 */

vi.mock("../src/lib/auth", () => ({ isAuthenticated: async () => true, guardApi: async () => null }));

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shortcta-retomar-"));

let dbMod: typeof import("../src/lib/db");
let repo: typeof import("../src/lib/repo");
let view: typeof import("../src/lib/view");
let route: typeof import("../src/app/api/videos/retry-failed/route");

beforeAll(async () => {
  process.env.DATA_DIR = tmpDir;
  process.env.DATABASE_PATH = path.join(tmpDir, "teste.db");
  vi.resetModules();
  dbMod = await import("../src/lib/db");
  repo = await import("../src/lib/repo");
  view = await import("../src/lib/view");
  route = await import("../src/app/api/videos/retry-failed/route");
  dbMod.db();
});

afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Windows pode segurar o banco; a pasta é temporária.
  }
});

let seq = 0;
function video(): string {
  const name = `v${++seq}`;
  const file = path.join(tmpDir, `${name}.mp4`);
  fs.writeFileSync(file, "x");
  return repo.createVideo({
    originalName: `${name}.mp4`,
    storedName: `${name}.mp4`,
    path: file,
    hash: `h_${name}`,
    bytes: 1,
    mime: "video/mp4",
  }).id;
}

/** Vídeo com um job já terminado no estado pedido. */
function comJob(status: "done" | "error", mode: "full" | "local" | "ai", errorCode?: string): string {
  const id = video();
  const job = repo.createJob(id, { mode });
  repo.setJobStatus(job.id, status, errorCode ? { errorCode, errorMessage: "…", retryable: false } : {});
  return id;
}

function limpar() {
  dbMod.db().prepare("DELETE FROM analysis_jobs").run();
  dbMod.db().prepare("DELETE FROM videos").run();
}

describe("retomar os que falharam", () => {
  it("enfileira só os que falharam, e cada um no modo em que parou", async () => {
    limpar();
    const pronto = comJob("done", "ai");
    const porCota = comJob("error", "ai", "quota_exhausted");
    const naParteLocal = comJob("error", "local", "pipeline_error");

    const data = (await (await route.POST()).json()) as { queuedCount: number; queued: string[] };
    expect(data.queuedCount).toBe(2);
    expect(new Set(data.queued)).toEqual(new Set([porCota, naParteLocal]));

    // O modo é preservado: um job "local" retomado não pode virar "ai" e
    // passar a gastar chamadas que ninguém pediu.
    expect(repo.latestJob(porCota)?.mode).toBe("ai");
    expect(repo.latestJob(naParteLocal)?.mode).toBe("local");
    expect(repo.latestJob(porCota)?.status).toBe("queued");
    // O que já estava pronto não é tocado.
    expect(repo.latestJob(pronto)?.status).toBe("done");
  });

  it("vídeo já retomado não entra de novo: dois cliques não duplicam", async () => {
    limpar();
    comJob("error", "ai", "quota_exhausted");

    expect(((await (await route.POST()).json()) as { queuedCount: number }).queuedCount).toBe(1);
    const segundo = await route.POST();
    expect(segundo.status).toBe(400);
    expect(((await segundo.json()) as { error: string }).error).toMatch(/nenhum vídeo com erro/i);
  });

  it("sem nenhum erro, recusa com a explicação em vez de fingir que fez", async () => {
    limpar();
    comJob("done", "ai");
    const res = await route.POST();
    expect(res.status).toBe(400);
  });

  it("o resumo da fila diz POR QUE os vídeos pararam", () => {
    limpar();
    comJob("error", "ai", "quota_exhausted");
    comJob("error", "ai", "quota_exhausted");
    comJob("error", "full", "pipeline_error");
    comJob("done", "ai");

    const q = view.queueOverview();
    expect(q.error).toBe(3);
    expect(q.failedByCode).toEqual({ quota_exhausted: 2, pipeline_error: 1 });
  });

  it("só o ÚLTIMO job conta: vídeo que falhou e já foi retomado não aparece", () => {
    limpar();
    const id = comJob("error", "ai", "quota_exhausted");
    expect(repo.listFailedVideos()).toHaveLength(1);

    repo.createJob(id, { mode: "ai" }); // retomado: o último job está na fila
    expect(repo.listFailedVideos()).toHaveLength(0);
    expect(view.queueOverview().failedByCode).toEqual({});
  });
});
