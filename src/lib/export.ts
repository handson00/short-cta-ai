import * as repo from "./repo";
import { STATUS_LABEL, type JobStatus } from "./types";

export interface ExportRow {
  arquivo: string;
  obra: string;
  confianca_obra: string;
  cta_original: string;
  cta_recomendado: string;
  cta_escolhido: string;
  alternativas: string;
  status: string;
}

export const CSV_COLUMNS: (keyof ExportRow)[] = [
  "arquivo",
  "obra",
  "confianca_obra",
  "cta_original",
  "cta_recomendado",
  "cta_escolhido",
  "alternativas",
  "status",
];

const CONFIDENCE_LABEL: Record<string, string> = { high: "alta", medium: "média", low: "baixa" };

export function buildExportRows(videoIds?: string[]): ExportRow[] {
  const jobs = repo.latestJobsByVideo();
  const videos = repo.listVideos().filter((v) => !videoIds || videoIds.includes(v.id));

  return videos.map((video) => {
    const job = jobs.get(video.id);
    const suggestions = repo.listSuggestions(video.id);
    const selection = repo.getSelection(video.id);
    const work = repo.getWork(video.id);
    const visual = repo.getVisualAnalysis(video.id);
    const existing = repo.effectiveExistingCta(visual);
    const recommended = suggestions.find((s) => s.isRecommended);

    const chosen =
      selection.editedText ??
      suggestions.find((s) => s.id === selection.chosenCtaId)?.text ??
      "";

    return {
      arquivo: video.originalName,
      obra: work?.status === "identified" && work.title ? work.title : "",
      confianca_obra: work?.status === "identified" ? (CONFIDENCE_LABEL[work.confidence] ?? work.confidence) : "",
      cta_original: existing?.text ?? "",
      cta_recomendado: recommended?.text ?? "",
      cta_escolhido: chosen,
      alternativas: suggestions
        .filter((s) => !s.isRecommended)
        .map((s) => `${s.text} [${s.style}]`)
        .join(" | "),
      status: STATUS_LABEL[(job?.status ?? "queued") as JobStatus] ?? (job?.status ?? ""),
    };
  });
}

/**
 * Escapa um campo de CSV.
 *
 * Alem de virgulas, aspas e quebras de linha, neutraliza conteudo que uma
 * planilha interpretaria como formula: um CTA que comece com "=" ou "+" viraria
 * calculo ao abrir o arquivo no Excel.
 */
export function escapeCsvField(value: string): string {
  let out = value ?? "";
  if (/^[=+\-@\t\r]/.test(out)) out = `'${out}`;
  if (/[",\n\r]/.test(out)) out = `"${out.replaceAll('"', '""')}"`;
  return out;
}

export function toCsv(rows: ExportRow[]): string {
  const header = CSV_COLUMNS.join(",");
  const body = rows.map((row) => CSV_COLUMNS.map((c) => escapeCsvField(row[c])).join(","));
  // BOM para o Excel reconhecer UTF-8; CRLF por compatibilidade.
  return `﻿${[header, ...body].join("\r\n")}\r\n`;
}

export function buildExportJson(videoIds?: string[]): unknown {
  const jobs = repo.latestJobsByVideo();
  const videos = repo.listVideos().filter((v) => !videoIds || videoIds.includes(v.id));

  return {
    exportedAt: new Date().toISOString(),
    total: videos.length,
    videos: videos.map((video) => {
      const analysis = repo.latestSceneAnalysis(video.id);
      const visual = repo.getVisualAnalysis(video.id);
      const selection = repo.getSelection(video.id);
      const suggestions = repo.listSuggestions(video.id);
      return {
        file: video.originalName,
        durationSeconds: video.durationSeconds,
        aspectRatio: video.aspectRatio,
        status: jobs.get(video.id)?.status ?? "queued",
        sceneSummary: analysis?.sceneSummary ?? null,
        analysisLimitations: analysis?.analysisLimitations ?? [],
        existingCta: repo.effectiveExistingCta(visual),
        work: repo.getWork(video.id) ?? null,
        recommendedCta: analysis?.recommended ?? null,
        suggestions: suggestions.map((s) => ({
          text: s.text,
          style: s.style,
          origin: s.origin,
          recommended: s.isRecommended,
        })),
        selection: {
          chosenText:
            selection.editedText ?? suggestions.find((s) => s.id === selection.chosenCtaId)?.text ?? null,
          edited: Boolean(selection.editedText),
          favorite: selection.favorite,
        },
        promptVersion: analysis?.promptVersion ?? null,
        model: analysis?.model ?? null,
      };
    }),
  };
}
