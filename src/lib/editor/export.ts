import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { env } from "../env";
import type { EditorTemplateConfig } from "../types";
import type { NormalizedRect } from "./crop";
import { buildFilterGraph } from "./filterGraph";
import { consumeProgress, newProgressState, type ProgressSnapshot } from "./progress";
import { containerArgs, videoEncoderArgs } from "./exportPreset";
import { probe } from "../media/ffmpeg";
import { DEFAULT_EFFECTS, effectsError, normalizeEffects, outputDuration, sourceWindow, type EditorEffects } from "./effects";
import { outputDir } from "./outputDir";

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
  /** Chave do processo para cancelamento: o id do job, não do vídeo. */
  jobId: string;
  videoId: string;
  sourcePath: string;
  originalName: string;
  sourceWidth: number;
  sourceHeight: number;
  durationSeconds: number;
  hasAudio: boolean;
  crop: NormalizedRect | null;
  template: EditorTemplateConfig;
  /** Camada de texto já renderizada (arquivo em `textLayersDir`), ou nula. */
  textLayer?: string | null;
  /** Efeitos do vídeo (aba Efeitos), fotografados no job. */
  effects?: EditorEffects | null;
  fps?: number;
  encoder?: string;
}

export interface ExportResult {
  outputPath: string;
  bytes: number;
}

export class ExportError extends Error {}

/**
 * Processos em andamento, para o cancelamento alcança-los (§113).
 *
 * Fica no `globalThis`, nao numa constante do modulo: o Next.js carrega uma
 * copia deste arquivo para o `instrumentation` (onde o worker roda) e outra
 * para as rotas de API. Com um Map por copia, a rota de cancelar procurava o
 * FFmpeg num mapa vazio e o render seguia ate o fim.
 */
const globalRef = globalThis as unknown as {
  __editorExportRunning?: Map<string, { kill: () => void; partial: string }>;
};
const running = (globalRef.__editorExportRunning ??= new Map());

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
  // O .processing também conta como ocupado: com exports em paralelo, dois
  // jobs do mesmo vídeo escolheriam o mesmo nome antes de qualquer um terminar.
  while (fs.existsSync(candidate) || fs.existsSync(`${candidate}.processing`)) {
    candidate = path.join(dir, `${base}_editado_${n}.mp4`);
    n++;
  }
  return candidate;
}

/**
 * Escolhe o nome e ja cria o `.processing` vazio, para reservar.
 *
 * Checar e criar acontecem sem `await` no meio, e o Node roda isso numa thread
 * so: nenhum outro job consegue escolher o mesmo nome entre as duas coisas.
 */
