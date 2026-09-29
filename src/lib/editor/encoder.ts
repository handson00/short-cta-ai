import { env } from "../env";
import { run } from "../media/run";

/**
 * Escolha do encoder (spec §51-§53).
 *
 * Um encoder nao e considerado disponivel so por aparecer em `ffmpeg
 * -encoders` (§52): a lista mostra o que foi compilado, nao o que a maquina
 * consegue rodar. Uma build com NVENC numa maquina sem GPU NVIDIA lista o
 * encoder e falha ao inicializar — e a falha apareceria so no meio de um lote.
 */

/** Ordem da §53: GPU primeiro, CPU como garantia. */
export const ENCODER_PRIORITY = ["h264_nvenc", "h264_qsv", "h264_amf", "libx264"] as const;

export type EncoderMode = "auto" | "nvenc" | "qsv" | "amf" | "cpu";

const MODE_TO_ENCODER: Record<Exclude<EncoderMode, "auto">, string> = {
  nvenc: "h264_nvenc",
  qsv: "h264_qsv",
  amf: "h264_amf",
  cpu: "libx264",
};

/** O teste custa alguns segundos e a resposta não muda durante a execução. */
const cache = new Map<string, boolean>();

export async function encoderWorks(name: string): Promise<boolean> {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;

  let ok = false;
  try {
    await run(
      env.ffmpegPath,
      ["-f", "lavfi", "-i", "nullsrc=s=64x64:d=0.1", "-c:v", name, "-f", "null", "-"],
      { timeoutMs: 8_000 },
    );
    ok = true;
  } catch {
    ok = false;
  }
  cache.set(name, ok);
  return ok;
}

/**
 * Resolve o encoder a usar.
 *
 * Em `auto`, desce a lista ate achar um que inicialize. Um modo pedido
 * explicitamente que nao funciona **nao** cai para a CPU em silencio: o
 * usuario escolheu, e trocar por baixo faria a exportacao demorar dez vezes
 * mais sem nenhuma explicacao.
 */
export async function resolveEncoder(mode: EncoderMode = "auto"): Promise<string> {
  if (mode !== "auto") {
    const wanted = MODE_TO_ENCODER[mode];
    if (await encoderWorks(wanted)) return wanted;
    throw new Error(
      `O encoder ${wanted} não inicializa nesta máquina. Use "auto" ou escolha outro.`,
    );
  }

  for (const name of ENCODER_PRIORITY) {
    if (await encoderWorks(name)) return name;
  }
  throw new Error("Nenhum encoder H.264 disponível no FFmpeg instalado.");
}
