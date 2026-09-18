"use client";

import { useCallback, useEffect, useState } from "react";
import type { VideoDetail } from "@/lib/viewTypes";
import { ACTIVE_STATUSES, STYLE_LABEL } from "@/lib/types";
import { CONFIDENCE_LABEL, REGION_LABEL, TEXT_KIND_LABEL, formatBytes, formatDuration, formatTimestamp } from "@/lib/format";
import { aspectRatioStyle } from "@/lib/aspect";
import StatusBadge from "./StatusBadge";
import CopyButton from "./CopyButton";

export default function VideoDetailView({ initial }: { initial: VideoDetail }) {
  const [detail, setDetail] = useState(initial);
  const [ctaDraft, setCtaDraft] = useState(initial.manualCtaText ?? initial.existingCta?.text ?? "");
  const [workTitle, setWorkTitle] = useState(initial.workDetail?.title ?? "");
  const [workYear, setWorkYear] = useState(initial.workDetail?.year?.toString() ?? "");
  const [showTranscript, setShowTranscript] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/videos/${initial.id}`, { cache: "no-store" });
    if (res.ok) setDetail((await res.json()) as VideoDetail);
  }, [initial.id]);

  const active = ACTIVE_STATUSES.includes(detail.status) || detail.status === "queued";

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => void refresh(), 2500);
    return () => clearInterval(interval);
  }, [active, refresh]);

  async function send(path: string, init: RequestInit) {
    setBusy(true);
    try {
      await fetch(path, init);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
      <div className="space-y-4">
        <section className="card overflow-hidden">
          <video
            controls
            preload="metadata"
            className="w-full bg-black"
            style={aspectRatioStyle(detail.aspectRatio)}
            poster={detail.hasThumbnail ? `/api/videos/${detail.id}/thumb` : undefined}
            src={`/api/videos/${detail.id}/media`}
          />
          <div className="space-y-1 p-3">
            <p className="truncate text-sm font-medium" title={detail.name}>
              {detail.name}
            </p>
            <p className="text-xs text-ink-400">
              {formatDuration(detail.durationSeconds)} · {detail.aspectRatio ?? "proporção desconhecida"} ·{" "}
              {formatBytes(detail.bytes)}
            </p>
            <StatusBadge status={detail.status} />
          </div>
        </section>

        {detail.frames.length > 0 && (
          <section className="card p-3">
            <h2 className="mb-2 text-sm font-medium">Frames de evidência</h2>
            <div className="grid grid-cols-3 gap-2">
              {detail.frames.map((frame) => (
                <figure key={frame.id} className="overflow-hidden rounded-lg border border-ink-800">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/videos/${detail.id}/frames/${frame.id}`}
                    alt={`Frame aos ${frame.timestampSeconds}s`}
                    className="w-full object-cover"
                    style={aspectRatioStyle(detail.aspectRatio)}
                    loading="lazy"
                  />
                  <figcaption className="px-1 py-0.5 text-center text-[10px] text-ink-500">
                    {frame.timestampSeconds.toFixed(1)}s
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}
      </div>

      <div className="space-y-4">
        {detail.limitations.length > 0 && (
          <section className="card border-amber-500/30 bg-amber-500/5 p-4">
            <h2 className="text-sm font-medium text-amber-300">O que não foi observado</h2>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-amber-200/80">
              {detail.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </section>
        )}

        <section className="card space-y-3 p-4">
          <h2 className="text-sm font-medium">Resumo da cena</h2>
          <p className="text-sm text-ink-200">{detail.sceneSummary ?? "Ainda não analisado."}</p>
          {detail.recommendedCta && (
            <div className="rounded-lg border border-accent/40 bg-accent/5 p-3">
              <p className="text-[11px] uppercase tracking-wide text-accent-soft">CTA recomendado</p>
              <p className="mt-1 text-lg font-medium leading-snug">{detail.recommendedCta.text}</p>
              <p className="hint mt-1">{detail.recommendedCta.reason}</p>
              <div className="mt-2">
                <CopyButton text={detail.recommendedCta.text} />
              </div>
            </div>
          )}
          {detail.analysisMeta && (
            <p className="hint">
              Prompt {detail.analysisMeta.promptVersion} · modelo {detail.analysisMeta.model ?? "—"}
            </p>
          )}
        </section>

        <section className="card space-y-3 p-4">
          <h2 className="text-sm font-medium">CTA já presente no vídeo</h2>
          {detail.existingCta ? (
            <p className="text-sm">
              {detail.existingCta.text}{" "}
              <span className="text-xs text-ink-400">
                ({CONFIDENCE_LABEL[detail.existingCta.confidence]}, aos {detail.existingCta.firstSeenAtSeconds.toFixed(1)}s)
              </span>
            </p>
          ) : (
            <p className="hint">Nenhum texto de destaque identificado com segurança.</p>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className="field"
              placeholder="Corrigir manualmente a leitura do OCR"
              value={ctaDraft}
              onChange={(e) => setCtaDraft(e.target.value)}
            />
            <button
              className="btn-ghost shrink-0"
              disabled={busy}
              onClick={() =>
                void send(`/api/videos/${detail.id}/existing-cta`, {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ text: ctaDraft }),
                })
              }
            >
              Salvar correção
            </button>
          </div>

          {detail.visibleText.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-ink-400">Todos os textos lidos ({detail.visibleText.length})</summary>
              <ul className="mt-2 space-y-1">
                {detail.visibleText.map((t, i) => (
                  <li key={`${t.text}-${i}`} className="rounded bg-ink-900/60 p-2">
                    <span className="text-ink-200">{t.text}</span>
                    <span className="ml-2 text-ink-500">
                      {t.timestampSeconds.toFixed(1)}s · {REGION_LABEL[t.region] ?? t.region} ·{" "}
                      {TEXT_KIND_LABEL[t.type] ?? t.type} · OCR {(t.ocrConfidence * 100).toFixed(0)}%
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <section className="card space-y-3 p-4">
          <h2 className="text-sm font-medium">Obra</h2>
          {detail.workDetail?.status === "identified" && detail.workDetail.title ? (
            <div className="space-y-1 text-sm">
              <p>
                {detail.workDetail.title}
                {detail.workDetail.year ? ` (${detail.workDetail.year})` : ""}{" "}
                <span className="text-xs text-ink-400">
                  {CONFIDENCE_LABEL[detail.workDetail.confidence] ?? detail.workDetail.confidence}
                  {detail.workDetail.manuallyCorrected ? " · corrigido manualmente" : ""}
                </span>
              </p>
              {detail.workDetail.evidence.length > 0 && (
                <ul className="list-disc pl-4 text-xs text-ink-400">
                  {detail.workDetail.evidence.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
              {detail.workDetail.sources.length > 0 && (
                <p className="hint">Fontes: {detail.workDetail.sources.join(", ")}</p>
              )}
            </div>
          ) : (
            <p className="hint">Obra não identificada com segurança.</p>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className="field"
              placeholder="Título correto"
              value={workTitle}
              onChange={(e) => setWorkTitle(e.target.value)}
            />
            <input
              className="field sm:w-28"
              placeholder="Ano"
              inputMode="numeric"
              value={workYear}
              onChange={(e) => setWorkYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
            />
            <button
              className="btn-ghost shrink-0"
              disabled={busy}
              onClick={() =>
                void send(`/api/videos/${detail.id}/work`, {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ title: workTitle, year: workYear ? Number(workYear) : null }),
                })
              }
            >
              Salvar obra
            </button>
          </div>
          <p className="hint">
            Identificar a obra ou gerar um título não concede direitos de uso do vídeo.
          </p>
        </section>

        {detail.suggestionsByStyle.length > 0 && (
          <section className="card space-y-3 p-4">
            <h2 className="text-sm font-medium">Sugestões por estilo</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {detail.suggestionsByStyle.map((group) => (
                <div key={group.style}>
                  <p className="mb-1 text-[11px] uppercase tracking-wide text-ink-400">
                    {STYLE_LABEL[group.style] ?? group.style}
                  </p>
                  <ul className="space-y-1.5">
                    {group.items.map((item) => (
                      <li key={item.id} className="flex items-start gap-2 rounded-lg bg-ink-900/60 p-2 text-sm">
                        <span className="flex-1">
                          {item.text}
                          {item.isRecommended && <span className="ml-1 text-[10px] text-accent-soft">recomendado</span>}
                          {item.origin === "original" && (
                            <span className="ml-1 text-[10px] text-ink-500">texto original</span>
                          )}
                        </span>
                        <CopyButton text={item.text} compact />
                        <button
                          className="btn-quiet px-2 py-1 text-xs"
                          disabled={busy}
                          onClick={() =>
                            void send(`/api/videos/${detail.id}/selection`, {
                              method: "PATCH",
                              headers: { "content-type": "application/json" },
                              body: JSON.stringify({ chosenCtaId: item.id, editedText: null, keepAsStyleExample: true }),
                            })
                          }
                        >
                          Escolher
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="card p-4">
          <button className="flex w-full items-center justify-between text-sm font-medium" onClick={() => setShowTranscript((v) => !v)}>
            Transcrição
            <span className="text-xs text-ink-400">{showTranscript ? "ocultar" : "mostrar"}</span>
          </button>
          {showTranscript && (
            <div className="mt-3">
              {!detail.transcript?.hasSpeech ? (
                <p className="hint">Sem fala compreensível reconhecida neste vídeo.</p>
              ) : (
                <ul className="scroll-thin max-h-80 space-y-1 overflow-y-auto pr-2 text-sm">
                  {detail.transcript.segments.map((seg, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="shrink-0 font-mono text-xs text-ink-500">{formatTimestamp(seg.start)}</span>
                      <span className={seg.lowConfidence ? "text-ink-400" : ""}>
                        {seg.text}
                        {seg.lowConfidence && <span className="ml-1 text-[10px] text-amber-400">baixa confiança</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {detail.transcript?.provider && (
                <p className="hint mt-2">
                  Provedor: {detail.transcript.provider}
                  {detail.transcript.language ? ` · idioma ${detail.transcript.language}` : ""}
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
