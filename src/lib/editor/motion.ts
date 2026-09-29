import { clampRect, type NormalizedRect } from "./crop";

/**
 * Deteccao da regiao util pela variacao temporal (spec §16-§21).
 *
 * A ideia: numa moldura de outra pagina, o quadro externo fica praticamente
 * parado e o filme no meio muda o tempo todo. Medindo quanto cada pixel varia
 * ao longo dos frames, a regiao do conteudo se separa sozinha.
 *
 * Este arquivo nao chama FFmpeg nem le disco: recebe os frames ja em tons de
 * cinza e devolve numeros. E o que permite testar a deteccao sem video.
 */

export interface MotionAnalysis {
  rect: NormalizedRect;
  /** 0..100. Spec §22: ≥85 alta, 60–84 revisar, <60 baixa. */
  confidence: number;
  /** false = o conteúdo ocupa o quadro inteiro; não há moldura para recortar. */
  hasBorder: boolean;
  insideMean: number;
  outsideMean: number;
}

/**
 * Quanto cada pixel varia entre frames consecutivos.
 *
 * Diferenca media absoluta, e nao variancia: uma mudanca lenta de iluminacao
 * inflaria a variancia do quadro inteiro e apagaria justamente o contraste
 * entre moldura parada e conteudo em movimento.
 */
export function temporalMotion(frames: Uint8Array[], width: number, height: number): Float32Array {
  const size = width * height;
  const out = new Float32Array(size);
  if (frames.length < 2) return out;

  for (let f = 1; f < frames.length; f++) {
    const prev = frames[f - 1];
    const curr = frames[f];
    for (let i = 0; i < size; i++) {
      out[i] += Math.abs(curr[i] - prev[i]);
    }
  }

  const pairs = frames.length - 1;
  for (let i = 0; i < size; i++) out[i] /= pairs;
  return out;
}

/** Média do movimento por coluna (índice x) e por linha (índice y). */
export function projections(
  motion: Float32Array,
  width: number,
  height: number,
): { columns: Float32Array; rows: Float32Array } {
  const columns = new Float32Array(width);
  const rows = new Float32Array(height);

  for (let y = 0; y < height; y++) {
    const rowStart = y * width;
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      const v = motion[rowStart + x];
      rowSum += v;
      columns[x] += v;
    }
    rows[y] = rowSum / width;
  }
  for (let x = 0; x < width; x++) columns[x] /= height;

  return { columns, rows };
}

/**
 * Media movel de janela 3: apaga pico de um pixel so.
 *
 * Efeito colateral aceito de proposito: o retangulo sai ate um pixel de analise
 * maior de cada lado. Sobrar e invisivel no video final; faltar corta conteudo,
 * que e o pior erro que esta deteccao pode cometer (§108).
 */
export function smooth(profile: Float32Array): Float32Array {
  const n = profile.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = profile[Math.max(0, i - 1)];
    const b = profile[i];
    const c = profile[Math.min(n - 1, i + 1)];
    out[i] = (a + b + c) / 3;
  }
  return out;
}

/**
 * Primeiro e ultimo indice em que o perfil passa de uma fracao do seu maximo.
 *
 * Primeiro/ultimo, e nao a maior sequencia continua: uma cena escura no meio do
 * corte derruba o movimento por alguns instantes, e pegar so o maior trecho
 * contiguo cortaria o conteudo ao meio.
 */
export function spanAboveFraction(profile: Float32Array, fraction: number): [number, number] {
  let max = 0;
  for (let i = 0; i < profile.length; i++) if (profile[i] > max) max = profile[i];
  if (max <= 0) return [0, profile.length - 1];

  const threshold = max * fraction;
  let start = -1;
  let end = -1;
  for (let i = 0; i < profile.length; i++) {
    if (profile[i] >= threshold) {
      if (start < 0) start = i;
      end = i;
    }
  }
  if (start < 0) return [0, profile.length - 1];
  return [start, end];
}

/** Abaixo disso o retângulo é indistinguível do quadro inteiro. */
const BORDER_EPSILON = 0.02;

export function detectContentRect(
  motion: Float32Array,
  width: number,
  height: number,
  fraction = 0.3,
): MotionAnalysis {
  const { columns, rows } = projections(motion, width, height);
  const [x0, x1] = spanAboveFraction(smooth(columns), fraction);
  const [y0, y1] = spanAboveFraction(smooth(rows), fraction);

  const rect = clampRect({
    x: x0 / width,
    y: y0 / height,
    width: (x1 - x0 + 1) / width,
    height: (y1 - y0 + 1) / height,
  });

  let insideSum = 0;
  let insideCount = 0;
  let outsideSum = 0;
  let outsideCount = 0;
  for (let y = 0; y < height; y++) {
    const inRow = y >= y0 && y <= y1;
    for (let x = 0; x < width; x++) {
      const v = motion[y * width + x];
      if (inRow && x >= x0 && x <= x1) {
        insideSum += v;
        insideCount++;
      } else {
        outsideSum += v;
        outsideCount++;
      }
    }
  }

  const insideMean = insideCount > 0 ? insideSum / insideCount : 0;
  const outsideMean = outsideCount > 0 ? outsideSum / outsideCount : 0;

  const hasBorder =
    rect.width < 1 - BORDER_EPSILON || rect.height < 1 - BORDER_EPSILON;

  // Sem moldura não há recorte a propor, e afirmar confiança sobre um
  // retângulo que é o quadro inteiro seria inventar certeza.
  if (!hasBorder || insideMean <= 0) {
    return { rect, confidence: 0, hasBorder, insideMean, outsideMean };
  }

  // Duas perguntas: o lado de fora está mesmo parado, e o movimento que existe
  // ficou mesmo dentro do retângulo?
  const separation = Math.max(0, Math.min(1, (insideMean - outsideMean) / insideMean));
  const total = insideSum + outsideSum;
  const capture = total > 0 ? insideSum / total : 0;

  return {
    rect,
    confidence: Math.round(100 * separation * capture),
    hasBorder,
    insideMean,
    outsideMean,
  };
}

export type ConfidenceLevel = "alta" | "revisar" | "baixa";

/** Faixas da spec §22. */
export function confidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= 85) return "alta";
  if (confidence >= 60) return "revisar";
  return "baixa";
}
