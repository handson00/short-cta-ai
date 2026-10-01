import crypto from "node:crypto";
import {
  analysisSystemPrompt,
  buildAnalysisUserMessage,
  buildGenerationUserMessage,
  generationSystemPrompt,
  PROMPT_VERSION,
} from "../prompts";
import type { CtaOptions, SceneAnalysis, SceneContext, Transcript } from "../types";

/**
 * Impressão digital do que iria para a IA.
 *
 * Se a próxima análise (ou geração) mandaria EXATAMENTE o mesmo texto ao mesmo
 * modelo, a resposta salva é reaproveitada e nenhuma chamada paga é feita. O
 * hash sai das mesmas funções que montam o prompt de verdade — não de uma
 * "versão resumida" dos dados —, então mudar qualquer coisa que o modelo veria
 * (uma fala, o texto na tela, o prompt, a quantidade de CTAs, a criatividade)
 * muda o hash e a chamada acontece.
 */
function hash(parts: unknown[]): string {
  return crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function analysisInputHash(context: SceneContext, model: string, allowSearch: boolean): string {
  return hash([
    "analysis",
    PROMPT_VERSION,
    model,
    allowSearch,
    analysisSystemPrompt(),
    buildAnalysisUserMessage(context),
  ]);
}

export function generationInputHash(
  analysis: SceneAnalysis,
  options: CtaOptions,
  transcript: Transcript | null,
  model: string,
): string {
  return hash([
    "generation",
    PROMPT_VERSION,
    model,
    options,
    generationSystemPrompt(options),
    buildGenerationUserMessage(analysis, options, transcript),
  ]);
}
