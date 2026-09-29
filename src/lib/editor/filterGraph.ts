import type { EditorTemplateConfig } from "../types";
import { evenDown, evenUp, toPixels, type NormalizedRect } from "./crop";
import { placeVideoInSlot } from "./template";

/**
 * Monta o filter_complex do FFmpeg (spec §46, §47).
 *
 * E uma funcao pura que devolve texto: nenhuma string vinda do navegador entra
 * aqui, e o resultado da para conferir num teste sem rodar o FFmpeg. Os
 * argumentos sao montados no servidor, sempre em array — nunca linha de shell
 * (§45, §83).
 */

export interface ExportPlan {
  /** Recorte do vídeo de origem. `null` = quadro inteiro. */
  crop: NormalizedRect | null;
  sourceWidth: number;
  sourceHeight: number;
  template: EditorTemplateConfig;
  fps: number;
  hasBackgroundImage: boolean;
  hasOverlayImage: boolean;
  hasLogoImage: boolean;
}

export interface FilterGraph {
  filterComplex: string;
  /** Rótulo final a mapear para o encoder. */
  outputLabel: string;
  /** Ordem das entradas depois do vídeo: o chamador passa os -i nesta ordem. */
  imageInputs: Array<"background" | "overlay" | "logo">;
  /** Fundo em cor sólida quando não há imagem: vira uma entrada lavfi. */
  colorSource: string | null;
}

/** `#1a1033` → `0x1a1033`: o FFmpeg aceita as duas, mas `#` confunde parsers. */
export function ffmpegColor(hex: string | undefined): string {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return "0x000000";
  return `0x${hex.slice(1)}`;
}

/** Lado par: H.264 em yuv420p recusa dimensão ímpar. */
const even = evenUp;

export function buildFilterGraph(plan: ExportPlan): FilterGraph {
  const t = plan.template;
  const canvasW = even(t.canvasWidth);
  const canvasH = even(t.canvasHeight);

  const src = toPixels(plan.crop ?? { x: 0, y: 0, width: 1, height: 1 }, plan.sourceWidth, plan.sourceHeight);
  const placement = placeVideoInSlot(src.width / src.height, t);

  // Em FILL o vídeo estoura o slot; recorta-se o que passa, e a sobra some.
  // Em FIT o encaixe já cabe, e esta conta vira um recorte de tudo.
  const visibleX = Math.max(0, Math.round(t.videoX - placement.x));
  const visibleY = Math.max(0, Math.round(t.videoY - placement.y));
  // evenDown: o recorte não pode crescer além do slot nem do vídeo escalado.
  const visibleW = evenDown(Math.min(t.videoWidth, placement.width));
  const visibleH = evenDown(Math.min(t.videoHeight, placement.height));
  const drawX = Math.round(Math.max(t.videoX, placement.x));
  const drawY = Math.round(Math.max(t.videoY, placement.y));

  const steps: string[] = [];

  // 1. Vídeo: recorta a origem, escala para o encaixe, recorta ao slot.
  const videoChain = [
    `crop=${src.width}:${src.height}:${src.x}:${src.y}`,
    `scale=${even(placement.width)}:${even(placement.height)}`,
    `crop=${visibleW}:${visibleH}:${visibleX}:${visibleY}`,
  ].join(",");
  steps.push(`[0:v]${videoChain}[vid]`);

  // 2. Fundo: imagem enviada ou cor sólida. Sempre é a entrada 1.
  const imageInputs: Array<"background" | "overlay" | "logo"> = [];
  const colorSource = plan.hasBackgroundImage
    ? null
    : `color=c=${ffmpegColor(t.backgroundColor)}:s=${canvasW}x${canvasH}`;
  if (plan.hasBackgroundImage) imageInputs.push("background");
  steps.push(`[1:v]scale=${canvasW}:${canvasH},setsar=1[bg]`);

  let last = "bg";
  let stage = 0;

  // 3. Camadas, na ordem da §28: vídeo → overlay → logo.
  const next = () => `s${++stage}`;

  const afterVideo = next();
  steps.push(`[${last}][vid]overlay=${drawX}:${drawY}[${afterVideo}]`);
  last = afterVideo;

  let inputIndex = 2;
  if (plan.hasOverlayImage) {
    imageInputs.push("overlay");
    steps.push(`[${inputIndex}:v]scale=${canvasW}:${canvasH}[ov]`);
    const afterOverlay = next();
    steps.push(`[${last}][ov]overlay=0:0[${afterOverlay}]`);
    last = afterOverlay;
    inputIndex++;
  }

  if (plan.hasLogoImage) {
    imageInputs.push("logo");
    const lw = even(t.logoWidth ?? 240);
    const lh = even(t.logoHeight ?? 240);
    const lx = Math.round(t.logoX ?? 0);
    const ly = Math.round(t.logoY ?? 0);

    // `force_original_aspect_ratio=decrease` cabe a logo dentro da caixa sem
    // deformar. Sem isto, uma logo larga esticava para preencher a altura.
    // O preview usa `object-contain`, que faz exatamente isto — e o preview
    // precisa mostrar o que a exportacao produz (§86).
    steps.push(`[${inputIndex}:v]scale=${lw}:${lh}:force_original_aspect_ratio=decrease[logo]`);

    // Centraliza na caixa: as dimensoes reais so existem em tempo de execucao,
    // entao a posicao sai de uma expressao com overlay_w/overlay_h.
    const afterLogo = next();
    steps.push(
      `[${last}][logo]overlay=${lx}+(${lw}-overlay_w)/2:${ly}+(${lh}-overlay_h)/2[${afterLogo}]`,
    );
    last = afterLogo;
    inputIndex++;
  }

  // 4. Saída: fps fixo e yuv420p, sem os quais o MP4 não toca em todo lugar.
  steps.push(`[${last}]fps=${plan.fps},format=yuv420p[out]`);

  return {
    filterComplex: steps.join(";"),
    outputLabel: "out",
    imageInputs,
    colorSource,
  };
}
