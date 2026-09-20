// ---------------------------------------------------------------------------
// Tipos de dominio compartilhados entre pipeline, API e interface.
// ---------------------------------------------------------------------------

export const JOB_STATUSES = [
  "queued",
  "extracting_media",
  "transcribing",
  "reading_text",
  "analyzing_scene",
  "identifying_work",
  "generating_ctas",
  "done",
  "error",
  "canceled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const ACTIVE_STATUSES: JobStatus[] = [
  "extracting_media",
  "transcribing",
  "reading_text",
  "analyzing_scene",
  "identifying_work",
  "generating_ctas",
];

export const STATUS_LABEL: Record<JobStatus, string> = {
  queued: "Aguardando",
  extracting_media: "Extraindo mídia",
  transcribing: "Transcrevendo",
  reading_text: "Lendo texto",
  analyzing_scene: "Analisando cena",
  identifying_work: "Identificando obra",
  generating_ctas: "Gerando CTAs",
  done: "Concluído",
  error: "Erro",
  canceled: "Cancelado",
};

export type Confidence = "high" | "medium" | "low";

export const CTA_STYLES = [
  "curiosidade",
  "suspense",
  "conflito",
  "reviravolta",
  "emocional",
  "ultracurto",
] as const;
export type CtaStyle = (typeof CTA_STYLES)[number];

export const STYLE_LABEL: Record<CtaStyle, string> = {
  curiosidade: "Curiosidade",
  suspense: "Suspense",
  conflito: "Conflito",
  reviravolta: "Reviravolta",
  emocional: "Emocional",
  ultracurto: "Ultracurto",
};

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  /** dialogo | narracao | sem_fala — quando o provedor souber distinguir. */
  kind?: "dialogue" | "narration" | "unknown";
  lowConfidence?: boolean;
}

export interface Transcript {
  provider: string;
  language: string | null;
  text: string;
  segments: TranscriptSegment[];
  hasSpeech: boolean;
  lowConfidence: boolean;
  warnings: string[];
}

export type TextRegion = "top" | "middle" | "bottom";
export type TextKind =
  | "possible_hook"
  | "possible_subtitle"
  | "possible_watermark"
  | "possible_handle"
  | "unknown";

export interface VisibleText {
  text: string;
  timestampSeconds: number;
  region: TextRegion;
  type: TextKind;
  /** 0..1, confianca do OCR. */
  ocrConfidence: number;
  /** Fracao da largura do quadro ocupada pelo bloco. */
  relativeHeight?: number;
  /** Em quantos frames o mesmo texto reapareceu. */
  persistence?: number;
}

export interface VisualAnalysis {
  provider: string;
  visibleText: VisibleText[];
  sceneDescription: string | null;
  visualClues: string[];
  existingCta: ExistingCtaDetection | null;
  limitations: string[];
}

export interface ExistingCtaDetection {
  text: string;
  confidence: Confidence;
  firstSeenAtSeconds: number;
  reasons: string[];
}

export interface SearchEvidence {
  title: string;
  snippet: string;
  url: string | null;
  source: string;
}

export interface WorkIdentification {
  title: string | null;
  originalTitle: string | null;
  year: number | null;
  mediaType: "movie" | "series" | null;
  confidence: Confidence;
  evidence: string[];
  sources: string[];
  status: "identified" | "not_identified_safely";
  manuallyCorrected?: boolean;
}

/** Tudo o que o modelo recebe. Nada aqui e instrucao: e evidencia. */
export interface SceneContext {
  durationSeconds: number;
  aspectRatio: string | null;
  transcript: Transcript | null;
  visual: VisualAnalysis | null;
  existingCta: ExistingCtaDetection | null;
  limitations: string[];
  styleExamples: string[];
  language: string;
}

export interface SceneAnalysis {
  sceneSummary: string;
  analysisLimitations: string[];
  conflict: string | null;
  curiosity: string | null;
  withhold: string | null;
  speculation: string[];
  existingCta: {
    text: string;
    confidence: Confidence;
    firstSeenAtSeconds: number | null;
    strength: string | null;
    possibleImprovement: string | null;
  } | null;
  work: WorkIdentification | null;
  /** Contexto original preservado para reaproveitar em "Regenerar CTAs". */
  context?: SceneContext;
}

export interface CtaSuggestion {
  text: string;
  style: CtaStyle;
  reason?: string | null;
}

export interface CtaResult {
  recommendedCta: { text: string; reason: string };
  suggestions: CtaSuggestion[];
}

export interface CtaOptions {
  count: number;
  language: string;
  creativity: number;
  avoidSpoilers: boolean;
  useExistingCtaAsReference: boolean;
  styleExamples: string[];
}

// --------------------------- Interfaces de provedor -------------------------

export interface AIProvider {
  analyzeScene(input: SceneContext): Promise<SceneAnalysis>;
  generateCtas(input: SceneAnalysis, options: CtaOptions): Promise<CtaResult>;
  /** Ganchos apoiados na reação do público, não na descrição da cena. */
  generateCtasFromComments(
    insights: import("./pipeline/commentInsights").CommentInsights,
    analysis: SceneAnalysis | null,
    count: number,
  ): Promise<import("./pipeline/validation").CommentCtaResult>;
  /** Legenda e hashtags, segundo o que hoje distribui um Reels. */
  generatePublishKit(
    insights: import("./pipeline/commentInsights").CommentInsights | null,
    analysis: SceneAnalysis | null,
    existingCta: string | null,
  ): Promise<import("./pipeline/validation").PublishKitResult>;
}

export interface TranscriptionProvider {
  readonly name: string;
  readonly available: boolean;
  transcribe(audioPath: string): Promise<Transcript>;
}

export interface VisionProvider {
  readonly name: string;
  readonly available: boolean;
  analyzeFrames(framePaths: FrameRef[]): Promise<VisualAnalysis>;
}

export interface FrameRef {
  path: string;
  timestampSeconds: number;
}

export interface SearchProvider {
  readonly name: string;
  readonly available: boolean;
  searchWork(query: string): Promise<SearchEvidence[]>;
}
