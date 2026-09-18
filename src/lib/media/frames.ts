/**
 * Selecao de instantes para extracao de frames.
 *
 * A especificacao pede comecar por 0, 0,5, 1, 2, 3 e 5 segundos (o texto de
 * destaque costuma entrar logo no inicio, as vezes depois de uma animacao) e
 * complementar com alguns frames representativos ao longo do video. Tudo
 * precisa se ajustar a duracao real: nao adianta pedir um frame aos 5s de um
 * video de 3s.
 */

export const EARLY_TIMESTAMPS = [0, 0.5, 1, 2, 3, 5];
const REPRESENTATIVE_FRACTIONS = [0.25, 0.4, 0.55, 0.7, 0.85];
const MIN_GAP_SECONDS = 0.25;

/**
 * Instantes-ancora para o CTA fixo (o texto que fica sobre o video inteiro).
 *
 * Comeco, meio e fim. O comeco NAO e o instante 0: muito Short abre com fade
 * ou com um quadro de transicao, e ler o zero e a forma mais facil de concluir
 * que o video nao tem texto quando ele tem. Um texto que aparece nos tres
 * instantes e, por definicao, o texto fixo do video - e essa persistencia e a
 * evidencia que separa o gancho de uma legenda de dialogo, que muda o tempo
 * todo.
 *
 * Estes tres frames sao protegidos do descarte por semelhanca: num video de
 * fundo parado, o average hash 8x8 nao enxerga a diferenca de um texto pequeno
 * e descartaria justamente os frames que provam a permanencia.
 */
export function anchorTimestamps(durationSeconds: number): number[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [0];
  const last = Math.max(0, durationSeconds - 0.05);
  if (last < 1) return [round2(last / 2)];

  // O inicio reaproveita um instante que a lista ja cobre (1s, ou 0.5s em
  // video muito curto) em vez de inventar um novo: o objetivo e so garantir
  // que ele nunca seja descartado, nao adensar ainda mais o comeco.
  const inicio = EARLY_TIMESTAMPS.filter((t) => t > 0 && t <= last)[0] ?? round2(last / 2);
  const meio = round2(durationSeconds * 0.5);
  const fim = round2(Math.min(last, durationSeconds * 0.92));
  return dedupe([inicio, meio, fim].sort((a, b) => a - b));
}

export function selectFrameTimestamps(durationSeconds: number, maxFrames: number): number[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [0];
  const limit = Math.max(2, Math.floor(maxFrames));
  // Margem para nao cair depois do ultimo quadro decodificavel.
  const last = Math.max(0, durationSeconds - 0.05);

  const early = EARLY_TIMESTAMPS.filter((t) => t <= last);
  if (early.length === 0) early.push(0);

  const representative = REPRESENTATIVE_FRACTIONS.map((f) => round2(durationSeconds * f)).filter((t) => t <= last);
  const anchors = anchorTimestamps(durationSeconds).filter((t) => t <= last);

  const merged = dedupe([...early, ...representative, ...anchors].sort((a, b) => a - b));
  if (merged.length <= limit) return merged;

  // Acima do limite: as ancoras de comeco/meio/fim entram primeiro, porque sao
  // elas que provam que um texto permanece o video inteiro. O que sobrar de
  // orcamento vai para os instantes iniciais, onde o gancho costuma estar.
  // O total nunca passa do limite - cada frame extra e uma chamada de OCR.
  const escolhidos = new Set<number>(anchors.slice(0, limit));
  for (const t of merged) {
    if (escolhidos.size >= limit) break;
    escolhidos.add(t);
  }
  return dedupe([...escolhidos].sort((a, b) => a - b)).slice(0, limit);
}

function dedupe(sorted: number[]): number[] {
  const out: number[] = [];
  for (const t of sorted) {
    if (out.length === 0 || t - out[out.length - 1] >= MIN_GAP_SECONDS) out.push(round2(t));
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Distancia de Hamming entre dois average hashes hexadecimais. */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Number.MAX_SAFE_INTEGER;
  let distance = 0;
  for (let i = 0; i < a.length; i += 1) {
    let xor = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (xor) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

/** Frames praticamente iguais nao acrescentam evidencia e custam OCR. */
export const NEAR_DUPLICATE_THRESHOLD = 5;

export function isNearDuplicate(hash: string, seen: string[]): boolean {
  return seen.some((h) => hammingDistance(hash, h) <= NEAR_DUPLICATE_THRESHOLD);
}

/** Average hash a partir de 64 bytes em escala de cinza (8x8). */
export function averageHashFromGray(bytes: Uint8Array): string {
  if (bytes.length < 64) return "";
  const pixels = bytes.subarray(0, 64);
  let sum = 0;
  for (const p of pixels) sum += p;
  const mean = sum / 64;
  let bits = "";
  for (const p of pixels) bits += p >= mean ? "1" : "0";
  let hex = "";
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}
