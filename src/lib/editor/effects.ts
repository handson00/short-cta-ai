import { clamp, FULL_FRAME, type NormalizedRect } from "./crop";

/**
 * Efeitos de edição por vídeo (aba Efeitos do editor).
 *
 * Funções puras, seguras no cliente: a exportação (`filterGraph.ts`) e o
 * preview (`CompositionPreview`) usam as mesmas contas — o zoom, por exemplo,
 * vira um recorte menor em volta do centro nos dois lados, e não um "zoom de
 * CSS" que mostraria outra região (spec §86).
 *
 * São efeitos de edição e de qualidade, não de disfarce: o projeto não inclui
 * efeito pensado para enganar a detecção de conteúdo das plataformas.
 */
export interface EditorEffects {
  /** Inverte o vídeo na horizontal. */
  mirror: boolean;
  /** Segundos tirados do começo e do fim do vídeo de origem. */
  trimStart: number;
  trimEnd: number;
  /** Contraste e saturação um pouco mais altos (ver COLOR_EQ). */
  enhanceColor: boolean;
  /** 1 = normal. O áudio acompanha sem mudar o tom da voz (atempo). */
  speed: number;
  /** 1 = sem zoom. Aproxima em volta do centro do recorte. */
  zoom: number;
  /** Volume padronizado (-14 LUFS, o alvo das plataformas) e corte de ronco grave. */
  enhanceAudio: boolean;
}

export const DEFAULT_EFFECTS: EditorEffects = {
  mirror: false,
  trimStart: 0,
  trimEnd: 0,
  enhanceColor: false,
  speed: 1,
  zoom: 1,
  enhanceAudio: false,
};

/** Opções oferecidas na tela. O limite de cada uma é o que o normalize aceita. */
export const SPEED_OPTIONS = [1.05, 1.1, 1.15, 1.2, 1.25] as const;
export const ZOOM_OPTIONS = [1.05, 1.1, 1.15, 1.2] as const;
export const MAX_TRIM_SECONDS = 10;
/** Vídeo que sobra depois do corte: menos que isto não é um vídeo. */
export const MIN_OUTPUT_SECONDS = 1;

/**
 * Realce de cor. No FFmpeg, `eq` com estes valores; no preview, o filtro CSS
 * equivalente. Os dois partem do meio-tom, mas não são a mesma fórmula: o
 * preview é uma aproximação, e a tela diz isso.
 */
export const COLOR_EQ = { contrast: 1.08, saturation: 1.18 } as const;

/** Loudness alvo: -14 LUFS é o que TikTok, Reels e YouTube normalizam. */
export const LOUDNORM = "loudnorm=I=-14:TP=-1.5:LRA=11";

/** Aceita qualquer coisa vinda do banco ou do navegador e devolve efeitos válidos. */
export function normalizeEffects(raw: unknown): EditorEffects {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof EditorEffects, unknown>>;
  const num = (v: unknown, lo: number, hi: number, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
  return {
    mirror: r.mirror === true,
    trimStart: round2(num(r.trimStart, 0, MAX_TRIM_SECONDS, 0)),
    trimEnd: round2(num(r.trimEnd, 0, MAX_TRIM_SECONDS, 0)),
    enhanceColor: r.enhanceColor === true,
    speed: round2(num(r.speed, 1, 1.25, 1)),
    zoom: round2(num(r.zoom, 1, 1.2, 1)),
    enhanceAudio: r.enhanceAudio === true,
  };
}

/** Quantos efeitos estão ligados — o card do vídeo mostra isso. */
export function countEffects(fx: EditorEffects | null | undefined): number {
  if (!fx) return 0;
  return [
    fx.mirror,
    fx.trimStart > 0 || fx.trimEnd > 0,
    fx.enhanceColor,
    fx.speed !== 1,
    fx.zoom !== 1,
    fx.enhanceAudio,
  ].filter(Boolean).length;
}

/** Trecho da origem que entra no vídeo, em segundos. */
export function sourceWindow(durationSeconds: number, fx: EditorEffects): { start: number; length: number } {
  const start = fx.trimStart;
  const length = durationSeconds - fx.trimStart - fx.trimEnd;
  return { start, length };
}

/** Duração do vídeo exportado: o trecho cortado, dividido pela velocidade. */
export function outputDuration(durationSeconds: number, fx: EditorEffects): number {
  if (!(durationSeconds > 0)) return 0;
  const { length } = sourceWindow(durationSeconds, fx);
  return Math.max(0, length) / fx.speed;
}

/** Motivo pelo qual os efeitos não servem para este vídeo; nulo = servem. */
export function effectsError(durationSeconds: number, fx: EditorEffects): string | null {
  if (!(durationSeconds > 0) || (fx.trimStart === 0 && fx.trimEnd === 0)) return null;
  const { length } = sourceWindow(durationSeconds, fx);
  if (length < MIN_OUTPUT_SECONDS) {
    return `O corte de início/fim (${fx.trimStart}s + ${fx.trimEnd}s) deixa menos de ${MIN_OUTPUT_SECONDS}s de um vídeo de ${durationSeconds.toFixed(1)}s.`;
  }
  return null;
}

/**
 * Zoom como recorte menor em volta do centro do recorte atual. É a mesma conta
 * na exportação e no preview, então os dois mostram exatamente a mesma região.
 */
export function zoomRect(rect: NormalizedRect | null, zoom: number): NormalizedRect {
  const base = rect ?? FULL_FRAME;
  if (!(zoom > 1)) return base;
  const width = base.width / zoom;
  const height = base.height / zoom;
  return {
    x: base.x + (base.width - width) / 2,
    y: base.y + (base.height - height) / 2,
    width,
    height,
  };
}

/** Filtro CSS do preview para o realce de cor (aproximação do `eq`). */
export function previewColorFilter(fx: EditorEffects): string | undefined {
  return fx.enhanceColor ? `contrast(${COLOR_EQ.contrast}) saturate(${COLOR_EQ.saturation})` : undefined;
}

/**
 * Tempo de saída para um instante da origem: o preview toca a origem, mas o
 * texto é temporizado no tempo do vídeo exportado.
 */
export function outputTimeAt(sourceTime: number, fx: EditorEffects): number {
  return Math.max(0, sourceTime - fx.trimStart) / fx.speed;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
