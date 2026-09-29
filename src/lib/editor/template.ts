import type { EditorTemplateConfig } from "../types";
import type { NormalizedRect, PixelRect } from "./crop";

/**
 * Geometria da composicao: onde o video recortado cai dentro do template.
 *
 * Fica separado da interface porque e a mesma conta que o PreviewRenderer e o
 * ExportRenderer precisam fazer (spec §86). Duas implementacoes diferentes da
 * mesma composicao e a forma mais facil de o preview mentir sobre o resultado.
 */

export const DEFAULT_TEMPLATE: EditorTemplateConfig = {
  backgroundColor: "#0a0b0f",
  canvasWidth: 1080,
  canvasHeight: 1920,
  videoX: 0,
  videoY: 420,
  videoWidth: 1080,
  videoHeight: 1080,
  fitMode: "fit",
  logoX: 420,
  logoY: 120,
  logoWidth: 240,
  logoHeight: 240,
};

/** A logo tem posição própria; sem ela configurada, usa o padrão. */
export function logoRect(config: EditorTemplateConfig): PixelRect {
  return {
    x: config.logoX ?? DEFAULT_TEMPLATE.logoX!,
    y: config.logoY ?? DEFAULT_TEMPLATE.logoY!,
    width: config.logoWidth ?? DEFAULT_TEMPLATE.logoWidth!,
    height: config.logoHeight ?? DEFAULT_TEMPLATE.logoHeight!,
  };
}

/** Converte um retângulo em pixels do canvas para fração, e volta. */
export function toCanvasFraction(rect: PixelRect, config: EditorTemplateConfig): NormalizedRect {
  const cw = Math.max(1, config.canvasWidth);
  const ch = Math.max(1, config.canvasHeight);
  return { x: rect.x / cw, y: rect.y / ch, width: rect.width / cw, height: rect.height / ch };
}

export function fromCanvasFraction(rect: NormalizedRect, config: EditorTemplateConfig): PixelRect {
  const cw = Math.max(1, config.canvasWidth);
  const ch = Math.max(1, config.canvasHeight);
  const width = Math.min(Math.round(rect.width * cw), cw);
  const height = Math.min(Math.round(rect.height * ch), ch);
  return {
    width,
    height,
    x: Math.max(0, Math.min(Math.round(rect.x * cw), cw - width)),
    y: Math.max(0, Math.min(Math.round(rect.y * ch), ch - height)),
  };
}

/**
 * Onde desenhar o video dentro do slot.
 *
 * FIT (§30): cabe inteiro, pode sobrar espaco. FILL: preenche o slot, pode
 * cortar as bordas. Nos dois casos o resultado fica centralizado no slot.
 *
 * `sourceAspect` e a proporcao do **recorte**, nao do arquivo: recortar muda a
 * forma do que vai ser encaixado, e usar a proporcao do arquivo original
 * deformaria o video.
 */
export function placeVideoInSlot(
  sourceAspect: number,
  config: EditorTemplateConfig,
  fitMode: "fit" | "fill" = config.fitMode,
): PixelRect {
  const slotW = Math.max(1, config.videoWidth);
  const slotH = Math.max(1, config.videoHeight);
  const slotAspect = slotW / slotH;

  // Em FIT limita pelo lado que estoura; em FILL, pelo lado que falta.
  const matchWidth = fitMode === "fit" ? sourceAspect > slotAspect : sourceAspect < slotAspect;

  const width = matchWidth ? slotW : slotH * sourceAspect;
  const height = matchWidth ? slotW / sourceAspect : slotH;

  return {
    x: config.videoX + (slotW - width) / 2,
    y: config.videoY + (slotH - height) / 2,
    width,
    height,
  };
}

/**
 * Como desenhar a imagem inteira para que apenas a regiao do recorte apareca
 * dentro de uma caixa do tamanho de `placement`.
 *
 * Existe porque desenhar a miniatura inteira no tamanho do encaixe mostrava o
 * video todo espremido na forma do recorte: a caixa tinha a proporcao do
 * recorte e o conteudo era o quadro inteiro.
 */
