import type { EditorTemplateAudio, EditorTemplateConfig, EditorTextStyle } from "../types";
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

/**
 * Estilo inicial do texto. A caixa fica no topo: neste projeto o CTA é o
 * texto-gancho exibido ACIMA do vídeo. Branco com contorno preto é legível
 * sobre qualquer fundo.
 */
export const DEFAULT_TEXT_STYLE: EditorTextStyle = {
  enabled: true,
  x: 60,
  y: 80,
  width: 960,
  height: 300,
  fontFamily: "Arial Black",
  bold: true,
  maxFontSize: 76,
  minFontSize: 36,
  lineHeight: 1.15,
  align: "center",
  uppercase: true,
  color: "#ffffff",
  strokeColor: "#000000",
  strokeWidth: 8,
  start: 0,
  end: null,
  fadeIn: 0,
  fadeOut: 0,
};

export const DEFAULT_AUDIO: EditorTemplateAudio = {
  mode: "original",
  originalVolume: 1,
  musicVolume: 0.3,
};

/** Fontes comuns no Windows; qualquer outra entra por upload de TTF/OTF (§34). */
export const SYSTEM_FONTS = [
  "Arial Black",
  "Impact",
  "Arial",
  "Segoe UI",
  "Verdana",
  "Tahoma",
  "Trebuchet MS",
  "Georgia",
] as const;

const HEX = /^#[0-9a-fA-F]{6}$/;

function validateText(t: EditorTextStyle, config: EditorTemplateConfig): string | null {
  if (!t.enabled) return null;
  if (t.width < 20 || t.height < 20) return "A caixa do texto é pequena demais.";
  if (t.x < 0 || t.y < 0) return "A caixa do texto não pode começar fora do canvas.";
  if (t.x + t.width > config.canvasWidth) return "A caixa do texto ultrapassa a borda direita do canvas.";
  if (t.y + t.height > config.canvasHeight) return "A caixa do texto ultrapassa a borda inferior do canvas.";
  if (t.minFontSize < 8 || t.maxFontSize > 400) return "O tamanho da fonte precisa ficar entre 8 e 400.";
  if (t.minFontSize > t.maxFontSize) return "O tamanho mínimo da fonte é maior que o máximo.";
  if (t.lineHeight < 0.8 || t.lineHeight > 3) return "O espaçamento entre linhas precisa ficar entre 0,8 e 3.";
  if (!HEX.test(t.color) || !HEX.test(t.strokeColor)) return "As cores do texto precisam estar no formato #RRGGBB.";
  if (t.boxColor !== undefined && !HEX.test(t.boxColor)) return "A cor da faixa precisa estar no formato #RRGGBB.";
  if (t.boxOpacity !== undefined && (t.boxOpacity < 0 || t.boxOpacity > 1)) return "A opacidade da faixa precisa ficar entre 0 e 1.";
  if (t.strokeWidth < 0 || t.strokeWidth > 40) return "O contorno precisa ficar entre 0 e 40.";
  if (t.start < 0 || t.fadeIn < 0 || t.fadeOut < 0) return "Os tempos do texto não podem ser negativos.";
  if (t.end !== null) {
    if (t.end <= t.start) return "O texto precisa terminar depois de começar.";
    if (t.fadeIn + t.fadeOut > t.end - t.start) return "Os fades do texto são mais longos que o tempo em tela.";
  }
  return null;
}

function validateAudio(a: EditorTemplateAudio): string | null {
  if ((a.mode === "replace" || a.mode === "mix") && !a.music) {
    return "Escolha uma música para substituir ou misturar o áudio.";
  }
  if (a.originalVolume < 0 || a.originalVolume > 2 || a.musicVolume < 0 || a.musicVolume > 2) {
    return "Os volumes precisam ficar entre 0 e 200%.";
  }
  return null;
}

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
  if (config.text) {
    const erro = validateText(config.text, config);
    if (erro) return erro;
  }
  if (config.audio) {
    const erro = validateAudio(config.audio);
    if (erro) return erro;
  }
  return null;
}
