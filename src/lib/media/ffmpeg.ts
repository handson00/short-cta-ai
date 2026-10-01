import fs from "node:fs";
import path from "node:path";
import { env } from "../env";
import { run, binaryAvailable, CommandError } from "./run";
import { anchorTimestamps, averageHashFromGray, isNearDuplicate, selectFrameTimestamps } from "./frames";
import type { FrameRef } from "../types";
import { mapLimit } from "../concurrency";

/** ffmpegs simultâneos por vídeo; a fila já roda mais de um vídeo por vez. */
const FRAME_PARALLELISM = 4;

export interface MediaProbe {
  durationSeconds: number;
  width: number | null;
  height: number | null;
  aspectRatio: string | null;
  container: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
  hasAudio: boolean;
  hasVideo: boolean;
  bitrate: number | null;
  /**
   * Matriz de cor declarada no vídeo (`bt709`, `smpte170m`...), ou nula quando
   * o arquivo não declara. A exportação converte a partir dela — e parte do
   * acervo real vem em BT.601, não BT.709.
   */
  colorSpace: string | null;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
  color_space?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { duration?: string; format_name?: string; bit_rate?: string };
}

export async function ffmpegAvailable(): Promise<{ ffmpeg: boolean; ffprobe: boolean }> {
  const [ffmpeg, ffprobe] = await Promise.all([
    binaryAvailable(env.ffmpegPath),
    binaryAvailable(env.ffprobePath),
  ]);
  return { ffmpeg, ffprobe };
}

export async function probe(filePath: string): Promise<MediaProbe> {
  const { stdout } = await run(
    env.ffprobePath,
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath],
    { timeoutMs: 30_000 },
  );

  let data: FfprobeOutput;
  try {
    data = JSON.parse(stdout) as FfprobeOutput;
  } catch {
    throw new CommandError("ffprobe devolveu uma saida que nao pode ser lida", -1, "");
  }

  const streams = data.streams ?? [];
  const video = streams.find((s: any) => s.codec_type === "video");
  const audio = streams.find((s: any) => s.codec_type === "audio");
  const duration = Number(data.format?.duration ?? video?.duration ?? 0);

  const width = video?.width ?? null;
  const height = video?.height ?? null;

  return {
    durationSeconds: Number.isFinite(duration) ? duration : 0,
    width,
    height,
    aspectRatio: width && height ? simplifyRatio(width, height) : null,
    container: data.format?.format_name ?? null,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    hasAudio: Boolean(audio),
    hasVideo: Boolean(video),
    bitrate: data.format?.bit_rate ? Number(data.format.bit_rate) : null,
    colorSpace:
      video?.color_space && !["unknown", "reserved", "unspecified"].includes(video.color_space)
        ? video.color_space
        : null,
  };
}

function simplifyRatio(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const d = gcd(width, height) || 1;
  return `${width / d}:${height / d}`;
}

/** Audio mono 16 kHz: o que os modelos de fala esperam e o menor arquivo util. */
export async function extractAudio(videoPath: string, outputPath: string): Promise<string | null> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  try {
    await run(
      env.ffmpegPath,
      ["-y", "-i", videoPath, "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", outputPath],
      { timeoutMs: 300_000 },
    );
  } catch {
    return null;
  }
  const stat = fs.statSync(outputPath, { throwIfNoEntry: false });
  // Cabecalho WAV vazio tem ~44 bytes.
  return stat && stat.size > 1024 ? outputPath : null;
}

export async function extractThumbnail(videoPath: string, outputPath: string, atSeconds = 0.3): Promise<string | null> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  try {
    await run(
      env.ffmpegPath,
      ["-y", "-ss", String(atSeconds), "-i", videoPath, "-frames:v", "1", "-vf", "scale=-2:480", outputPath],
      { timeoutMs: 60_000 },
    );
    return fs.existsSync(outputPath) ? outputPath : null;
  } catch {
    return null;
  }
}

export interface ExtractedFrame extends FrameRef {
  phash: string;
}

/**
 * Extrai os frames escolhidos, calcula um average hash de cada um e descarta
 * os quase identicos: frames repetidos nao trazem evidencia nova e so gastam
 * OCR.
 */
export async function extractFrames(
  videoPath: string,
  durationSeconds: number,
  outputDir: string,
  maxFrames: number,
): Promise<{ frames: ExtractedFrame[]; skipped: number }> {
  // "Analisar novamente" recomeça do zero: frames de uma execução anterior não
  // podem sobreviver e virar evidência de uma leitura que não aconteceu.
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  const timestamps = selectFrameTimestamps(durationSeconds, maxFrames);
  // Comeco, meio e fim nunca sao descartados por semelhanca: num video de fundo
  // parado o average hash 8x8 nao percebe o texto sobreposto e jogaria fora
  // exatamente os frames que provam que o CTA fica o video inteiro.
  const anchors = new Set(anchorTimestamps(durationSeconds));

  // Extrair e calcular o hash não depende de nenhum outro frame: roda em
  // paralelo. O descarte por semelhança, esse sim, depende da ordem (compara
  // com os que já ficaram) e continua sequencial — o resultado é o mesmo de
  // antes, só que sem esperar um ffmpeg terminar para abrir o próximo.
  const extracted = await mapLimit(timestamps, FRAME_PARALLELISM, async (ts) => {
    const framePath = path.join(outputDir, `frame_${ts.toFixed(2).replace(".", "_")}.png`);
    try {
      await run(env.ffmpegPath, ["-y", "-ss", String(ts), "-i", videoPath, "-frames:v", "1", framePath], {
        timeoutMs: 60_000,
      });
    } catch {
      return null;
    }
    if (!fs.existsSync(framePath)) return null;
    return { ts, framePath, phash: await averageHash(framePath) };
  });

  const frames: ExtractedFrame[] = [];
  const hashes: string[] = [];
  let skipped = 0;

  for (const item of extracted) {
    if (!item) continue;
    const { ts, framePath, phash } = item;
    if (phash && !anchors.has(ts) && isNearDuplicate(phash, hashes)) {
      fs.rmSync(framePath, { force: true });
      skipped += 1;
      continue;
    }
    if (phash) hashes.push(phash);
    frames.push({ path: framePath, timestampSeconds: ts, phash });
  }

  return { frames, skipped };
}

async function averageHash(framePath: string): Promise<string> {
  try {
    const { stdoutBuffer } = await run(
      env.ffmpegPath,
      ["-v", "error", "-i", framePath, "-vf", "scale=8:8,format=gray", "-f", "rawvideo", "-"],
      { timeoutMs: 20_000, binaryStdout: true },
    );
    return averageHashFromGray(new Uint8Array(stdoutBuffer));
  } catch {
    return "";
  }
}

/** Dimensoes do frame, usadas para posicionar o texto detectado pelo OCR. */
export async function frameSize(framePath: string): Promise<{ width: number; height: number } | null> {
  try {
    const { stdout } = await run(
      env.ffprobePath,
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", framePath],
      { timeoutMs: 15_000 },
    );
    const [w, h] = stdout.trim().split(",").map(Number);
    return Number.isFinite(w) && Number.isFinite(h) ? { width: w, height: h } : null;
  } catch {
    return null;
  }
}
