import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rankHashtags } from "../src/lib/pipeline/hashtagRank";
import { analysisInputHash, generationInputHash } from "../src/lib/pipeline/aiCache";
import { speechAnchor, validateCtaResult } from "../src/lib/pipeline/validation";
import type { CtaOptions, SceneAnalysis, SceneContext, Transcript } from "../src/lib/types";

/**
 * Economia de chamadas pagas (2026-09-29): IA só quando o usuário pede,
 * resultado reaproveitado quando nada mudou, hashtags sem IA, e o CTA principal
 * sempre de curiosidade apoiado na fala.
 */

const FALA: Transcript = {
  provider: "faster-whisper",
  language: "pt",
  text: "",
  segments: [
    { start: 0, end: 3, text: "Alexander embarcou novamente na máquina do tempo." },
    { start: 3, end: 6, text: "Apenas sete anos depois, a cidade está em ruínas." },
  ],
  hasSpeech: true,
  lowConfidence: false,
  warnings: [],
};

const OPTIONS: CtaOptions = {
  count: 6,
  language: "pt-BR",
  creativity: 0.7,
  avoidSpoilers: true,
  useExistingCtaAsReference: true,
  styleExamples: [],
};

const ANALISE: SceneAnalysis = {
  sceneSummary: "Um viajante do tempo encontra o futuro destruído.",
  plot: "Alexander viaja no tempo e descobre que a cidade virou ruínas em sete anos.",
  keyLines: [],
  evidenceBasis: "dialogue",
  analysisLimitations: [],
  conflict: "o que destruiu a cidade",
  curiosity: null,
  withhold: "a causa da destruição",
  speculation: [],
  existingCta: null,
  work: null,
};

describe("hashtags recomendadas, sem IA", () => {
  const capturadas = {
    doVideo: ["#fyp", "#maquinadotempo", "#filmes"],
    nosComentarios: [
      { tag: "#viral", vezes: 30 },
      { tag: "#filmes", vezes: 4 },
      { tag: "#ficcao", vezes: 1 },
    ],
  };

  it("devolve só 2, sem as genéricas, cada uma com o motivo", () => {
    const top = rankHashtags(capturadas, { cta: "⏳ ELE VOLTOU NA MÁQUINA DO TEMPO…", plot: null, transcript: null });
    expect(top).toHaveLength(2);
    expect(top.map((h) => h.tag)).not.toContain("#fyp");
    expect(top.map((h) => h.tag)).not.toContain("#viral");
    expect(top.every((h) => h.reasons.length > 0)).toBe(true);
  });

  it("a que fala do mesmo que o CTA sobe", () => {
    const top = rankHashtags(capturadas, { cta: "⏳ ELE VOLTOU NA MÁQUINA DO TEMPO…", plot: null, transcript: null });
    expect(top[0].tag).toBe("#maquinadotempo");
    expect(top[0].reasons).toContain("fala do mesmo que o CTA");
  });

  it("sem ligação com o conteúdo, vale o post original somado aos comentários", () => {
    const top = rankHashtags(capturadas, { cta: null, plot: null, transcript: null });
    expect(top[0].tag).toBe("#filmes");
  });

  it("sem captura, nenhuma é inventada", () => {
    expect(rankHashtags(null, { cta: "x", plot: null, transcript: null })).toEqual([]);
    expect(rankHashtags({ doVideo: ["#fyp"], nosComentarios: [] }, { cta: null, plot: null, transcript: null })).toEqual([]);
  });
});

describe("impressão digital do que vai para a IA", () => {
  const ctx: SceneContext = {
    durationSeconds: 60,
    aspectRatio: "9:16",
    transcript: FALA,
    visual: null,
    existingCta: null,
    limitations: [],
    styleExamples: [],
    language: "pt-BR",
  };

  it("mesma entrada, mesmo hash", () => {
    expect(analysisInputHash(ctx, "m", false)).toBe(analysisInputHash({ ...ctx }, "m", false));
    expect(generationInputHash(ANALISE, OPTIONS, FALA, "m")).toBe(generationInputHash(ANALISE, OPTIONS, FALA, "m"));
  });

  it("qualquer coisa que o modelo veria muda o hash", () => {
    const base = analysisInputHash(ctx, "m", false);
    const outraFala = { ...FALA, segments: [{ start: 0, end: 1, text: "outra fala" }] };
    expect(analysisInputHash({ ...ctx, transcript: outraFala }, "m", false)).not.toBe(base);
    expect(analysisInputHash(ctx, "outro-modelo", false)).not.toBe(base);

    const g = generationInputHash(ANALISE, OPTIONS, FALA, "m");
    expect(generationInputHash(ANALISE, { ...OPTIONS, creativity: 0.2 }, FALA, "m")).not.toBe(g);
    expect(generationInputHash(ANALISE, { ...OPTIONS, count: 8 }, FALA, "m")).not.toBe(g);
    expect(generationInputHash(ANALISE, OPTIONS, null, "m")).not.toBe(g);
  });
});

