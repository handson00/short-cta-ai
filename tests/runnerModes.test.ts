import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Os três modos do job e o reaproveitamento, no runner. O que isto trava: a
 * importação não pode gastar chamada paga, "Gerar CTAs" não pode refazer a
 * transcrição à toa, e transcrição que falhou nunca vira CTA "surdo".
 */

const mocks = vi.hoisted(() => {
  // Antes de qualquer import: env.ts lê DATA_DIR na carga. Sem isto, o runner
  // criava a pasta de artefatos do vídeo de teste dentro de ./data (o real).
  process.env.DATA_DIR = require("node:fs").mkdtempSync(
    require("node:path").join(require("node:os").tmpdir(), "shortcta-runner-modes-"),
  );
  class MockAiError extends Error {
    readonly code = "mock_ai_error";
    readonly retryable = false;
  }
  return {
    MockAiError,
    analyzeScene: vi.fn(),
    generateCtas: vi.fn(),
    aiProvider: vi.fn(),
    probe: vi.fn(),
    extractFrames: vi.fn(async () => ({ frames: [], skipped: 0 })),
    getTranscript: vi.fn(),
    getVisualAnalysis: vi.fn(),
    listFrames: vi.fn(),
    latestSceneAnalysis: vi.fn(),
    listSuggestions: vi.fn(() => [{ id: "cta1" }]),
    setJobStatus: vi.fn(),
    logAiRequest: vi.fn(),
    transcribe: vi.fn(),
    analyzeFrames: vi.fn(),
    extractAudio: vi.fn(async (_v: string, _o: string): Promise<string | null> => null),
    setStage: vi.fn(),
  };
});

const VIDEO_PATH = path.join(os.tmpdir(), "shortcta-runner-modes.mp4");
fs.writeFileSync(VIDEO_PATH, "x");

vi.mock("../src/lib/providers/ai", () => ({
  AiError: mocks.MockAiError,
  aiConfigured: () => true,
  aiProvider: mocks.aiProvider,
}));
vi.mock("../src/lib/providers/transcription", () => ({
  transcriptionProvider: () => ({ name: "t", transcribe: mocks.transcribe }),
}));
vi.mock("../src/lib/providers/vision", () => ({
  visionProvider: () => ({ name: "v", analyzeFrames: mocks.analyzeFrames }),
}));
vi.mock("../src/lib/providers/search", () => ({ searchProvider: () => ({ available: false }) }));
vi.mock("../src/lib/aiLog", () => ({ logAiRequest: mocks.logAiRequest }));
vi.mock("../src/lib/media/ffmpeg", () => ({
  probe: mocks.probe,
  extractThumbnail: vi.fn(async () => null),
  extractFrames: mocks.extractFrames,
  extractAudio: mocks.extractAudio,
}));
vi.mock("../src/lib/settings", () => ({
  AI_PROVIDER_LABEL: { ghostcli: "GhostCLI", gemini: "Google Gemini" },
  resolveAiProfile: () => ({ provider: "ghostcli", analysisModel: "m", generationModel: "m" }),
  getSettings: () => ({
    ai: { provider: "ghostcli" },
    ghostcli: { analysisModel: "m", generationModel: "m" },
    generation: { ctaCount: 6, language: "pt-BR", creativity: 0.7 },
    toggles: { analyzeExistingCta: true, identifyWork: false, spoilerPrevention: true, useExistingCtaAsReference: true, externalSearch: false },
    limits: { maxDurationSeconds: 300, maxFramesPerVideo: 12 },
  }),
}));
vi.mock("../src/lib/repo", () => ({
  getVideo: () => ({ id: "v1", path: VIDEO_PATH, durationSeconds: 10, aspectRatio: "9:16" }),
  isCancelRequested: () => false,
  setJobStatus: mocks.setJobStatus,
  updateVideoMedia: vi.fn(),
  replaceFrames: vi.fn(),
  saveTranscript: vi.fn(),
  saveVisualAnalysis: vi.fn(),
  getTranscript: mocks.getTranscript,
  getVisualAnalysis: mocks.getVisualAnalysis,
  listFrames: mocks.listFrames,
  effectiveExistingCta: () => null,
  listStyleExamples: () => [],
  latestSceneAnalysis: mocks.latestSceneAnalysis,
  saveSceneAnalysis: vi.fn(),
  saveWork: vi.fn(),
  getWork: () => null,
  listSuggestions: mocks.listSuggestions,
  replaceSuggestions: vi.fn(),
  updateSceneRecommendation: vi.fn(),
  setCtasInputHash: vi.fn(),
}));
vi.mock("../src/lib/pipeline/jobControl", () => ({ heartbeat: vi.fn(), setStage: mocks.setStage, releaseJob: vi.fn() }));

