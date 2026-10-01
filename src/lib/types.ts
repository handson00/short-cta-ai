// ======================== TIPOS BÁSICOS DE MÍDIA ========================

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

// ======================== TRANSCRIÇÃO ========================

export interface Transcript {
  provider: string;
  language: string | null;
  text: string;
  segments: TranscriptSegment[];
  hasSpeech: boolean;
  lowConfidence: boolean;
  warnings: string[];
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  /** dialogo | narracao | desconhecido — quando o provedor souber distinguir. */
  kind?: "dialogue" | "narration" | "unknown";
  lowConfidence?: boolean;
}

// ======================== ANÁLISE VISUAL ========================

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
  /** Fracao da altura do quadro ocupada pelo bloco. */
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

// ======================== ANÁLISE DE CENA ========================

/**
 * Em que o enredo se apoiou. Calculado pelo servidor a partir da transcrição
 * que a análise recebeu — nunca declarado pelo modelo, que poderia dizer
 * "ouvi a fala" sem ter recebido fala nenhuma.
 */
export type EvidenceBasis = "dialogue" | "visual_only";

/** Uma fala da transcrição que sustenta o enredo. */
export interface KeyLine {
  atSeconds: number | null;
  /** Trecho literal da transcrição — conferido no servidor (`groundKeyLines`). */
  text: string;
  /** O que essa fala revela da história. */
  why: string | null;
}