function reserveOutputPath(dir: string, originalName: string): string {
  const outputPath = uniqueOutputPath(dir, originalName);
  fs.closeSync(fs.openSync(`${outputPath}.processing`, "wx"));
  return outputPath;
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
  const fx = req.effects ? normalizeEffects(req.effects) : DEFAULT_EFFECTS;
  // Corte que não deixa vídeo vira erro claro antes do FFmpeg, não um MP4 vazio.
  const fxError = effectsError(req.durationSeconds, fx);
  if (fxError) throw new ExportError(fxError);
  // O progresso é medido no tempo do arquivo que sai (cortado e acelerado).
  const finalDuration = outputDuration(req.durationSeconds, fx) || req.durationSeconds;
  const textLayerPath = req.textLayer ? path.join(env.textLayersDir, path.basename(req.textLayer)) : null;

  // A matriz de cor não fica no banco: é lida da origem agora, porque a
  // conversão para BT.709 parte dela (parte do acervo vem em BT.601).
  let sourceColorSpace: string | null = null;
  try {
    sourceColorSpace = (await probe(req.sourcePath)).colorSpace;
  } catch {
    // Sem leitura, vale a convenção dos players (assumedColorSpace).
  }

  const graph = buildFilterGraph({
    crop: req.crop,
    sourceWidth: req.sourceWidth,
    sourceHeight: req.sourceHeight,
    durationSeconds: req.durationSeconds,
    sourceHasAudio: req.hasAudio,
    sourceColorSpace,
    template: t,
    fps,
    hasBackgroundImage: Boolean(t.background),
    hasOverlayImage: Boolean(t.overlay),
    hasLogoImage: Boolean(t.logo),
    hasTextLayer: Boolean(textLayerPath),
    effects: fx,
  });

  const asset = (name: string) => path.join(env.templatesDir, path.basename(name));
  const LABEL: Record<string, string> = {
    background: "A imagem de fundo do template",
    overlay: "O overlay do template",
    logo: "A logo do template",
    text: "A camada de texto deste vídeo",
    music: "A música do template",
  };
  const fileFor = (kind: (typeof graph.inputs)[number]): string =>
    kind === "text" ? textLayerPath! : kind === "music" ? asset(t.audio!.music!) : asset(t[kind]!);

  // Arquivo sumido vira erro claro antes de o FFmpeg subir, não um MP4 sem
  // logo nem um erro genérico do FFmpeg no meio do lote.
  for (const kind of graph.inputs) {
    if (kind === "background" && graph.colorSource) continue;
    if (!fs.existsSync(fileFor(kind))) {
      throw new ExportError(`${LABEL[kind]} não está mais no disco.`);
    }
  }

  const dir = outputDir();
  fs.mkdirSync(dir, { recursive: true });
  const outputPath = reserveOutputPath(dir, req.originalName);
  const partial = `${outputPath}.processing`;

  // Corte de início/fim na ENTRADA: o grafo recebe só o trecho escolhido, com
  // o tempo começando em zero — texto, fades e música ficam alinhados sem
  // nenhuma conta a mais. Vídeo e áudio de origem são cortados juntos.
  const trimArgs: string[] = [];
  if (req.durationSeconds > 0 && (fx.trimStart > 0 || fx.trimEnd > 0)) {
    const { start, length } = sourceWindow(req.durationSeconds, fx);
    if (start > 0) trimArgs.push("-ss", start.toFixed(3));
    trimArgs.push("-t", length.toFixed(3));
  }
  const args: string[] = ["-y", "-v", "error", "-progress", "pipe:1", ...trimArgs, "-i", req.sourcePath];

  // A ordem dos -i é a de graph.inputs; a entrada 1 é sempre o fundo. Imagens
  // entram em loop e a música em loop contínuo: o vídeo é a única fonte finita
  // e é ele que encerra o arquivo (ver filterGraph.ts).
  for (const kind of graph.inputs) {
    if (kind === "background" && graph.colorSource) {
      args.push("-f", "lavfi", "-i", graph.colorSource);
    } else if (kind === "music") {
      args.push("-stream_loop", "-1", "-i", fileFor(kind));
    } else {
      args.push("-loop", "1", "-i", fileFor(kind));
    }
  }

  args.push("-filter_complex", graph.filterComplex, "-map", `[${graph.outputLabel}]`);
  if (graph.audioLabel) args.push("-map", `[${graph.audioLabel}]`);

  args.push(
    ...videoEncoderArgs(req.encoder ?? "libx264", fps),
    // Inclui `-f mp4`: o arquivo temporário termina em `.processing`, e o
    // FFmpeg deduziria o formato pela extensão e recusaria.
    ...containerArgs(graph.audioLabel !== null, fps),
    "-shortest",
    partial,
  );

  return new Promise<ExportResult>((resolve, reject) => {
    const child = spawn(env.ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    const state = newProgressState();
    const errLines: string[] = [];
    let cancelled = false;

    running.set(req.jobId, {
      partial,
      kill: () => {
        cancelled = true;
        child.kill("SIGKILL");
      },
    });

    child.stdout.on("data", (c: Buffer) => {
      const snap = consumeProgress(state, c.toString("utf8"), finalDuration);
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
      running.delete(req.jobId);
      cleanupPartial();
      reject(new ExportError(`Não foi possível executar o FFmpeg: ${err.message}`));
    });

    child.on("close", (code) => {
      running.delete(req.jobId);

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

export function cancelExport(jobId: string): boolean {
  const job = running.get(jobId);
  if (!job) return false;
  job.kill();
  return true;
}

export function isExporting(jobId: string): boolean {
  return running.has(jobId);
}
