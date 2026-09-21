import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockAiError extends Error {
    readonly code = "mock_ai_error";
    readonly retryable = true;
  }

  return {
    MockAiError,
    aiConfigured: vi.fn(() => true),
    aiProvider: vi.fn(),
    generateCtas: vi.fn(),
    getVideo: vi.fn(),
    isCancelRequested: vi.fn(),
    latestSceneAnalysis: vi.fn(),
    listStyleExamples: vi.fn(() => []),
    getVisualAnalysis: vi.fn(() => null),
    effectiveExistingCta: vi.fn(() => null),
    replaceSuggestions: vi.fn(),
    updateSceneRecommendation: vi.fn(),
    setJobStatus: vi.fn(),
    setStage: vi.fn(),
    releaseJob: vi.fn(),
  };
});

vi.mock("../src/lib/providers/ai", () => ({
  AiError: mocks.MockAiError,
  aiConfigured: mocks.aiConfigured,
  aiProvider: mocks.aiProvider,
}));

vi.mock("../src/lib/settings", () => ({
  getSettings: () => ({
    ghostcli: { analysisModel: "analysis-model" },
    generation: { ctaCount: 3, language: "pt-BR", creativity: 0.7 },
    toggles: {
      analyzeExistingCta: true,
      identifyWork: true,
      spoilerPrevention: true,
      useExistingCtaAsReference: true,
    },
    limits: { maxDurationSeconds: 300, maxFramesPerVideo: 12 },
  }),
}));

vi.mock("../src/lib/repo", () => ({
  getVideo: mocks.getVideo,
  isCancelRequested: mocks.isCancelRequested,
  latestSceneAnalysis: mocks.latestSceneAnalysis,
  listStyleExamples: mocks.listStyleExamples,
  getVisualAnalysis: mocks.getVisualAnalysis,
  effectiveExistingCta: mocks.effectiveExistingCta,
  replaceSuggestions: mocks.replaceSuggestions,
  updateSceneRecommendation: mocks.updateSceneRecommendation,
  setJobStatus: mocks.setJobStatus,
}));

vi.mock("../src/lib/pipeline/jobControl", () => ({
  heartbeat: vi.fn(),
  setStage: mocks.setStage,
  releaseJob: mocks.releaseJob,
}));

import { runJob } from "../src/lib/pipeline/runner";

const JOB = {
  id: "job-1",
  videoId: "video-1",
  attempts: 1,
  maxAttempts: 3,
  reuseScene: true,
};

describe("cancelamento no fim do pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getVideo.mockReturnValue({ id: JOB.videoId });
    mocks.latestSceneAnalysis.mockReturnValue({
      id: "scene-1",
      sceneSummary: "Cena de teste",
      analysisLimitations: [],
      conflict: null,
      curiosity: null,
      withhold: null,
      speculation: [],
      existingCta: null,
      work: null,
      promptVersion: "test",
      model: "test",
      createdAt: new Date(0).toISOString(),
      recommended: null,
    });
    mocks.aiProvider.mockReturnValue({ generateCtas: mocks.generateCtas });
  });

  it("não sobrescreve com done um cancelamento solicitado durante a geração", async () => {
    mocks.isCancelRequested.mockReturnValueOnce(false).mockReturnValueOnce(true);
    mocks.generateCtas.mockResolvedValue({
      recommendedCta: { text: "Gancho de teste", reason: "Motivo de teste" },
      suggestions: [{ text: "Gancho de teste", style: "curiosidade" }],
    });

    await runJob(JOB);

    expect(mocks.setJobStatus).toHaveBeenCalledWith(JOB.id, "canceled");
    expect(mocks.setJobStatus).not.toHaveBeenCalledWith(JOB.id, "done");
  });

  it("não devolve para queued uma falha ocorrida depois do pedido de cancelamento", async () => {
    mocks.isCancelRequested.mockReturnValueOnce(false).mockReturnValueOnce(true);
    mocks.generateCtas.mockRejectedValue(new Error("falha concorrente"));

    await runJob(JOB);

    expect(mocks.setJobStatus).toHaveBeenCalledWith(JOB.id, "canceled");
    expect(mocks.setJobStatus).not.toHaveBeenCalledWith(
      JOB.id,
      "queued",
      expect.anything(),
    );
  });
});
