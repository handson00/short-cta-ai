import type { SceneContext, CtaOptions, CtaStyle } from "./pipeline/ctaDetection";

export interface MediaInfo {
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
}

export interface Frame {
  readonly path: string;
  readonly timestampSeconds: number;
  readonly phash: string | null;
}

export interface FramesResult {
  readonly frames: Frame[];
  readonly skipped: number;
}

export interface Transcript {
  readonly segments: TranscriptSegment[];
}

export interface TranscriptSegment {
  readonly timestampSeconds: number;
  readonly text: string;
  readonly confidence: number | null;
}

export interface VisibleText {
  readonly text: string;
  readonly region: string;
  readonly timestampSeconds: number;
  readonly type: "smi" | "gancho" | "text_other";
  readonly ocrConfidence: number | null;
  readonly relativeHeight: number | null;
}

export interface VisualAnalysis {
  readonly visibleText: VisibleText[];
  readonly limitations: string[] | null;
  readonly existingCta: string | null;
}

export interface SceneAnalysis {
  readonly sceneSummary: string;
  readonly conflict: string | null;
  readonly withhold: string | null;
}

export interface CtaResult {
  readonly suggestions: CtaSuggestion[];
  readonly recommendedIndex: number;
  readonly audienceRead: string;
}

export interface CtaSuggestion {
  readonly text: string;
  readonly style: CtaStyle;
}

export type Confidence = "high" | "medium" | "low";

export type JobStatus = "pending" | "processing" | "success" | "error" | "cancelled";
export const ACTIVE_STATUSES: JobStatus[] = ["pending", "processing"];
export const STATUS_LABEL: Record<JobStatus, string> = {
  pending: "Aguardando",
  processing: "Processando",
  success: "Concluído",
  error: "Erro",
  cancelled: "Cancelado",
};
export const STYLE_LABEL: Record<string, string> = {
  promise: "Promessa",
  curiosity: "Curiosidade",
  suspense: "Suspense",
  fomo: "FOMO",
};

export type ExistingCtaDetection = "found" | "not_found" | "unclear";
export type TextKind = "smi" | "gancho" | "text_other";
export type TextRegion = { x: number; y: number; width: number; height: number };

export interface CTA_STYLES {
  name: string;
}


export interface CtaStyle {
  styleExamples: string[];
}

// --------------------------- Interfaces de provedor -------------------------

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  analyzeScene(
    frames: Array<{ path: string; timestampSeconds: number }>,
  ): Promise<import("./pipeline/ctaDetection").SceneAnalysis>;
  generateCtasFromScene(
    analysis: import("./pipeline/ctaDetection").SceneAnalysis,
    count: number,
  ): Promise<import("./pipeline/validation").CtaResult>;
  generateCtasFromComments(
    insights: import("./pipeline/commentInsights").CommentInsights,
    analysis: SceneAnalysis | null,
    count: number,
  ): Promise<import("./pipeline/validation").CommentCtaResult>;
  generateCtasFromCommentsOptimized(
    insights: import("./pipeline/commentInsights").CommentInsights,
    analysis: SceneAnalysis | null,
    count: number,
  ): Promise<import("./pipeline/validation").OptimizedCommentCtaResult>;
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

export interface SearchEvidence {
  source: string;
  evidence: string;
}
