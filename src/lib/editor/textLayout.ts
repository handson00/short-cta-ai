import type { EditorTextStyle } from "../types";

/**
 * Quebra e encaixe do texto na caixa do template.
 *
 * Funcao pura: quem mede a largura e quem chama. No navegador, o canvas mede
 * com a fonte de verdade; nos testes, um medidor falso. A mesma funcao decide
 * as linhas do preview e da camada exportada — por isso os dois quebram a
 * frase no mesmo lugar.
 */

export type Measure = (text: string, fontSize: number) => number;

export interface TextLayout {
  fontSize: number;
  lines: string[];
  lineHeightPx: number;
  /** Altura do bloco de linhas, para centralizar na caixa. */
  blockHeight: number;
  /** Nem no tamanho mínimo coube: o texto sai cortado e a tela avisa. */
  overflow: boolean;
}

/** Margem interna: o contorno do texto desenha para fora do glifo. */
export function textPadding(style: Pick<EditorTextStyle, "strokeWidth">): number {
  return Math.max(0, style.strokeWidth) + 12;
}

/** Mesma normalização nos dois lados: espaços duplicados somem, quebras manuais ficam. */
export function prepareText(raw: string, uppercase: boolean): string {
  const text = raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .join("\n")
    .trim();
  return uppercase ? text.toLocaleUpperCase("pt-BR") : text;
}

/**
 * Separa em grafemas, nao em caracteres: "⚠️" sao dois code points e partir
 * no meio deles desenharia um simbolo quebrado.
 */
function graphemes(text: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: new (l: string, o: object) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Segmenter) {
    return Array.from(new Segmenter("pt", { granularity: "grapheme" }).segment(text), (s) => s.segment);
  }
  return Array.from(text);
}

/** Quebra gulosa por palavra; palavra maior que a largura é partida por grafema. */
export function wrapParagraph(paragraph: string, maxWidth: number, fontSize: number, measure: Measure): string[] {
  if (!paragraph) return [""];
  const lines: string[] = [];
  let current = "";

  const pushLongWord = (word: string) => {
    let piece = "";
    for (const g of graphemes(word)) {
      if (piece && measure(piece + g, fontSize) > maxWidth) {
        lines.push(piece);
        piece = g;
      } else {
        piece += g;
      }
    }
    return piece;
  };

  for (const word of paragraph.split(" ")) {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = measure(word, fontSize) <= maxWidth ? word : pushLongWord(word);
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Maior tamanho de fonte em que o texto cabe na caixa.
 *
 * Desce de 2 em 2 a partir do maximo: CTA curto sai grande, CTA longo encolhe
 * em vez de vazar da caixa. Abaixo do minimo o texto ficaria ilegivel no
 * celular; ai ele fica no minimo e o resultado avisa que nao coube.
 */
export function layoutText(
  raw: string,
  style: EditorTextStyle,
  measure: Measure,
): TextLayout {
  const text = prepareText(raw, style.uppercase);
  const pad = textPadding(style);
  const maxWidth = Math.max(1, style.width - pad * 2);
  const maxHeight = Math.max(1, style.height - pad * 2);
  const paragraphs = text.split("\n");

  const attempt = (fontSize: number): TextLayout => {
    const lines = paragraphs.flatMap((p) => wrapParagraph(p, maxWidth, fontSize, measure));
    const lineHeightPx = Math.round(fontSize * style.lineHeight);
    const blockHeight = lines.length * lineHeightPx;
    const fits = blockHeight <= maxHeight && lines.every((l) => measure(l, fontSize) <= maxWidth);
    return { fontSize, lines, lineHeightPx, blockHeight, overflow: !fits };
  };

  const min = Math.max(8, Math.min(style.minFontSize, style.maxFontSize));
  for (let size = Math.max(min, style.maxFontSize); size >= min; size -= 2) {
    const result = attempt(size);
    if (!result.overflow) return result;
  }
  return attempt(min);
}

/** Opacidade do texto no instante `t` — a mesma regra dos filtros `fade` do FFmpeg. */
export function textOpacityAt(t: number, style: EditorTextStyle, duration: number): number {
  const end = style.end ?? duration;
  if (t < style.start || t > end) return 0;
  let alpha = 1;
  if (style.fadeIn > 0) alpha = Math.min(alpha, (t - style.start) / style.fadeIn);
  if (style.fadeOut > 0) alpha = Math.min(alpha, (end - t) / style.fadeOut);
  return Math.max(0, Math.min(1, alpha));
}