import { buildSceneContext, runJob } from "../src/lib/pipeline/runner";
import { analysisInputHash, generationInputHash } from "../src/lib/pipeline/aiCache";

const FALA = {
  provider: "t",
  language: "pt",
  text: "oi",
  segments: [{ start: 0, end: 1, text: "oi" }],
  hasSpeech: true,
  lowConfidence: false,
  warnings: [],
};
const FALHOU = { ...FALA, segments: [], hasSpeech: false, warnings: ["Transcrição indisponível: python errado"] };
const VISUAL = { provider: "v", visibleText: [], sceneDescription: null, visualClues: [], existingCta: null, limitations: [], manualCtaText: null };
const STORED = {
  id: "scn1",
  sceneSummary: "resumo",
  plot: null,
  keyLines: [],
  analysisLimitations: [],
  conflict: null,
  curiosity: null,
  withhold: null,
  speculation: [],
  existingCta: null,
  work: null,
  promptVersion: "x",
  model: "m",
  createdAt: "",
  recommended: null,
  inputHash: null as string | null,
  ctasInputHash: null as string | null,
};

const job = (mode: "full" | "local" | "ai") => ({ id: "j1", videoId: "v1", attempts: 1, maxAttempts: 3, reuseScene: false, mode });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.probe.mockResolvedValue({ hasVideo: true, hasAudio: false, durationSeconds: 10, width: 720, height: 1280, aspectRatio: "9:16", container: "mp4" });
  mocks.getTranscript.mockReturnValue(FALA);
  mocks.getVisualAnalysis.mockReturnValue(VISUAL);
  mocks.listFrames.mockReturnValue([{ id: "f", path: "p", timestampSeconds: 0 }]);
  mocks.latestSceneAnalysis.mockReturnValue({ ...STORED });
  mocks.analyzeScene.mockResolvedValue({ ...STORED });
  mocks.generateCtas.mockResolvedValue({ recommendedCta: { text: "A", reason: "r" }, suggestions: [{ text: "A", style: "curiosidade" }] });
  mocks.aiProvider.mockReturnValue({ analyzeScene: mocks.analyzeScene, generateCtas: mocks.generateCtas });
  mocks.analyzeFrames.mockResolvedValue({ provider: "v", visibleText: [], sceneDescription: null, visualClues: [], existingCta: null, limitations: [] });
  mocks.extractAudio.mockResolvedValue(null);
});

describe("modos do job", () => {
  it("importação (local) faz a parte local e para antes de qualquer chamada paga", async () => {
    await runJob(job("local"));
    expect(mocks.probe).toHaveBeenCalled();
    expect(mocks.aiProvider).not.toHaveBeenCalled();
    expect(mocks.setJobStatus).toHaveBeenCalledWith("j1", "awaiting_ai");
    expect(mocks.setJobStatus).not.toHaveBeenCalledWith("j1", "done");
  });

  it("'Gerar CTAs' (ai) pula a parte local já feita e chama a IA", async () => {
    await runJob(job("ai"));
    expect(mocks.probe).not.toHaveBeenCalled();
    expect(mocks.analyzeScene).toHaveBeenCalled();
    expect(mocks.generateCtas).toHaveBeenCalled();
    expect(mocks.setJobStatus).toHaveBeenCalledWith("j1", "done");
  });

  it("'Gerar CTAs' com a transcrição falhada refaz a parte local antes", async () => {
    mocks.getTranscript.mockReturnValue(FALHOU);
    await runJob(job("ai"));
    expect(mocks.probe).toHaveBeenCalled();
  });
});

