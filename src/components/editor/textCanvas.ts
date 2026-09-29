"use client";

import type { EditorTextStyle } from "@/lib/types";
import { layoutText, textPadding, type TextLayout } from "@/lib/editor/textLayout";

/**
 * Desenho do texto no canvas do navegador.
 *
 * E a UNICA funcao que desenha texto: o preview chama, e a camada PNG enviada
 * para a exportacao sai dela tambem. Por isso o video final mostra exatamente
 * o que a tela mostrou — mesma fonte, mesmas quebras de linha, emoji inclusive.
 */

/** Família CSS usada no canvas: a fonte enviada ganha um nome próprio. */
export function textFontFamily(style: EditorTextStyle): string {
  return style.fontFile ? `tpl_${style.fontFile.replace(/[^a-zA-Z0-9]/g, "")}` : style.fontFamily;
}

function fontCss(style: EditorTextStyle, size: number): string {
  return `${style.bold ? 700 : 400} ${size}px "${textFontFamily(style)}", sans-serif`;
}

const loadedFontFiles = new Set<string>();

/**
 * Garante a fonte carregada antes de medir e desenhar.
 *
 * Sem isto, o primeiro desenho sai com a fonte reserva do navegador — e as
 * linhas quebram em lugar diferente do desenho seguinte.
 */
export async function ensureTextFont(style: EditorTextStyle): Promise<void> {
  if (style.fontFile && !loadedFontFiles.has(style.fontFile)) {
    const face = new FontFace(
      textFontFamily(style),
      `url(/api/editor/template-asset?file=${encodeURIComponent(style.fontFile)})`,
    );
    await face.load();
    document.fonts.add(face);
    loadedFontFiles.add(style.fontFile);
  }
  await document.fonts.load(fontCss(style, style.maxFontSize));
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * Desenha o texto na resolucao do canvas do template (a caixa inteira), com
 * fundo transparente. Devolve o layout para a tela avisar quando nao coube.
 */
export function drawTextLayer(canvas: HTMLCanvasElement, rawText: string, style: EditorTextStyle): TextLayout {
  canvas.width = Math.max(1, Math.round(style.width));
  canvas.height = Math.max(1, Math.round(style.height));
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const measure = (s: string, size: number) => {
    ctx.font = fontCss(style, size);
    return ctx.measureText(s).width;
  };
  const layout = layoutText(rawText, style, measure);
  if (layout.lines.length === 0 || (layout.lines.length === 1 && !layout.lines[0])) return layout;

  const pad = textPadding(style);
  ctx.font = fontCss(style, layout.fontSize);
  const widest = Math.max(...layout.lines.map((l) => ctx.measureText(l).width));
  const top = (canvas.height - layout.blockHeight) / 2;

  if (style.boxColor) {
    // A faixa acompanha o bloco de texto, não a caixa inteira.
    const bw = Math.min(canvas.width, widest + pad * 2);
    const bh = Math.min(canvas.height, layout.blockHeight + pad);
    const bx = style.align === "left" ? 0 : style.align === "right" ? canvas.width - bw : (canvas.width - bw) / 2;
    ctx.globalAlpha = style.boxOpacity ?? 1;
    ctx.fillStyle = style.boxColor;
    roundedRect(ctx, bx, Math.max(0, top - pad / 2), bw, bh, 18);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.textBaseline = "middle";
  ctx.textAlign = style.align;
  const x = style.align === "left" ? pad : style.align === "right" ? canvas.width - pad : canvas.width / 2;
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;

  layout.lines.forEach((line, i) => {
    const y = top + i * layout.lineHeightPx + layout.lineHeightPx / 2;
    if (style.strokeWidth > 0) {
      // O traço é centrado no contorno: o dobro da largura deixa a espessura
      // configurada visível do lado de fora da letra.
      ctx.lineWidth = style.strokeWidth * 2;
      ctx.strokeStyle = style.strokeColor;
      ctx.strokeText(line, x, y);
    }
    ctx.fillStyle = style.color;
    ctx.fillText(line, x, y);
  });

  return layout;
}

/** Desenha num canvas fora da tela e devolve o PNG para enviar ao servidor. */
export async function renderTextLayerPng(
  rawText: string,
  style: EditorTextStyle,
): Promise<{ blob: Blob; layout: TextLayout }> {
  await ensureTextFont(style);
  const canvas = document.createElement("canvas");
  const layout = drawTextLayer(canvas, rawText, style);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("O navegador não gerou a camada de texto."))), "image/png"),
  );
  return { blob, layout };
}
