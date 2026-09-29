/**
 * Leitura do `-progress pipe:1` do FFmpeg (spec §57).
 *
 * O formato e `chave=valor`, uma por linha, em blocos terminados por
 * `progress=continue` ou `progress=end`.
 *
 * O parser corta por /\r?\n/ e limpa o \r. Nao e zelo excessivo: foi
 * exatamente um \r nao tratado, na saida do Tesseract, que manteve o OCR deste
 * projeto "quebrado" por dois dias.
 */

export interface ProgressSnapshot {
  /** Segundos de vídeo já escritos. */
  outTimeSeconds: number;
  /** 0..100, quando a duração é conhecida. */
  percent: number | null;
  speed: number | null;
  done: boolean;
}

/** Sobra da leitura anterior: um chunk pode cortar uma linha ao meio. */
export interface ProgressState {
  buffer: string;
  outTimeSeconds: number;
  speed: number | null;
  done: boolean;
}

export function newProgressState(): ProgressState {
  return { buffer: "", outTimeSeconds: 0, speed: null, done: false };
}

function parseSpeed(raw: string): number | null {
  // Vem como "1.05x"; enquanto o FFmpeg não mediu nada, vem "N/A".
  const m = /^([0-9.]+)x$/.exec(raw.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Consome um pedaço da saída e devolve o estado mais recente.
 *
 * `durationSeconds` pode ser 0: sem duração não há percentual, e o snapshot
 * devolve `percent: null` em vez de um número inventado.
 */
export function consumeProgress(
  state: ProgressState,
  chunk: string,
  durationSeconds: number,
): ProgressSnapshot {
  state.buffer += chunk;
  const lines = state.buffer.split(/\r?\n/);
  // A última pode estar incompleta: fica para o próximo chunk.
  state.buffer = lines.pop() ?? "";

  for (const line of lines) {
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).replace(/\r/g, "").trim();

    if (key === "out_time_us" || key === "out_time_ms") {
      // Apesar do nome, `out_time_ms` do FFmpeg também vem em microssegundos.
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) state.outTimeSeconds = n / 1_000_000;
    } else if (key === "speed") {
      state.speed = parseSpeed(value);
    } else if (key === "progress") {
      if (value === "end") state.done = true;
    }
  }

  return {
    outTimeSeconds: state.outTimeSeconds,
    percent:
      durationSeconds > 0
        ? Math.max(0, Math.min(100, (state.outTimeSeconds / durationSeconds) * 100))
        : null,
    speed: state.speed,
    done: state.done,
  };
}

/**
 * Estimativa de tempo restante, so quando ha dado suficiente (§132).
 *
 * Devolve `null` em vez de prometer precisao: no comeco da renderizacao a
 * velocidade ainda oscila muito para valer como previsao.
 */
export function estimateRemainingSeconds(
  snapshot: ProgressSnapshot,
  durationSeconds: number,
): number | null {
  if (!snapshot.speed || snapshot.speed <= 0) return null;
  if (durationSeconds <= 0) return null;
  if (snapshot.outTimeSeconds < 1) return null;
  const restante = durationSeconds - snapshot.outTimeSeconds;
  if (restante <= 0) return 0;
  return restante / snapshot.speed;
}