export function cropRegionTransform(
  placement: { width: number; height: number },
  crop: NormalizedRect,
): { width: number; height: number; left: number; top: number } {
  const width = placement.width / Math.max(crop.width, 1e-6);
  const height = placement.height / Math.max(crop.height, 1e-6);
  return { width, height, left: -crop.x * width, top: -crop.y * height };
}

/** Proporção do recorte, em pixels reais da fonte. */
export function croppedAspect(
  crop: NormalizedRect | null,
  videoWidth: number,
  videoHeight: number,
): number {
  if (!videoWidth || !videoHeight) return 9 / 16;
  const w = (crop?.width ?? 1) * videoWidth;
  const h = (crop?.height ?? 1) * videoHeight;
  if (w <= 0 || h <= 0) return 9 / 16;
  return w / h;
}

/** O slot em fração do canvas, para desenhar o retângulo arrastável por cima. */
export function slotToNormalized(config: EditorTemplateConfig): NormalizedRect {
  const cw = Math.max(1, config.canvasWidth);
  const ch = Math.max(1, config.canvasHeight);
  return {
    x: config.videoX / cw,
    y: config.videoY / ch,
    width: config.videoWidth / cw,
    height: config.videoHeight / ch,
  };
}

/**
 * Volta de fracao para pixels do canvas.
 *
 * Arredonda para par pelo mesmo motivo do recorte: H.264 em yuv420p recusa
 * lado impar, e um slot de 911px so falharia na exportacao (Fase 7).
 */
export function slotFromNormalized(
  rect: NormalizedRect,
  config: EditorTemplateConfig,
): EditorTemplateConfig {
  const cw = Math.max(1, config.canvasWidth);
  const ch = Math.max(1, config.canvasHeight);
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);

  const videoWidth = Math.min(even(rect.width * cw), cw);
  const videoHeight = Math.min(even(rect.height * ch), ch);

  return {
    ...config,
    videoWidth,
    videoHeight,
    videoX: Math.max(0, Math.min(Math.round(rect.x * cw), cw - videoWidth)),
    videoY: Math.max(0, Math.min(Math.round(rect.y * ch), ch - videoHeight)),
  };
}

/** Recusa um template que não dá para renderizar, antes de gravar. */
export function validateTemplateConfig(config: EditorTemplateConfig): string | null {
  if (config.canvasWidth < 16 || config.canvasHeight < 16) {
    return "O canvas é pequeno demais.";
  }
  if (config.canvasWidth % 2 !== 0 || config.canvasHeight % 2 !== 0) {
    return "O canvas precisa ter largura e altura pares (exigência do H.264).";
  }
  if (config.videoWidth < 2 || config.videoHeight < 2) {
    return "A área do vídeo é pequena demais.";
  }
  if (config.videoX < 0 || config.videoY < 0) {
    return "A área do vídeo não pode começar fora do canvas.";
  }
  if (config.videoX + config.videoWidth > config.canvasWidth) {
    return "A área do vídeo ultrapassa a borda direita do canvas.";
  }
  if (config.videoY + config.videoHeight > config.canvasHeight) {
    return "A área do vídeo ultrapassa a borda inferior do canvas.";
  }
  if (config.backgroundColor && !/^#[0-9a-fA-F]{6}$/.test(config.backgroundColor)) {
    return "A cor de fundo precisa estar no formato #RRGGBB.";
  }
  if (config.logo) {
    const logo = logoRect(config);
    if (logo.width < 2 || logo.height < 2) return "A logo é pequena demais.";
    if (logo.x < 0 || logo.y < 0) return "A logo não pode começar fora do canvas.";
    if (logo.x + logo.width > config.canvasWidth) {
      return "A logo ultrapassa a borda direita do canvas.";
    }
    if (logo.y + logo.height > config.canvasHeight) {
      return "A logo ultrapassa a borda inferior do canvas.";
    }
  }
  return null;
}
