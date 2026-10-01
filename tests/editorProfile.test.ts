import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  aspectCompatible,
  aspectLabel,
  matchProfile,
  originKeyOf,
  originLabel,
  profileCropError,
  rectIoU,
  type ProfileCandidate,
} from "../src/lib/editor/profile";

/**
 * Perfil de origem (Fase 9). A parte pura decide qual perfil serve a um vídeo;
 * a parte com banco confere que aplicar em lote respeita proporção e recorte
 * manual, e que apagar o perfil não apaga o recorte de ninguém.
 */

const candidate = (over: Partial<ProfileCandidate> = {}): ProfileCandidate => ({
  id: "prf_a",
  name: "@helmermovies (TikTok)",
  originKey: "tiktok:helmermovies",
  aspect: 9 / 16,
  updatedAt: "2026-09-29T10:00:00.000Z",
  ...over,
});

describe("página de origem", () => {
  it("forma a chave pela plataforma e pelo usuário, sem @ e em minúsculas", () => {
    expect(originKeyOf({ platform: "tiktok", username: "HelmerMovies", sourceFolder: null })).toBe(
      "tiktok:helmermovies",
    );
    expect(originKeyOf({ platform: "tiktok", username: null, sourceFolder: "@helmermovies" })).toBe(
      "tiktok:helmermovies",
    );
  });

  it("sem usuário conhecido não inventa página", () => {
    expect(originKeyOf({ platform: "tiktok", username: null, sourceFolder: null })).toBeNull();
    expect(originKeyOf({ platform: null, username: null, sourceFolder: "Meus Vídeos" })).toBeNull();
  });

  it("rotula a página para a tela", () => {
    expect(originLabel("tiktok:helmermovies")).toBe("@helmermovies (TikTok)");
    expect(originLabel(null)).toBeNull();
  });
});

describe("proporção", () => {
  it("720×1280, 576×1024 e 1080×1920 são a mesma proporção", () => {
    expect(aspectCompatible(720 / 1280, 1080 / 1920)).toBe(true);
    expect(aspectCompatible(576 / 1024, 1080 / 1920)).toBe(true);
    expect(aspectCompatible(1080 / 1918, 1080 / 1920)).toBe(true);
  });

  it("4:5 e 1:1 não passam por 9:16", () => {
    expect(aspectCompatible(4 / 5, 9 / 16)).toBe(false);
    expect(aspectCompatible(1, 9 / 16)).toBe(false);
  });

  it("proporção desconhecida nunca é compatível", () => {
    expect(aspectCompatible(null, 9 / 16)).toBe(false);
  });

  it("nomeia as proporções comuns", () => {
    expect(aspectLabel(576 / 1024)).toBe("9:16");
    expect(aspectLabel(null)).toBe("proporção desconhecida");
  });
});

describe("escolha do perfil", () => {
  const video = { originKey: "tiktok:helmermovies", width: 720, height: 1280 };

  it("escolhe o perfil da mesma página e proporção", () => {
    const m = matchProfile(video, [candidate()]);
    expect(m.profile?.id).toBe("prf_a");
  });

  it("entre dois que servem, vence o atualizado por último", () => {
    const m = matchProfile(video, [
      candidate({ id: "velho", updatedAt: "2026-09-01T00:00:00.000Z" }),
      candidate({ id: "novo", updatedAt: "2026-09-29T00:00:00.000Z" }),
    ]);
    expect(m.profile?.id).toBe("novo");
  });

  it("diz por que não serve quando a página não foi identificada", () => {
    const m = matchProfile({ ...video, originKey: null }, [candidate()]);
    expect(m.profile).toBeNull();
    expect(m.reason).toMatch(/não foi identificada/);
  });

  it("diz por que não serve quando só há perfil de outra proporção", () => {
    const m = matchProfile({ ...video, width: 1080, height: 1080 }, [candidate()]);
    expect(m.profile).toBeNull();
    expect(m.reason).toContain("9:16");
    expect(m.reason).toContain("1:1");
  });

  it("perfil de outra página não é sugerido", () => {
    const m = matchProfile(video, [candidate({ originKey: "tiktok:outrapagina" })]);
    expect(m.profile).toBeNull();
    expect(m.reason).toMatch(/Nenhum perfil salvo/);
  });
});