export interface SceneAnalysis {
  sceneSummary: string;
  /**
   * O enredo reconstruído a partir da FALA: quem, o que quer, o que impede, o
   * que muda. Nulo quando não houve fala — o resumo sozinho descreve a cena,
   * não a história.
   */
  plot: string | null;
  keyLines: KeyLine[];
  evidenceBasis?: EvidenceBasis;
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

// ======================== TIPOS DE CTA ========================

export const CTA_STYLES = [
  "curiosidade",
  "suspense",
  "conflito",
  "reviravolta",
  "emocional",
  "ultracurto",
] as const;
export type CtaStyle = (typeof CTA_STYLES)[number];

export interface CtaOptions {
  count: number;
  language: string;
  creativity: number;
  avoidSpoilers: boolean;
  useExistingCtaAsReference: boolean;
  styleExamples: string[];
}

export interface CtaResult {
  recommendedCta: { text: string; reason: string };
  suggestions: CtaSuggestion[];
}

export interface CtaSuggestion {
  text: string;
  style: CtaStyle;
  reason?: string | null;
}

// ======================== TIPOS DE STATUS E JOBS ========================

export type Confidence = "high" | "medium" | "low";

export const JOB_STATUSES = [
  "queued",
  "extracting_media",
  "transcribing",
  "reading_text",
  "analyzing_scene",
  "identifying_work",
  "generating_ctas",
  /** Parte local pronta (transcrição, OCR); os CTAs esperam o usuário pedir. */
  "awaiting_ai",
  "done",
  "error",
  "canceled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * O que um job de análise executa.
 * - `full`: parte local + IA (análise e CTAs) — "Analisar novamente".
 * - `local`: só transcrição, frames e OCR, sem chamada paga — a importação.
 * - `ai`: só a IA, sobre a parte local já feita — "Gerar CTAs".
 */
export type JobMode = "full" | "local" | "ai";

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
  awaiting_ai: "Aguardando CTA",
  done: "Concluído",
  error: "Erro",
  canceled: "Cancelado",
};

export const STYLE_LABEL: Record<CtaStyle, string> = {
  curiosidade: "Curiosidade",
  suspense: "Suspense",
  conflito: "Conflito",
  reviravolta: "Reviravolta",
  emocional: "Emocional",
  ultracurto: "Ultracurto",
};

export interface ExistingCtaDetection {
  text: string;
  confidence: Confidence;
  firstSeenAtSeconds: number;
  reasons: string[];
}

// ======================== TIPOS DE PROVEDOR ========================

export interface AIProvider {
  analyzeScene(input: SceneContext): Promise<SceneAnalysis>;
  /**
   * A transcrição vai junto com a análise: o CTA é escrito lendo as falas, não
   * só o resumo que o modelo fez delas.
   */
  generateCtas(input: SceneAnalysis, options: CtaOptions, transcript?: Transcript | null): Promise<CtaResult>;
  /** Ganchos apoiados na reacao do publico, nao na descricao da cena. */
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
  /** Hashtags novas para o vídeo, sem repetir as que ele já tem. */
  generateHashtags(
    context: {
      cta: string | null;
      plot: string | null;
      sceneSummary: string | null;
      transcript: string | null;
      workTitle: string | null;
    },
    existing: string[],
    count: number,
  ): Promise<import("./pipeline/validation").AiHashtag[]>;
  /** Legenda em japonês aberta pela hashtag fixa (página de Exportações). */
  generateJapaneseCaption(
    context: {
      cta: string | null;
      plot: string | null;
      sceneSummary: string | null;
      transcript: string | null;
      workTitle: string | null;
    },
    hashtag: string,
  ): Promise<string>;
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
  title: string;
  snippet: string;
  url: string | null;
  source: string;
}

// ======================== EDITOR DE VÍDEOS EM MASSA ========================

export interface EditorCrop {
  x: number;
  y: number;
  width: number;
  height: number;
  normalized: boolean;
  confidence?: number;
  source: "auto" | "profile" | "manual";
  /** Perfil de onde o recorte foi copiado, quando `source` é "profile". */
  profileId?: string | null;
}

export interface EditorTemplate {
  id: string;
  name: string;
  config: EditorTemplateConfig;
  createdAt: string;
  updatedAt: string;
}

export interface EditorTemplateConfig {
  background?: string;
  overlay?: string;
  logo?: string;
  /** Cor de fundo em hex. Permite criar um template do zero, sem imagem. */
  backgroundColor?: string;
  canvasWidth: number;
  canvasHeight: number;
  videoX: number;
  videoY: number;
  videoWidth: number;
  videoHeight: number;
  fitMode: "fit" | "fill";
  /** Posição fixa da logo, em pixels do canvas. A altura segue a proporção. */
  logoX?: number;
  logoY?: number;
  logoWidth?: number;
  logoHeight?: number;
  /** Camada de texto (o CTA sobre o vídeo). Ausente = sem texto. */
  text?: EditorTextStyle;
  /** Trilha de áudio. Ausente = áudio original. */
  audio?: EditorTemplateAudio;
}

/**
 * Estilo e caixa do texto. O conteúdo é de cada vídeo; o estilo é do template.
 *
 * O texto é desenhado pelo navegador numa camada PNG e o FFmpeg só a sobrepõe:
 * a mesma função desenha o preview e o arquivo exportado, então os dois ficam
 * idênticos — inclusive com emoji, que o `drawtext` do FFmpeg não desenha.
 */
export interface EditorTextStyle {
  enabled: boolean;
  /** Caixa onde o texto é quebrado e centralizado, em pixels do canvas. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Nome da família CSS; com `fontFile`, é o nome registrado para a fonte enviada. */
  fontFamily: string;
  /** Fonte TTF/OTF enviada (nome do asset). */
  fontFile?: string;
  bold: boolean;
  /** O texto começa neste tamanho e diminui até caber na caixa. */
  maxFontSize: number;
  minFontSize: number;
  lineHeight: number;
  align: "left" | "center" | "right";
  uppercase: boolean;
  color: string;
  strokeColor: string;
  strokeWidth: number;
  /** Faixa atrás do texto; ausente = sem faixa. */
  boxColor?: string;
  boxOpacity?: number;
  /** Janela de exibição em segundos (§35). `end` nulo = até o fim. */
  start: number;
  end: number | null;
  fadeIn: number;
  fadeOut: number;
}

export interface EditorTemplateAudio {
  /** §36: manter, silenciar, trocar pela música ou misturar os dois. */
  mode: "original" | "mute" | "replace" | "mix";
  /** Asset de áudio enviado. Obrigatório em replace/mix. */
  music?: string;
  originalVolume: number;
  musicVolume: number;
}

export interface SourceProfile {
  id: string;
  name: string;
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
  /** Página de origem (`tiktok:usuario`); nula = perfil avulso, sem página. */
  originKey: string | null;
  /** Largura ÷ altura do vídeo em que o recorte foi desenhado. */
  aspect: number | null;
  createdAt: string;
  updatedAt: string;
}

export type EditorJobStatus =
  | "pending"
  | "analyzing"
  | "ready"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export interface EditorJob {
  id: string;
  videoId: string;
  templateId: string | null;
  profileId: string | null;
  crop: EditorCrop;
  audio: EditorAudioSettings;
  exportSettings: EditorExportSettings;
  status: EditorJobStatus;
  progress: number;
  outputPath: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface EditorAudioSettings {
  mode: "original" | "mute" | "replace" | "mix";
  originalVolume: number;
  musicVolume: number;
  musicPath?: string;
}

export interface EditorExportSettings {
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec: string;
  bitrate?: number;
  encoderMode: "auto" | "nvenc" | "qsv" | "amf" | "cpu";
  /**
   * Camada de texto renderizada para este job (arquivo em `textLayersDir`),
   * fotografada ao enfileirar como o recorte. Nula = vídeo sai sem texto.
   */
  textLayer?: string | null;
  /**
   * Efeitos do vídeo (aba Efeitos), fotografados ao enfileirar como o recorte:
   * mudar os efeitos depois de mandar exportar não muda o job da fila.
   */
  effects?: import("./editor/effects").EditorEffects | null;
}

export interface EditorSystemStatus {
  ffmpeg: boolean;
  ffprobe: boolean;
  nvenc: boolean;
  qsv: boolean;
  amf: boolean;
  libx264: boolean;
}
