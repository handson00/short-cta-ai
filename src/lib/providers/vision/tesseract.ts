import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { env } from "../../env";
import { run, binaryAvailable, CommandError } from "../../media/run";
import { frameSize } from "../../media/ffmpeg";
import { classifyDetectedText, type OcrLine } from "../../pipeline/ctaDetection";
import type { FrameRef, VisionProvider, VisualAnalysis } from "../../types";

/**
 * VisionProvider baseado em OCR.
 *
 * Le o texto dos frames e classifica o que parece gancho, legenda ou marca
 * d'agua. NAO descreve a cena: nao ha modelo de visao aqui, e a limitacao e
 * declarada na saida em vez de preenchida com suposicoes.
 */
export class TesseractVisionProvider implements VisionProvider {
  readonly name = "tesseract-ocr";
  private availability: boolean | null = null;

  get available(): boolean {
    return this.availability !== false;
  }

  async checkAvailability(): Promise<boolean> {
    if (this.availability !== null) return this.availability;
    this.availability = await binaryAvailable(env.tesseractPath, "--version");
    return this.availability;
  }

  async analyzeFrames(frames: FrameRef[]): Promise<VisualAnalysis> {
    const limitations = ["Descrição visual indisponível; somente OCR executado."];

    if (!(await this.checkAvailability())) {
      return {
        provider: this.name,
        visibleText: [],
        sceneDescription: null,
        visualClues: [],
        existingCta: null,
        limitations: ["Tesseract não encontrado; nenhum texto foi lido do vídeo."],
      };
    }

    const lines: OcrLine[] = [];
    const falhas = new Set<string>();
    for (const frame of frames) {
      const size = (await frameSize(frame.path)) ?? { width: 1080, height: 1920 };
      const { lines: collected, error } = await this.ocrFrame(frame, size);
      if (error) falhas.add(error);
      lines.push(...collected);
    }

    // Um OCR que falhou nao pode parecer um video sem texto: sem esta
    // distincao, um pacote de idioma ausente vira "nenhum gancho encontrado"
    // em todos os videos, e nada na tela explica por que.
    for (const falha of falhas) limitations.push(`OCR falhou: ${falha}`);

    const { visibleText, existingCta } = classifyDetectedText(lines, frames.length);
    if (visibleText.length === 0 && falhas.size === 0) {
      limitations.push("Nenhum texto legível foi encontrado nos frames analisados.");
    }

    return {
      provider: this.name,
      visibleText,
      sceneDescription: null,
      visualClues: [],
      existingCta,
      limitations,
    };
  }

  private async ocrFrame(
    frame: FrameRef,
    size: { width: number; height: number },
  ): Promise<{ lines: OcrLine[]; error: string | null }> {
    // Texto sobreposto costuma ler melhor ampliado e com mais contraste.
    const enhanced = await this.enhance(frame.path);
    const targets = enhanced ? [enhanced, frame.path] : [frame.path];
    let lastError: string | null = null;

    try {
      for (const target of targets) {
        const scale = target === enhanced ? 2 : 1;
        const { lines, error } = await this.runTesseract(target, frame.timestampSeconds, size, scale);
        if (error) lastError = error;
        if (lines.length > 0) return { lines, error: null };
      }
    } finally {
      if (enhanced) fs.rmSync(enhanced, { force: true });
    }
    return { lines: [], error: lastError };
  }

  private async enhance(framePath: string): Promise<string | null> {
    // Nome único por chamada: com a fila rodando em paralelo, dois vídeos
    // teriam o mesmo basename de frame e um sobrescreveria o do outro.
    const unique = crypto.randomBytes(6).toString("hex");
    const out = path.join(os.tmpdir(), `ocr_${unique}_${path.basename(framePath)}`);
    try {
      await run(
        env.ffmpegPath,
        ["-y", "-v", "error", "-i", framePath, "-vf", "scale=iw*2:ih*2:flags=lanczos,format=gray,eq=contrast=1.6", out],
        { timeoutMs: 30_000 },
      );
      return fs.existsSync(out) ? out : null;
    } catch {
      return null;
    }
  }