describe("CTA principal: curiosidade apoiada na fala", () => {
  const sugestoes = [
    { text: "⚠️ ELE NÃO TINHA COMO SAIR DALI", style: "suspense" },
    { text: "😱 O QUE DESTRUIU A CIDADE EM SETE ANOS?", style: "curiosidade" },
    { text: "🤔 NINGUÉM ESPERAVA ESSA ESCOLHA", style: "curiosidade" },
    { text: "💥 A VIAGEM MUDOU TUDO", style: "reviravolta" },
    { text: "💔 A ÚLTIMA CHANCE DELE", style: "emocional" },
    { text: "⏳ SETE ANOS BASTARAM", style: "ultracurto" },
  ];

  it("recomendação de suspense vira a curiosidade ancorada na fala", () => {
    const r = validateCtaResult(
      { recommendedCta: { text: sugestoes[0].text, reason: "tensão" }, suggestions: sugestoes },
      OPTIONS,
      ANALISE,
      FALA,
    );
    expect(r.recommendedCta.text).toBe("😱 O QUE DESTRUIU A CIDADE EM SETE ANOS?");
    expect(r.recommendationReplaced).toBe(true);
  });

  it("curiosidade que não toca na fala perde para a que toca", () => {
    const r = validateCtaResult(
      { recommendedCta: { text: sugestoes[2].text, reason: "curiosidade" }, suggestions: sugestoes },
      OPTIONS,
      ANALISE,
      FALA,
    );
    expect(r.recommendedCta.text).toBe("😱 O QUE DESTRUIU A CIDADE EM SETE ANOS?");
  });

  it("escolha do modelo que já é curiosidade ancorada é mantida", () => {
    const r = validateCtaResult(
      { recommendedCta: { text: sugestoes[1].text, reason: "a fala dos sete anos" }, suggestions: sugestoes },
      OPTIONS,
      ANALISE,
      FALA,
    );
    expect(r.recommendedCta.text).toBe(sugestoes[1].text);
    expect(r.recommendationReplaced).toBe(false);
  });

  it("palavra comum não conta como apoio na fala", () => {
    const heard = new Set(["ESTA", "CIDADE"]);
    expect(speechAnchor("ESTA HISTÓRIA", heard)).toBe(0);
    expect(speechAnchor("A CIDADE CAIU", heard)).toBe(1);
  });
});

// ------------------------------- Com banco ----------------------------------

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shortcta-ia-sob-demanda-"));
let dbMod: typeof import("../src/lib/db");
let repo: typeof import("../src/lib/repo");

beforeAll(async () => {
  process.env.DATA_DIR = tmpDir;
  process.env.TRANSCRIPTION_PROVIDER = "none";
  process.env.VISION_PROVIDER = "none";
  dbMod = await import("../src/lib/db");
  repo = await import("../src/lib/repo");
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
function makeVideo(): string {
  const name = `d${++seq}`;
  const filePath = path.join(tmpDir, `${name}.mp4`);
  fs.writeFileSync(filePath, "x");
  return repo.createVideo({
    originalName: `${name}.mp4`,
    storedName: `${name}.mp4`,
    path: filePath,
    hash: `h_${name}_${Math.random()}`,
    bytes: 1,
    mime: "video/mp4",
  }).id;
}

describe("jobs por modo", () => {
  it("o modo do job é gravado e lido", () => {
    const id = makeVideo();
    expect(repo.createJob(id, { mode: "local" }).mode).toBe("local");
    const outro = makeVideo();
    expect(repo.createJob(outro).mode).toBe("full");
  });

  it("'Gerar CTAs' num vídeo aguardando cria um job só de IA", () => {
    const id = makeVideo();
    repo.setJobStatus(repo.createJob(id, { mode: "local" }).id, "awaiting_ai");
    const r = repo.requestReanalysis([id], "ai");
    expect(r.queued).toEqual([id]);
    expect(repo.latestJob(id)?.mode).toBe("ai");
  });

  it("vídeo aguardando CTA não tem o que cancelar", () => {
    const id = makeVideo();
    repo.setJobStatus(repo.createJob(id, { mode: "local" }).id, "awaiting_ai");
    expect(repo.requestCancel(id)).toBe(false);
  });
});

describe("envio da extensão em pedaços", () => {
  it("o segundo pedaço soma aos comentários em vez de apagar o primeiro", () => {
    const id = makeVideo();
    repo.replaceComments(id, "tiktok", [{ text: "primeiro" }, { text: "segundo" }]);
    repo.replaceComments(id, "tiktok", [{ text: "terceiro" }], { append: true });
    expect(repo.getComments(id).map((c) => c.text)).toEqual(["primeiro", "segundo", "terceiro"]);
  });

  it("uma captura nova (sem append) ainda substitui a anterior", () => {
    const id = makeVideo();
    repo.replaceComments(id, "tiktok", [{ text: "velho" }]);
    repo.replaceComments(id, "tiktok", [{ text: "novo" }]);
    expect(repo.getComments(id).map((c) => c.text)).toEqual(["novo"]);
  });

  it("pedaço com hashtags vazias não apaga as do primeiro pedaço", () => {
    const id = makeVideo();
    repo.saveVideoHashtags(id, { doVideo: ["#filmes"], nosComentarios: [], todas: ["#filmes"] });
    repo.saveVideoHashtags(id, { doVideo: [], nosComentarios: [], todas: [] });
    expect(repo.getVideoHashtags(id)?.doVideo).toEqual(["#filmes"]);
  });

  it("ler hashtags de vídeo sem captura não quebra (a tabela existe desde o início)", () => {
    expect(repo.getVideoHashtags(makeVideo())).toBeNull();
  });
});
