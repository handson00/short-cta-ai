/**
 * Tipos que atravessam a fronteira servidor/cliente. Ficam separados de
 * view.ts porque aquele modulo toca o banco e nao pode entrar no bundle do
 * navegador.
 */
import type { CtaStyle, JobStatus } from "./types";

export interface SuggestionView {
  id: string;
  text: string;
  style: CtaStyle;
  reason: string | null;
  isRecommended: boolean;
  origin: "generated" | "original" | "manual";
  position: number;
}

export interface SelectionView {
  chosenCtaId: string | null;
  editedText: string | null;
  favorite: boolean;
  updatedAt: string | null;
}

export interface VideoSummary {
  id: string;
  name: string;
  bytes: number;
  durationSeconds: number | null;
  aspectRatio: string | null;
  hasThumbnail: boolean;
  status: JobStatus;
  statusLabel: string;
  errorMessage: string | null;
  errorCode: string | null;
  attempts: number;
  maxAttempts: number;
  sceneSummary: string | null;
  recommendedCta: { text: string; reason: string } | null;
  existingCta: { text: string; confidence: string; firstSeenAtSeconds: number } | null;
  existingCtaReview: { strength: string | null; improvement: string | null } | null;
  work: { label: string; confidence: string; identified: boolean };
  suggestionCount: number;
  chosenText: string | null;
  favorite: boolean;
  createdAt: string;
  source: {
    folder: string | null;
    username: string | null;
    videoDate: string | null;
    platform: string | null;
    platformVideoId: string | null;
    originalUrl: string | null;
    embedUrl: string | null;
    identified: boolean;
  };
}

export interface QueueOverview {
  total: number;
  done: number;
  active: number;
  queued: number;
  error: number;
  canceled: number;
  byStatus: Record<string, number>;
}

export interface VideoDetail extends VideoSummary {
  suggestions: SuggestionView[];
  suggestionsByStyle: { style: CtaStyle; items: SuggestionView[] }[];
  transcript: {
    hasSpeech: boolean;
    language: string | null;
    provider: string;
    warnings: string[];
    segments: { start: number; end: number; text: string; lowConfidence?: boolean }[];
  } | null;
  visibleText: { text: string; timestampSeconds: number; region: string; type: string; ocrConfidence: number }[];
  limitations: string[];
  frames: { id: string; timestampSeconds: number }[];
  workDetail: {
    title: string | null;
    year: number | null;
    mediaType: string | null;
    confidence: string;
    evidence: string[];
    sources: string[];
    status: string;
    manuallyCorrected: boolean;
  } | null;
  selection: SelectionView;
  analysisMeta: { promptVersion: string; model: string | null; createdAt: string } | null;
  manualCtaText: string | null;
}
