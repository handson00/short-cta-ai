import type { EvidenceBasis, Transcript } from "../types";

/**
 * Em que a análise e os CTAs de um vídeo se apoiaram: na fala ou não.
 *
 * Existe porque este projeto já perdeu dias com falha que parecia ausência: 95
 * vídeos foram analisados "surdos" com o painel dizendo "sem fala
 * compreensível", quando o provedor de transcrição é que estava quebrado. Aqui
 * as três situações nunca se confundem — cada uma pede uma ação diferente.
 */

/** Prefixo que `runner.ts` grava quando o provedor de transcrição falha. */
const FAILURE_PREFIX = "Transcrição indisponível:";

/** O motivo, quando a transcrição falhou; nulo quando ela rodou (com ou sem fala). */
export function transcriptFailure(transcript: Transcript | null | undefined): string | null {
  const warning = transcript?.warnings?.find((w) => w.startsWith(FAILURE_PREFIX));
  return warning ? warning.slice(FAILURE_PREFIX.length).trim() || "motivo não informado" : null;
}

export type CtaBasisKind =
  /** A análise ouviu a fala e montou o enredo a partir dela. */
  | "fala"
  /** Análise anterior ao enredo pela fala: a fala entrou só no resumo. */
  | "fala_versao_antiga"
  /** O vídeo não tem fala: a análise é a que dá para fazer. */
  | "sem_fala"
  /** A transcrição falhou: há fala que não foi ouvida — reanalisar resolve. */
  | "falha_transcricao"
  /** Sem transcrição registrada. */
  | "sem_transcricao";

export interface CtaBasis {
  kind: CtaBasisKind;
  /** O motivo da falha, quando houve. */
  detail: string | null;
}

export function ctaBasisOf(
  analysis: { evidenceBasis?: EvidenceBasis; plot: string | null } | null,
  transcript: Transcript | null | undefined,
): CtaBasis {
  const failure = transcriptFailure(transcript);
  if (failure) return { kind: "falha_transcricao", detail: failure };
  if (!transcript) return { kind: "sem_transcricao", detail: null };
  if (!transcript.hasSpeech) return { kind: "sem_fala", detail: null };
  // Com fala: só conta como "pela fala" a análise que declarou ter recebido a
  // fala. Uma análise antiga, feita antes deste prompt, não tem o enredo.
  if (analysis?.evidenceBasis === "dialogue") return { kind: "fala", detail: null };
  return { kind: "fala_versao_antiga", detail: null };
}
