/**
 * Proporção real do vídeo para o CSS.
 *
 * Uma lista de casos ("9:16", "16:9", …) não serve: o FFprobe devolve a razão
 * já simplificada das dimensões reais, e 608x1080 vira "76:135". Qualquer
 * valor fora da lista caía no padrão 16:9 e o vertical aparecia deitado.
 * Aqui a razão vai direto para a propriedade aspect-ratio, que aceita
 * qualquer par de números.
 */

/** Shorts são verticais: é o palpite certo enquanto o FFprobe não rodou. */
const FALLBACK = "9 / 16";

export function aspectRatioStyle(ratio: string | null | undefined): { aspectRatio: string } {
  return { aspectRatio: parseRatio(ratio) ?? FALLBACK };
}

export function parseRatio(ratio: string | null | undefined): string | null {
  if (!ratio) return null;
  const [w, h] = ratio.split(":").map(Number);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return `${w} / ${h}`;
}
