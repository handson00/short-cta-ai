import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { env } from "../env";
import type { EditorTemplateConfig } from "../types";
import type { NormalizedRect } from "./crop";
import { buildFilterGraph } from "./filterGraph";
import { consumeProgress, newProgressState, type ProgressSnapshot } from "./progress";

/**
 * Renderiza um video com o recorte e o template aplicados (spec §102).
 *
 * Regras que nao se negociam aqui:
 * - o arquivo de origem nunca e tocado (§67);
 * - nada e gravado direto no nome final: escreve em `.processing` e renomeia
 *   no fim, para um cancelamento nunca deixar um MP4 truncado com cara de
 *   pronto (§114);
 * - o nome de saida nunca sobrescreve um arquivo existente (§110).
 */

export interface ExportRequest {
  videoId: string;
  sourcePath: string;
  originalName: string;
  sourceWidth: number;
  sourceHeight: number;
  durationSeconds: number;
  hasAudio: boolean;
  crop: NormalizedRect | null;
  template: EditorTemplateConfig;
  fps?: number;
  encoder?: string;
}

export interface ExportResult {
  outputPath: string;
  bytes: number;
}

export class ExportError extends Error {}

/** Processos em andamento, para o cancelamento alcançá-los (§113). */
const running = new Map<string, { kill: () => void; partial: string }>();

/**
 * Nome de saida que nao sobrescreve nada (§110).
 *
 * Um export novo nunca apaga o resultado de um export anterior: se o usuario
 * ajustou o template e rodou de novo, ele ainda pode querer comparar.
 */
export function uniqueOutputPath(dir: string, originalName: string): string {
  const base = path.basename(originalName, path.extname(originalName));
  let candidate = path.join(dir, `${base}_editado.mp4`);
  let n = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base}_editado_${n}.mp4`);
    n++;
  }
  return candidate;
}

function encoderArgs(encoder: string): string[] {
  // NVENC/QSV/AMF não entendem -crf; cada um tem seu controle de qualidade.
  if (encoder === "libx264") return ["-c:v", "libx264", "-preset", "medium", "-crf", "20"];
  if (encoder === "h264_nvenc") return ["-c:v", "h264_nvenc", "-preset", "p4", "-cq", "23"];
  if (encoder === "h264_qsv") return ["-c:v", "h264_qsv", "-global_quality", "23"];
  if (encoder === "h264_amf") return ["-c:v", "h264_amf", "-quality", "balanced"];
  return ["-c:v", "libx264", "-preset", "medium", "-crf", "20"];
}

export async function renderVideo(
  req: ExportRequest,
  onProgress?: (snapshot: ProgressSnapshot) => void,
): Promise<ExportResult> {
  if (!req.sourceWidth || !req.sourceHeight) {
    throw new ExportError("Vídeo sem resolução conhecida; rode a análise antes de exportar.");
  }
  if (!fs.existsSync(req.sourcePath)) {
    throw new ExportError("O arquivo de origem não está mais no disco.");
  }

  const t = req.template;
  const fps = req.fps ?? 30;
  const graph = buildFilterGraph({
    crop: req.crop,
    sourceWidth: req.sourceWidth,
    sourceHeight: req.sourceHeight,
    template: t,
    fps,
    hasBackgroundImage: Boolean(t.background),
    hasOverlayImage: Boolean(t.overlay),
    hasLogoImage: Boolean(t.logo),
  });

  const asset = (name: string) => path.join(env.templatesDir, path.basename(name));
  for (const kind of graph.imageInputs) {
    const file = asset(t[kind]!);
    if (!fs.existsSync(file)) {
      throw new ExportError(`A imagem de ${kind} do template não está mais no disco.`);
    }
  }

  fs.mkdirSync(env.outputDir, { recursive: true });
  const outputPath = uniqueOutputPath(env.outputDir, req.originalName);
  const partial = `${outputPath}.processing`;

  const args: string[] = ["-y", "-v", "error", "-progress", "pipe:1", "-i", req.sourcePath];

  // A entrada 1 é sempre o fundo: imagem enviada ou cor sólida via lavfi.
  if (graph.colorSource) {
    args.push("-f", "lavfi", "-i", graph.colorSource);
  } else {
    args.push("-i", asset(t.background!));
  }
  for (const kind of graph.imageInputs) {
    if (kind === "background") continue;
    args.push("-i", asset(t[kind]!));
  }

  args.push("-filter_complex", graph.filterComplex, "-map", `[${graph.outputLabel}]`);

  if (req.hasAudio) {
    args.push("-map", "0:a:0?", "-c:a", "aac", "-b:a", "128k", "-ar", "48000");
  } else {
    args.push("-an");
  }

  args.push(
    ...encoderArgs(req.encoder ?? "libx264"),
    "-r", String(fps),
    "-movflags", "+faststart",
    "-shortest",
    // O container vai explícito porque o arquivo temporário termina em
    // `.processing`: o FFmpeg deduz o formato pela extensão e recusaria.
    "-f", "mp4",
    partial,
  );

  return new Promise<ExportResult>((resolve, reject) => {
    const child = spawn(env.ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    const state = newProgressState();
    const errLines: string[] = [];
    let cancelled = false;

    running.set(req.videoId, {
      partial,
      kill: () => {
        cancelled = true;
        child.kill("SIGKILL");
      },
    });

    child.stdout.on("data", (c: Buffer) => {
      const snap = consumeProgress(state, c.toString("utf8"), req.durationSeconds);
      onProgress?.(snap);
    });

    child.stderr.on("data", (c: Buffer) => {
      // Guarda só o suficiente para diagnosticar; não gigabytes de log (§115).
      if (errLines.length < 50) errLines.push(c.toString("utf8"));
    });

    const cleanupPartial = () => {
      try {
        if (fs.existsSync(partial)) fs.unlinkSync(partial);
      } catch {
        // Um parcial que não some não pode derrubar o relato do erro real.
      }
    };

    child.on("error", (err) => {
      running.delete(req.videoId);
      cleanupPartial();
      reject(new ExportError(`Não foi possível executar o FFmpeg: ${err.message}`));
    });

    child.on("close", (code) => {
      running.delete(req.videoId);

      if (cancelled) {
        cleanupPartial();
        reject(new ExportError("Exportação cancelada."));
        return;
      }
      if (code !== 0) {
        cleanupPartial();
        reject(new ExportError(errLines.join("").trim().slice(-800) || `FFmpeg falhou (código ${code}).`));
        return;
      }
      if (!fs.existsSync(partial)) {
        reject(new ExportError("O FFmpeg terminou sem erro, mas não gerou arquivo."));
        return;
      }

      // Só agora o arquivo ganha o nome definitivo: quem vir o .mp4 na pasta
      // sabe que está inteiro.
      fs.renameSync(partial, outputPath);
      resolve({ outputPath, bytes: fs.statSync(outputPath).size });
    });
  });
}

export function cancelExport(videoId: string): boolean {
  const job = running.get(videoId);
  if (!job) return false;
  job.kill();
  return true;
}

export function isExporting(videoId: string): boolean {
  return running.has(videoId);
}
