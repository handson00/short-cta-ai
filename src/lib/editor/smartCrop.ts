import { env } from "../env";
import { run } from "../media/run";
import { detectContentRect, temporalMotion, type MotionAnalysis } from "./motion";

/**
 * Smart Crop V1 (spec §13-§22).
 *
 * Deterministico, sem modelo de IA: §142 pede que a primeira versao seja
 * previsivel e funcione offline, sem GPU.
 */

/** Spec §14 sugere de 12 a 24 frames. 16 cobre o corte sem encarecer a análise. */
const FRAME_COUNT = 16;

/**
 * Largura da análise. O objetivo é localizar um retângulo, não ler texto —
 * analisar em 1080 seria ~36x mais pixels pelo mesmo resultado (§14, §74).
 */
const ANALYSIS_WIDTH = 180;

/** Spec §14: evitar o primeiro e o último segundo (fade, intro, encerramento). */
const EDGE_SKIP_SECONDS = 1;

export interface SmartCropResult extends MotionAnalysis {
  framesAnalyzed: number;
}

export class SmartCropError extends Error {}

/**
 * Le N frames em tons de cinza, ja reduzidos, direto da saida do FFmpeg.
 *
 * `-f rawvideo -pix_fmt gray` devolve um byte por pixel, sem cabecalho: nao ha
 * PNG para decodificar e o projeto nao ganha uma dependencia de imagem.
 */
async function extractGrayFrames(
  videoPath: string,
  durationSeconds: number,
  width: number,
  height: number,
): Promise<{ frames: Uint8Array[]; w: number; h: number }> {
  const w = ANALYSIS_WIDTH;
  // Altura par: o scaler do FFmpeg recusa dimensão ímpar em vários formatos.
  const h = Math.max(2, Math.round((ANALYSIS_WIDTH * height) / width / 2) * 2);

  const usable = durationSeconds - EDGE_SKIP_SECONDS * 2;
  // Vídeo curto demais para descartar as pontas: usa ele inteiro em vez de
  // devolver uma janela negativa.
  const start = usable > 1 ? EDGE_SKIP_SECONDS : 0;
  const window = usable > 1 ? usable : durationSeconds;
  const fps = FRAME_COUNT / window;

  const { stdoutBuffer } = await run(
    env.ffmpegPath,
    [
      "-v", "error",
      "-ss", String(start),
      "-t", String(window),
      "-i", videoPath,
      "-vf", `fps=${fps.toFixed(6)},scale=${w}:${h},format=gray`,
      "-frames:v", String(FRAME_COUNT),
      "-f", "rawvideo",
      "-pix_fmt", "gray",
      "-",
    ],
    { timeoutMs: 120_000, binaryStdout: true },
  );

  const frameSize = w * h;
  const count = Math.floor(stdoutBuffer.length / frameSize);
  if (count < 2) {
    throw new SmartCropError(
      "O FFmpeg devolveu menos de dois frames — não dá para medir variação temporal.",
    );
  }

  const frames: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    frames.push(new Uint8Array(stdoutBuffer.subarray(i * frameSize, (i + 1) * frameSize)));
  }
  return { frames, w, h };
}

export async function analyzeSmartCrop(
  videoPath: string,
  videoWidth: number,
  videoHeight: number,
  durationSeconds: number,
): Promise<SmartCropResult> {
  if (!videoWidth || !videoHeight || !durationSeconds) {
    throw new SmartCropError("Vídeo sem resolução ou duração conhecidas; rode a análise antes.");
  }

  const { frames, w, h } = await extractGrayFrames(videoPath, durationSeconds, videoWidth, videoHeight);
  const motion = temporalMotion(frames, w, h);
  const analysis = detectContentRect(motion, w, h);

  return { ...analysis, framesAnalyzed: frames.length };
}