  private async runTesseract(
    imagePath: string,
    timestampSeconds: number,
    size: { width: number; height: number },
    scale: number,
  ): Promise<{ lines: OcrLine[]; error: string | null }> {
    // "tsv" tambem existe como arquivo de configuracao dentro da pasta de
    // idiomas, mas ao apontar --tessdata-dir para uma pasta propria ele some e
    // o Tesseract volta a cuspir texto puro, que o parser abaixo nao entende.
    // O parametro direto nao depende de nenhum arquivo ao lado.
    const args = [imagePath, "stdout", "-l", env.tesseractLangs, "--psm", "11", "-c", "tessedit_create_tsv=1"];
    if (env.tessdataDir) args.push("--tessdata-dir", env.tessdataDir);

    try {
      const { stdout } = await run(env.tesseractPath, args, { timeoutMs: 90_000 });
      return { lines: parseTesseractTsv(stdout, timestampSeconds, size, scale), error: null };
    } catch (err) {
      return { lines: [], error: describeTesseractError(err, env.tesseractLangs) };
    }
  }
}

/** Traduz a saida de erro do Tesseract em algo acionavel. */
export function describeTesseractError(err: unknown, langs: string): string {
  const raw = err instanceof CommandError ? err.stderr : (err as Error).message;
  const texto = (raw || "").toLowerCase();

  if (texto.includes("failed loading language") || texto.includes("could not initialize tesseract")) {
    const faltando = langs
      .split("+")
      .filter((l) => texto.includes(`'${l}'`) || texto.includes(`${l}.traineddata`));
    const quais = faltando.length > 0 ? faltando.join(", ") : langs;
    return `pacote de idioma ausente (${quais}). Coloque o .traineddata em ./tessdata ou ajuste TESSERACT_LANGS.`;
  }
  if (texto.includes("excedeu")) return "o Tesseract excedeu o tempo limite.";
  const primeiraLinha = (raw || "erro desconhecido").split("\n").find((l) => l.trim()) ?? "erro desconhecido";
  return primeiraLinha.trim().slice(0, 200);
}

/** Agrupa palavras do TSV em linhas, com bbox e confianca media. */
export function parseTesseractTsv(
  tsv: string,
  timestampSeconds: number,
  size: { width: number; height: number },
  scale = 1,
): OcrLine[] {
  // O Tesseract do Windows escreve o TSV com CRLF. Sem remover o \r, a ultima
  // coluna do cabecalho vira "text\r", indexOf("text") devolve -1 e o parser
  // descarta TODA a leitura em silencio - o OCR parece "video sem texto".
  const rows = tsv
    .split(/\r?\n/)
    .map((r) => r.split("\t").map((c) => c.replace(/\r$/, "")));
  if (rows.length < 2) return [];
  const header = rows[0];
  const idx = (name: string) => header.indexOf(name);
  const iLeft = idx("left");
  const iTop = idx("top");
  const iWidth = idx("width");
  const iHeight = idx("height");
  const iConf = idx("conf");
  const iText = idx("text");
  if (iLeft < 0 || iText < 0) return [];

  interface Acc {
    words: string[];
    confs: number[];
    left: number;
    top: number;
    right: number;
    bottom: number;
  }
  const byLine = new Map<string, Acc>();

  for (const row of rows.slice(1)) {
    if (row.length <= iText) continue;
    const text = (row[iText] ?? "").trim();
    const conf = Number(row[iConf]);
    if (!text || !Number.isFinite(conf) || conf < 0) continue;

    const key = `${row[1]}|${row[2]}|${row[3]}|${row[4]}`;
    const left = Number(row[iLeft]) / scale;
    const top = Number(row[iTop]) / scale;
    const width = Number(row[iWidth]) / scale;
    const height = Number(row[iHeight]) / scale;
    if (![left, top, width, height].every(Number.isFinite)) continue;

    const acc = byLine.get(key);
    if (acc) {
      acc.words.push(text);
      acc.confs.push(conf);
      acc.left = Math.min(acc.left, left);
      acc.top = Math.min(acc.top, top);
      acc.right = Math.max(acc.right, left + width);
      acc.bottom = Math.max(acc.bottom, top + height);
    } else {
      byLine.set(key, {
        words: [text],
        confs: [conf],
        left,
        top,
        right: left + width,
        bottom: top + height,
      });
    }
  }

  const out: OcrLine[] = [];
  for (const acc of byLine.values()) {
    const text = acc.words.join(" ").trim();
    if (text.replace(/\W/g, "").length < 2) continue;
    out.push({
      text,
      left: acc.left,
      top: acc.top,
      width: acc.right - acc.left,
      height: acc.bottom - acc.top,
      confidence: acc.confs.reduce((a, b) => a + b, 0) / acc.confs.length / 100,
      frameWidth: size.width,
      frameHeight: size.height,
      timestampSeconds,
    });
  }
  return out;
}