describe("comparação de retângulos", () => {
  it("iguais dão 1, disjuntos dão 0", () => {
    const r = { x: 0, y: 0.16, width: 1, height: 0.63 };
    expect(rectIoU(r, r)).toBeCloseTo(1);
    expect(rectIoU({ x: 0, y: 0, width: 0.5, height: 0.5 }, { x: 0.5, y: 0.5, width: 0.5, height: 0.5 })).toBe(0);
  });

  it("duas detecções reais da mesma página ficam acima do limite de divergência", () => {
    // Valores do acervo: detecções automáticas de dois vídeos de @helmermovies.
    const a = { x: 0, y: 0.163, width: 1, height: 0.628 };
    const b = { x: 0, y: 0.175, width: 1, height: 0.603 };
    expect(rectIoU(a, b)).toBeGreaterThan(0.85);
  });

  it("perfil com o quadro inteiro é recusado", () => {
    expect(profileCropError({ x: 0, y: 0, width: 1, height: 1 })).not.toBeNull();
    expect(profileCropError({ x: 0, y: 0.1, width: 1, height: 0.7 })).toBeNull();
  });
});

// ------------------------------- Com banco ----------------------------------

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shortcta-editor-profile-"));

let dbMod: typeof import("../src/lib/db");
let repo: typeof import("../src/lib/repo");
let editorRepo: typeof import("../src/lib/editorRepo");
let apply: typeof import("../src/lib/editor/profileApply");

beforeAll(async () => {
  process.env.DATA_DIR = tmpDir;
  process.env.TRANSCRIPTION_PROVIDER = "none";
  process.env.VISION_PROVIDER = "none";
  dbMod = await import("../src/lib/db");
  repo = await import("../src/lib/repo");
  editorRepo = await import("../src/lib/editorRepo");
  apply = await import("../src/lib/editor/profileApply");
  dbMod.db();
});

afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // No Windows o SQLite pode segurar os arquivos WAL; a pasta fica no %TEMP%.
  }
});

let seq = 0;
function makeVideo(width: number, height: number, username = "helmermovies"): string {
  const name = `p${++seq}`;
  const filePath = path.join(tmpDir, `${name}.mp4`);
  fs.writeFileSync(filePath, "conteudo ficticio");
  const video = repo.createVideo({
    originalName: `${name}.mp4`,
    storedName: `${name}.mp4`,
    path: filePath,
    hash: `hash_${name}_${Math.random()}`,
    bytes: 17,
    mime: "video/mp4",
    source: {
      sourceFolder: `@${username}`,
      tiktokUsername: username,
      videoDate: null,
      platform: "tiktok",
      platformVideoId: null,
      originalUrl: null,
    },
  });
  repo.updateVideoMedia(video.id, {
    container: "mp4",
    durationSeconds: 10,
    width,
    height,
    aspectRatio: null,
    hasAudio: true,
    thumbnailPath: null,
  });
  editorRepo.addVideosToEditor([video.id]);
  return video.id;
}

const PROFILE_RECT = { x: 0, y: 0.17, width: 1, height: 0.62 };

function makeProfile() {
  return editorRepo.createSourceProfile({
    name: "@helmermovies (TikTok)",
    crop: PROFILE_RECT,
    originKey: "tiktok:helmermovies",
    aspect: 9 / 16,
  });
}

