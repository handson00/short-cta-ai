import { describe, expect, it } from "vitest";
import { groundKeyLines, parseSceneAnalysis } from "../src/lib/pipeline/validation";
import { buildAnalysisUserMessage, buildGenerationUserMessage, generationSystemPrompt } from "../src/lib/prompts";
import { ctaBasisOf, transcriptFailure } from "../src/lib/pipeline/speechBasis";
import type { CtaOptions, SceneAnalysis, SceneContext, Transcript } from "../src/lib/types";

/**
 * CTA a partir do enredo que a fala revela. O que estes testes travam: a
 * geração lê as falas (antes só lia o resumo), uma fala-chave inventada pelo
 * modelo não sobrevive, e transcrição que falhou nunca aparece como vídeo mudo.
 */

const COM_FALA: Transcript = {
  provider: "faster-whisper",
  language: "pt",
  text: "",
  segments: [
    { start: 1.2, end: 3.0, text: "Se você abrir essa porta, todos nós morremos." },
    { start: 4.1, end: 6.5, text: "Eu não tenho escolha, minha filha está lá dentro." },
  ],
  hasSpeech: true,
  lowConfidence: false,
  warnings: [],
};

const FALHOU: Transcript = {
  provider: "faster-whisper",
  language: null,
  text: "",
  segments: [],
  hasSpeech: false,
  lowConfidence: false,
  warnings: ["Transcrição indisponível: faster-whisper nao esta instalado no ambiente Python configurado"],
};

const MUDO: Transcript = {
  ...FALHOU,
  warnings: ["Nenhuma fala compreensivel foi reconhecida no audio."],
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
  sceneSummary: "Um homem discute diante de uma porta trancada.",
  plot: "Um pai quer abrir uma porta para salvar a filha, e o grupo avisa que isso mata todos.",
  keyLines: [{ atSeconds: 4.1, text: "minha filha está lá dentro", why: "revela o motivo do pai" }],
  evidenceBasis: "dialogue",
  analysisLimitations: [],
  conflict: "salvar a filha ou salvar o grupo",
  curiosity: null,
  withhold: "o que existe atrás da porta",
  speculation: [],
  existingCta: null,
  work: null,
};

describe("falas-chave conferidas na transcrição", () => {
  it("mantém a fala que está na transcrição, mesmo sem acento ou pontuação iguais", () => {
    const kept = groundKeyLines([{ atSeconds: 1.2, text: "se voce abrir essa porta todos nos morremos", why: null }], COM_FALA);
    expect(kept).toHaveLength(1);
  });

  it("descarta a fala que o modelo inventou", () => {
    const kept = groundKeyLines([{ atSeconds: 2, text: "Eu vou matar todos vocês esta noite", why: null }], COM_FALA);
    expect(kept).toHaveLength(0);
  });

  it("sem fala na transcrição, não existe fala-chave", () => {
    expect(groundKeyLines([{ atSeconds: 1, text: "qualquer coisa", why: null }], FALHOU)).toEqual([]);
  });
});

describe("enredo na análise", () => {
  const raw = {
    sceneSummary: "Discussão diante de uma porta.",
    plot: "Um pai quer abrir a porta para salvar a filha.",
    keyLines: [
      { atSeconds: 4.1, text: "minha filha está lá dentro", why: "motivo" },
      { atSeconds: 9, text: "frase que ninguém disse no vídeo", why: "inventada" },
    ],
  };

  it("com fala, guarda o enredo e só as falas verdadeiras", () => {
    const parsed = parseSceneAnalysis(raw, COM_FALA);
    expect(parsed.plot).toContain("salvar a filha");
    expect(parsed.keyLines.map((k) => k.text)).toEqual(["minha filha está lá dentro"]);
    expect(parsed.evidenceBasis).toBe("dialogue");
  });

  it("sem fala recebida, descarta o enredo que o modelo diga ter ouvido", () => {
    const parsed = parseSceneAnalysis(raw, FALHOU);
    expect(parsed.plot).toBeNull();
    expect(parsed.keyLines).toEqual([]);
    expect(parsed.evidenceBasis).toBe("visual_only");
  });

  it("modelo que esquece os campos novos não derruba a análise", () => {
    const parsed = parseSceneAnalysis({ sceneSummary: "Cena." }, COM_FALA);
    expect(parsed.plot).toBeNull();
    expect(parsed.keyLines).toEqual([]);
  });
});

