/**
 * Geometria do recorte, em coordenadas normalizadas (0..1).
 *
 * Fica fora do componente porque e a unica parte do recorte que da para testar
 * sem navegador — e porque o mesmo retangulo precisa valer para o preview
 * reduzido e para o arquivo em 1080x1920 (spec §24).
 */

export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CropDirection = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "move";

/** Recorte mínimo em fração do quadro: abaixo disso o retângulo some sob os handles. */
export const MIN_CROP = 0.05;

export const FULL_FRAME: NormalizedRect = { x: 0, y: 0, width: 1, height: 1 };

export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** Traz o retângulo de volta para dentro do quadro, preservando a posição quando dá. */
export function clampRect(rect: NormalizedRect): NormalizedRect {
  const width = clamp(rect.width, MIN_CROP, 1);
  const height = clamp(rect.height, MIN_CROP, 1);
  return {
    width,
    height,
    x: clamp(rect.x, 0, 1 - width),
    y: clamp(rect.y, 0, 1 - height),
  };
}

/** Aplica um arraste ao retângulo. `dx`/`dy` já vêm em fração do quadro. */
/**
 * Aplica um arraste ao retangulo. `dx`/`dy` ja vem em fracao do quadro.
 *
 * `min` e parametro e nao constante porque o mesmo componente serve a dois
 * usos com escalas diferentes: um recorte de video abaixo de 5% do quadro nao
 * faz sentido, mas uma logo de 2% do canvas e comum — travar a logo no minimo
 * do recorte impedia diminui-la.
 */
export function resizeRect(
  start: NormalizedRect,
  dir: CropDirection,
  dx: number,
  dy: number,
  min: number = MIN_CROP,
): NormalizedRect {
  if (dir === "move") {
    return {
      ...start,
      x: clamp(start.x + dx, 0, 1 - start.width),
      y: clamp(start.y + dy, 0, 1 - start.height),
    };
  }

  let { x, y, width, height } = start;

  if (dir.includes("w")) {
    x = clamp(start.x + dx, 0, start.x + start.width - min);
    width = start.x + start.width - x;
  } else if (dir.includes("e")) {
    width = clamp(start.width + dx, min, 1 - start.x);
  }

  if (dir.includes("n")) {
    y = clamp(start.y + dy, 0, start.y + start.height - min);
    height = start.y + start.height - y;
  } else if (dir.includes("s")) {
    height = clamp(start.height + dy, min, 1 - start.y);
  }

  return { x, y, width, height };
}

/**
 * Converte para pixels da fonte.
 *
 * Arredonda para par porque o H.264 em yuv420p nao aceita largura ou altura
 * impar: um crop de 911px falharia so na hora de exportar (spec §49).
 */
export function toPixels(rect: NormalizedRect, width: number, height: number): PixelRect {
  // O limite tambem precisa ser par. Arredondar para par e so depois limitar ao
  // tamanho da fonte devolvia valor impar quando a fonte tinha lado impar — e
  // ai o H.264 recusava so na hora de exportar, longe da causa.
  const w = Math.min(evenUp(rect.width * width), evenDown(width));
  const h = Math.min(evenUp(rect.height * height), evenDown(height));
  return {
    x: clamp(Math.round(rect.x * width), 0, Math.max(0, width - w)),
    y: clamp(Math.round(rect.y * height), 0, Math.max(0, height - h)),
    width: w,
    height: h,
  };
}

/** Par mais próximo, nunca abaixo de 2. */
export function evenUp(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

/** Par que não ultrapassa o valor — para quando o número é um limite. */
export function evenDown(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2);
}

export function fromPixels(rect: PixelRect, width: number, height: number): NormalizedRect {
  if (width <= 0 || height <= 0) return { ...FULL_FRAME };
  return clampRect({
    x: rect.x / width,
    y: rect.y / height,
    width: rect.width / width,
    height: rect.height / height,
  });
}

/** Um recorte que cobre o quadro inteiro não é recorte — não vale gastar encode. */
export function isFullFrame(rect: NormalizedRect, epsilon = 0.001): boolean {
  return (
    Math.abs(rect.x) < epsilon &&
    Math.abs(rect.y) < epsilon &&
    Math.abs(rect.width - 1) < epsilon &&
    Math.abs(rect.height - 1) < epsilon
  );
}