describe("aplicar perfil no banco", () => {
  it("vídeos da mesma página e resoluções diferentes recebem o mesmo recorte", () => {
    const profile = makeProfile();
    const ids = [makeVideo(720, 1280), makeVideo(576, 1024), makeVideo(1080, 1920)];

    const result = apply.applySourceProfile(profile.id, ids)!;
    expect(result.applied).toEqual(ids);
    for (const id of ids) {
      const crop = editorRepo.getVideoCrop(id)!;
      expect(crop.source).toBe("profile");
      expect(crop.profileId).toBe(profile.id);
      expect(crop.y).toBeCloseTo(0.17);
    }
  });

  it("vídeo de outra proporção fica de fora, com o motivo", () => {
    const profile = makeProfile();
    const quadrado = makeVideo(1080, 1080);
    const result = apply.applySourceProfile(profile.id, [quadrado])!;
    expect(result.applied).toEqual([]);
    expect(result.skipped[0].reason).toContain("1:1");
    expect(editorRepo.getVideoCrop(quadrado)).toBeNull();
  });

  it("recorte manual só é trocado quando pedido", () => {
    const profile = makeProfile();
    const id = makeVideo(720, 1280);
    const manual = { x: 0, y: 0.1, width: 1, height: 0.7, normalized: true, source: "manual" as const };
    editorRepo.saveVideoCrops([id], manual);

    const lote = apply.applySourceProfile(profile.id, [id])!;
    expect(lote.skipped[0].reason).toMatch(/manual/);
    expect(editorRepo.getVideoCrop(id)!.source).toBe("manual");

    const individual = apply.applySourceProfile(profile.id, [id], { replaceManual: true })!;
    expect(individual.applied).toEqual([id]);
    expect(editorRepo.getVideoCrop(id)!.source).toBe("profile");
  });

  it("aponta detecção automática que discorda do perfil, e aplica mesmo assim", () => {
    const profile = makeProfile();
    const parecido = makeVideo(720, 1280);
    const diferente = makeVideo(720, 1280);
    editorRepo.saveVideoCrops([parecido], {
      x: 0, y: 0.175, width: 1, height: 0.603, normalized: true, source: "auto", confidence: 83,
    });
    editorRepo.saveVideoCrops([diferente], {
      x: 0.1, y: 0.3, width: 0.8, height: 0.4, normalized: true, source: "auto", confidence: 70,
    });

    const result = apply.applySourceProfile(profile.id, [parecido, diferente])!;
    expect(result.applied).toEqual([parecido, diferente]);
    expect(result.divergent.map((d) => d.videoId)).toEqual([diferente]);
  });

  it("vídeo de outra página recebe quando escolhido, mas é relatado", () => {
    const profile = makeProfile();
    const outro = makeVideo(720, 1280, "outrapagina");
    const result = apply.applySourceProfile(profile.id, [outro])!;
    expect(result.applied).toEqual([outro]);
    expect(result.otherPage).toEqual([outro]);
  });

  it("recorte manual gravado por cima desfaz o vínculo com o perfil", () => {
    const profile = makeProfile();
    const id = makeVideo(720, 1280);
    apply.applySourceProfile(profile.id, [id]);
    editorRepo.saveVideoCrops([id], { ...PROFILE_RECT, y: 0.2, normalized: true, source: "manual" });
    expect(editorRepo.getVideoCrop(id)!.profileId).toBeNull();
  });

  it("atualizar o perfil não muda o recorte de quem já o recebeu", () => {
    const profile = makeProfile();
    const id = makeVideo(720, 1280);
    apply.applySourceProfile(profile.id, [id]);
    editorRepo.updateSourceProfile(profile.id, { crop: { x: 0, y: 0.3, width: 1, height: 0.4 } });
    expect(editorRepo.getVideoCrop(id)!.y).toBeCloseTo(0.17);
  });

  it("apagar o perfil mantém o recorte do vídeo e só desfaz o vínculo", () => {
    const profile = makeProfile();
    const id = makeVideo(720, 1280);
    apply.applySourceProfile(profile.id, [id]);
    expect(editorRepo.sourceProfileUsage()[profile.id]).toBe(1);

    editorRepo.deleteSourceProfile(profile.id);
    const crop = editorRepo.getVideoCrop(id)!;
    expect(crop.source).toBe("profile");
    expect(crop.profileId).toBeNull();
    expect(crop.y).toBeCloseTo(0.17);
    expect(editorRepo.getSourceProfile(profile.id)).toBeNull();
  });

  it("perfil inexistente devolve nulo, sem gravar nada", () => {
    const id = makeVideo(720, 1280);
    expect(apply.applySourceProfile("prf_nao_existe", [id])).toBeNull();
    expect(editorRepo.getVideoCrop(id)).toBeNull();
  });

  it("o job de exportação registra o perfil do recorte", async () => {
    const profile = makeProfile();
    const id = makeVideo(720, 1280);
    apply.applySourceProfile(profile.id, [id]);
    const template = editorRepo.createEditorTemplate("t", {
      canvasWidth: 1080, canvasHeight: 1920, videoX: 0, videoY: 0, videoWidth: 1080, videoHeight: 1920, fitMode: "fit",
    });
    editorRepo.setVideoTemplate([id], template.id);
    const { enqueueExports } = await import("../src/lib/editor/exportQueue");
    const { jobIds } = enqueueExports([id]);
    expect(editorRepo.getEditorJob(jobIds[0])!.profileId).toBe(profile.id);
    dbMod.db().prepare("DELETE FROM editor_jobs").run();
  });
});

describe("schema", () => {
  it("banco novo nasce com as colunas da Fase 9", () => {
    const cols = (t: string) =>
      (dbMod.db().pragma(`table_info(${t})`) as Array<{ name: string }>).map((c) => c.name);
    expect(cols("source_profiles")).toEqual(expect.arrayContaining(["origin_key", "aspect"]));
    expect(cols("editor_video_crops")).toContain("profile_id");
  });
});