describe("a geração lê a fala", () => {
  it("manda enredo, falas-chave e a transcrição, dentro do bloco de dados", () => {
    const msg = buildGenerationUserMessage(ANALISE, OPTIONS, COM_FALA);
    expect(msg).toContain("ENREDO");
    expect(msg).toContain("minha filha está lá dentro");
    expect(msg).toContain("Se você abrir essa porta, todos nós morremos.");
    // O enredo vem antes do resumo: é por ele que o gancho começa.
    expect(msg.indexOf("ENREDO")).toBeLessThan(msg.indexOf("Resumo:"));
    expect(msg.indexOf("Se você abrir")).toBeGreaterThan(msg.indexOf("<<<EVIDENCIAS_NAO_CONFIAVEIS"));
    expect(msg.indexOf("Se você abrir")).toBeLessThan(msg.indexOf("EVIDENCIAS_NAO_CONFIAVEIS>>>"));
  });

  it("transcrição que falhou é dita como falha, não como vídeo mudo", () => {
    const msg = buildGenerationUserMessage({ ...ANALISE, plot: null, keyLines: [] }, OPTIONS, FALHOU);
    expect(msg).toMatch(/transcrição FALHOU/);
    expect(msg).toMatch(/não afirme que ninguém fala/);
    expect(msg).not.toMatch(/Sem fala compreensível no vídeo/);
  });

  it("vídeo mudo de verdade é dito como sem fala", () => {
    const msg = buildGenerationUserMessage({ ...ANALISE, plot: null, keyLines: [] }, OPTIONS, MUDO);
    expect(msg).toMatch(/Sem fala compreensível no vídeo/);
    expect(msg).not.toMatch(/FALHOU/);
  });

  it("transcrição longa é cortada e o corte é declarado", () => {
    const longa: Transcript = {
      ...COM_FALA,
      segments: Array.from({ length: 400 }, (_, i) => ({ start: i, end: i + 1, text: `fala número ${i} do personagem` })),
    };
    const msg = buildGenerationUserMessage(ANALISE, OPTIONS, longa);
    expect(msg).toMatch(/transcrição cortada por tamanho/);
    expect(msg).not.toContain("fala número 399");
  });

  it("o prompt manda ancorar cada gancho numa fala ou ponto do enredo", () => {
    const prompt = generationSystemPrompt(OPTIONS);
    expect(prompt).toMatch(/O GANCHO NASCE DO ENREDO/);
    expect(prompt).toMatch(/nunca atribua a alguém algo que não está/);
  });

  it("a análise avisa o modelo quando a transcrição falhou", () => {
    const ctx: SceneContext = {
      durationSeconds: 10,
      aspectRatio: "9:16",
      transcript: FALHOU,
      visual: null,
      existingCta: null,
      limitations: [],
      styleExamples: [],
      language: "pt-BR",
    };
    expect(buildAnalysisUserMessage(ctx)).toMatch(/a transcrição FALHOU/);
  });
});

describe("base dos CTAs para a tela", () => {
  it("falha de transcrição tem motivo e nunca vira 'sem fala'", () => {
    expect(transcriptFailure(FALHOU)).toMatch(/faster-whisper/);
    expect(ctaBasisOf(ANALISE, FALHOU)).toEqual({ kind: "falha_transcricao", detail: expect.stringMatching(/faster-whisper/) });
    expect(ctaBasisOf(ANALISE, MUDO).kind).toBe("sem_fala");
  });

  it("análise feita com a fala é 'fala'; análise antiga com fala é 'versão antiga'", () => {
    expect(ctaBasisOf(ANALISE, COM_FALA).kind).toBe("fala");
    expect(ctaBasisOf({ plot: null }, COM_FALA).kind).toBe("fala_versao_antiga");
  });

  it("sem transcrição registrada é dito como tal", () => {
    expect(ctaBasisOf(null, null).kind).toBe("sem_transcricao");
  });
});