describe("reaproveitamento", () => {
  it("análise com a mesma entrada não chama a IA", async () => {
    const hash = analysisInputHash(buildSceneContext({ id: "v1", durationSeconds: 10, aspectRatio: "9:16" } as never), "m", false);
    mocks.latestSceneAnalysis.mockReturnValue({ ...STORED, inputHash: hash });
    await runJob(job("ai"));
    expect(mocks.analyzeScene).not.toHaveBeenCalled();
    expect(mocks.logAiRequest).toHaveBeenCalledWith(expect.objectContaining({ operation: "analyze_scene", status: "cache" }));
  });

  it("geração com a mesma entrada não chama a IA nem refaz as sugestões", async () => {
    const options = { count: 6, language: "pt-BR", creativity: 0.7, avoidSpoilers: true, useExistingCtaAsReference: true, styleExamples: [] };
    const aHash = analysisInputHash(buildSceneContext({ id: "v1", durationSeconds: 10, aspectRatio: "9:16" } as never), "m", false);
    const gHash = generationInputHash({ ...STORED, inputHash: aHash } as never, options, FALA as never, "m");
    mocks.latestSceneAnalysis.mockReturnValue({ ...STORED, inputHash: aHash, ctasInputHash: gHash });
    await runJob(job("ai"));
    expect(mocks.generateCtas).not.toHaveBeenCalled();
    expect(mocks.setJobStatus).toHaveBeenCalledWith("j1", "done");
  });

  it("'Regenerar CTAs' sempre chama, mesmo com a entrada igual", async () => {
    mocks.latestSceneAnalysis.mockReturnValue({ ...STORED, ctasInputHash: "qualquer" });
    await runJob({ ...job("full"), reuseScene: true });
    expect(mocks.generateCtas).toHaveBeenCalled();
  });
});

describe("fala e texto na tela ao mesmo tempo", () => {
  const withAudio = () => {
    mocks.probe.mockResolvedValue({ hasVideo: true, hasAudio: true, durationSeconds: 10, width: 720, height: 1280, aspectRatio: "9:16", container: "mp4" });
    mocks.extractAudio.mockImplementation(async (_v: string, out: string) => {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, "wav");
      return out;
    });
  };

  it("o OCR começa sem esperar a transcrição terminar", async () => {
    withAudio();
    let finishTranscription!: (t: unknown) => void;
    mocks.transcribe.mockReturnValue(new Promise((r) => (finishTranscription = r)));
    let ocrStartedDuringTranscription = false;
    mocks.analyzeFrames.mockImplementation(async () => {
      ocrStartedDuringTranscription = true;
      return { provider: "v", visibleText: [], sceneDescription: null, visualClues: [], existingCta: null, limitations: [] };
    });

    const running = runJob(job("local"));
    await vi.waitFor(() => expect(mocks.transcribe).toHaveBeenCalled());
    await vi.waitFor(() => expect(ocrStartedDuringTranscription).toBe(true));
    finishTranscription(FALA);
    await running;

    expect(mocks.setJobStatus).toHaveBeenCalledWith("j1", "awaiting_ai");
    // O OCR terminou antes: a etapa mostrada não troca para "Lendo texto".
    expect(mocks.setStage).not.toHaveBeenCalledWith("j1", "reading_text");
  });

  it("OCR mais lento que a fala: a etapa mostrada passa a ser 'Lendo texto'", async () => {
    withAudio();
    mocks.transcribe.mockResolvedValue(FALA);
    let finishOcr!: (v: unknown) => void;
    mocks.analyzeFrames.mockReturnValue(new Promise((r) => (finishOcr = r)));
    const running = runJob(job("local"));
    await vi.waitFor(() => expect(mocks.setStage).toHaveBeenCalledWith("j1", "reading_text"));
    expect(mocks.transcribe).toHaveBeenCalled();
    finishOcr({ provider: "v", visibleText: [], sceneDescription: null, visualClues: [], existingCta: null, limitations: [] });
    await running;
    expect(mocks.setJobStatus).toHaveBeenCalledWith("j1", "awaiting_ai");
  });
});
