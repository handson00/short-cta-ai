"use client";

import { useCallback, useEffect, useState } from "react";
import type { VideoDetail } from "@/lib/viewTypes";
import { CONFIDENCE_LABEL, REGION_LABEL, TEXT_KIND_LABEL } from "@/lib/format";
import { aspectRatioStyle } from "@/lib/aspect";
import StatusBadge from "./StatusBadge";
import CopyButton from "./CopyButton";
import CommentsPanel from "./CommentsPanel";

function sanitizeDetail(input: VideoDetail): VideoDetail {
  return {
    ...input,
    frames: Array.isArray(input.frames) ? input.frames : [],
    suggestions: Array.isArray(input.suggestions) ? input.suggestions : [],
    suggestionsByStyle: Array.isArray(input.suggestionsByStyle) ? input.suggestionsByStyle : [],
    visibleText: Array.isArray(input.visibleText) ? input.visibleText : [],
    limitations: Array.isArray(input.limitations) ? input.limitations : [],
    selection: input.selection ?? { chosenCtaId: null, editedText: null, favorite: false, updatedAt: null },
    source: input.source ?? { folder: null, username: null, videoDate: null, platform: null, platformVideoId: null, originalUrl: null, embedUrl: null, identified: false },
  };
}

export default function VideoDetailView({ videoId }: { videoId: string }) {
  const [detail, setDetail] = useState<VideoDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ctaDraft, setCtaDraft] = useState("");
  const [workTitle, setWorkTitle] = useState("");
  const [workYear, setWorkYear] = useState("");
  const [showTranscript, setShowTranscript] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/videos/${videoId}`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as VideoDetail;
        const safe = sanitizeDetail(data);
        setDetail(safe);
        setCtaDraft(safe.manualCtaText ?? safe.existingCta?.text ?? "");
        setWorkTitle(safe.workDetail?.title ?? "");
        setWorkYear(safe.workDetail?.year?.toString() ?? "");
        setError(null);
      } else {
        setError("Falha ao carregar detalhes do vídeo.");
      }
    } catch {
      setError("Erro de conexão ao carregar detalhes.");
    } finally {
      setLoading(false);
    }
  }, [videoId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Polling para atualizar status durante processamento
  useEffect(() => {
    if (!detail) return;
    const active = ["queued", "extracting_media", "transcribing", "reading_text", "analyzing_scene", "identifying_work", "generating_ctas"].includes(detail.status);
    if (!active) return;
    const timer = setInterval(() => void refresh(), 2500);
    return () => clearInterval(timer);
  }, [detail?.status, refresh]);

  async function handleAction(action: string, body?: Record<string, unknown>) {
    if (!detail || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/videos/${detail.id}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const msg = (await res.json().catch(() => ({}))) as { error?: string };
        alert(msg.error ?? "Falha na operação.");
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-ink-400">Carregando detalhes…</p>;
  }

  if (error || !detail) {
    return <p className="text-sm text-red-400">{error ?? "Vídeo não encontrado."}</p>;
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold leading-snug">{detail.name}</h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-400">
            <StatusBadge status={detail.status} />
            {detail.durationSeconds != null && <span>{Math.round(detail.durationSeconds)}s</span>}
            {detail.aspectRatio && <span>{detail.aspectRatio}</span>}
            <span>{(detail.bytes / 1024 / 1024).toFixed(2)} MB</span>
          </div>
          {detail.errorMessage && (
            <p className="max-w-2xl text-xs text-red-400">{detail.errorMessage}</p>
          )}
        </div>
        <div className="flex gap-2">
          {["done", "error", "canceled"].includes(detail.status) && (
            <button className="btn-quiet text-xs" disabled={busy} onClick={() => void handleAction("reanalyze")}>
              {busy ? "Processando…" : "Analisar novamente"}
            </button>
          )}
          {detail.status === "error" && (
            <button className="btn-quiet text-xs" disabled={busy} onClick={() => void handleAction("retry")}>
              Tentar novamente
            </button>
          )}
          {["queued", "extracting_media", "transcribing", "reading_text", "analyzing_scene", "identifying_work", "generating_ctas"].includes(detail.status) && (
            <button className="btn-quiet text-xs" disabled={busy} onClick={() => void handleAction("cancel")}>
              Cancelar
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Coluna esquerda: mídia e análise */}
        <div className="space-y-6">
          {/* Player */}
          <section className="flex justify-center rounded-xl border border-ink-700 bg-black p-2 max-w-[320px] mx-auto">
            <video src={`/api/videos/${detail.id}/media`} controls className="w-full object-contain" poster={detail.hasThumbnail ? `/api/videos/${detail.id}/thumb` : undefined} />
          </section>

          {/* Frames de evidência */}
          {detail.frames.length > 0 && (
            <section className="space-y-2">
              <h2 className="label">Frames analisados ({detail.frames.length})</h2>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {detail.frames.map((frame) => (
                  <img
                    key={frame.id}
                    src={`/api/videos/${detail.id}/frames/${frame.id}`}
                    alt={`Frame ${(frame.timestampSeconds ?? 0).toFixed(1)}s`}
                    className="h-24 shrink-0 rounded border border-ink-700 object-cover"
                  />
                ))}
              </div>
            </section>
          )}

          {/* Limitações */}
          {detail.limitations.length > 0 && (
            <section className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <h2 className="text-xs font-medium uppercase tracking-wide text-amber-400">Limitações da análise</h2>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-amber-200/80">
                {detail.limitations.map((l: any) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </section>
          )}

          {/* CTA recomendado */}
          {detail.recommendedCta && (
            <section className="rounded-xl border border-accent/40 bg-accent/5 p-4">
              <p className="text-[10px] uppercase tracking-wide text-accent-soft">CTA recomendado</p>
              <p className="mt-1 text-lg font-medium leading-snug">{detail.recommendedCta.text}</p>
              <p className="hint mt-1">{detail.recommendedCta.reason}</p>
              <div className="mt-2 flex gap-2">
                <CopyButton text={detail.recommendedCta.text} />
              </div>
              {detail.analysisMeta && (
                <p className="hint mt-2 text-[10px]">
                  Prompt {detail.analysisMeta.promptVersion} · modelo {detail.analysisMeta.model ?? "—"}
                </p>
              )}
            </section>
          )}

          {/* CTA existente no vídeo */}
          {detail.existingCta && (
            <section className="rounded-xl border border-ink-700 bg-ink-900/60 p-4">
              <p className="text-[10px] uppercase tracking-wide text-ink-400">
                {detail.existingCta.confidence === "high" ? "CTA detectado no vídeo" : "Possível CTA encontrado"}
              </p>
              <p className="mt-1 text-base font-medium">
                {detail.existingCta.text}{" "}
                <span className="text-xs font-normal text-ink-400">
                  ({CONFIDENCE_LABEL[detail.existingCta.confidence] ?? detail.existingCta.confidence}, aos {(detail.existingCta.firstSeenAtSeconds ?? 0).toFixed(1)}s)
                </span>
              </p>
              {detail.existingCtaReview?.strength && (
                <p className="hint mt-1 text-[10px]">Ponto forte: {detail.existingCtaReview.strength}</p>
              )}
              {detail.existingCtaReview?.improvement && (
                <p className="hint text-[10px]">Melhoria possível: {detail.existingCtaReview.improvement}</p>
              )}
              <div className="mt-3 space-y-2">
                <label className="block text-[10px] uppercase tracking-wide text-ink-400">Correção manual do OCR</label>
                <textarea
                  value={ctaDraft}
                  onChange={(e) => setCtaDraft(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-ink-700 bg-ink-950/60 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-600 focus:border-accent focus:outline-none"
                  placeholder="Texto que aparece no vídeo…"
                />
                <button
                  className="btn-quiet text-xs"
                  disabled={busy || ctaDraft === (detail.manualCtaText ?? detail.existingCta?.text ?? "")}
                  onClick={() => void handleAction("existing-cta", { text: ctaDraft })}
                >
                  Salvar correção
                </button>
              </div>
            </section>
          )}

          {/* Textos lidos pelo OCR */}
          {detail.visibleText.length > 0 && (
            <details className="rounded-xl border border-ink-700 bg-ink-900/40 p-4">
              <summary className="cursor-pointer text-ink-400">Todos os textos lidos ({detail.visibleText.length})</summary>
              <ul className="mt-3 space-y-1 text-xs">
                {detail.visibleText.map((t, i) => (
                  <li key={i} className="flex flex-wrap gap-x-2 gap-y-0.5 border-b border-ink-800/60 pb-1 last:border-0">
                    <span className="font-mono text-ink-500">{(t.timestampSeconds ?? 0).toFixed(1)}s</span>
                    <span className="text-ink-300">"{t.text}"</span>
                    <span className="text-ink-500">
                      · {REGION_LABEL[t.region] ?? t.region} · {TEXT_KIND_LABEL[t.type] ?? t.type} · OCR {((t.ocrConfidence ?? 0) * 100).toFixed(0)}%
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {/* Identificação da obra */}
          {detail.workDetail?.status === "identified" && detail.workDetail.title ? (
            <section className="rounded-xl border border-ink-700 bg-ink-900/40 p-4">
              <p className="text-[10px] uppercase tracking-wide text-ink-400">Obra identificada</p>
              <p className="mt-1 text-sm font-medium">
                {detail.workDetail.title}
                {detail.workDetail.year ? ` (${detail.workDetail.year})` : ""}{" "}
                <span className="text-xs font-normal text-ink-500">
                  {CONFIDENCE_LABEL[detail.workDetail.confidence] ?? detail.workDetail.confidence}
                  {detail.workDetail.manuallyCorrected ? " · corrigido manualmente" : ""}
                </span>
              </p>
              {(detail.workDetail.evidence?.length ?? 0) > 0 && (
                <ul className="list-disc pl-4 text-xs text-ink-400">
                  {detail.workDetail!.evidence.map((e: any) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
              {(detail.workDetail.sources?.length ?? 0) > 0 && (
                <p className="hint">Fontes: {detail.workDetail!.sources.join(", ")}</p>
              )}
              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_80px]">
                <input
                  value={workTitle}
                  onChange={(e) => setWorkTitle(e.target.value)}
                  className="rounded-lg border border-ink-700 bg-ink-950/60 px-3 py-1.5 text-sm text-ink-100 placeholder:text-ink-600 focus:border-accent focus:outline-none"
                  placeholder="Título correto…"
                />
                <input
                  value={workYear}
                  onChange={(e) => setWorkYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  className="rounded-lg border border-ink-700 bg-ink-950/60 px-3 py-1.5 text-sm text-ink-100 placeholder:text-ink-600 focus:border-accent focus:outline-none"
                  placeholder="Ano"
                />
              </div>
              <button
                className="btn-quiet mt-2 text-xs"
                disabled={busy}
                onClick={() => void handleAction("work", { title: workTitle, year: workYear ? Number(workYear) : null })}
              >
                Salvar identificação
              </button>
            </section>
          ) : null}

          {/* Transcrição */}
          {detail.transcript && (
            <section className="rounded-xl border border-ink-700 bg-ink-900/40 p-4">
              <button
                className="flex w-full items-center justify-between text-left text-sm font-medium text-ink-200"
                onClick={() => setShowTranscript((v) => !v)}
              >
                <span>Transcrição {detail.transcript.hasSpeech ? "(fala detectada)" : "(sem fala)"}</span>
                <span className="text-xs text-ink-500">{showTranscript ? "Recolher" : "Expandir"}</span>
              </button>
              {showTranscript && (
                <div className="mt-3">
                  {!detail.transcript?.hasSpeech ? (
                    <p className="hint">Sem fala compreensível reconhecida neste vídeo.</p>
                  ) : (
                    <ul className="scroll-thin max-h-80 space-y-1 overflow-y-auto pr-2 text-sm">
                      {(detail.transcript?.segments ?? []).map((seg, i) => (
                        <li key={i} className="flex gap-2 border-b border-ink-800/60 pb-1 last:border-0">
                          <span className="shrink-0 font-mono text-[10px] text-ink-500">
                            {Math.floor(seg.start / 60)}:{String(Math.floor(seg.start % 60)).padStart(2, "0")}
                          </span>
                          <span className={seg.lowConfidence ? "text-ink-400 italic" : "text-ink-200"}>{seg.text}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {detail.transcript?.provider && (
                    <p className="hint mt-2">
                      Provedor: {detail.transcript!.provider}
                      {detail.transcript!.language ? ` · idioma ${detail.transcript!.language}` : ""}
                    </p>
                  )}
                </div>
              )}
            </section>
          )}
        </div>

        {/* Coluna direita: sugestões de CTA */}
        <aside className="space-y-4">
          {detail.suggestionsByStyle.length > 0 && (
            <section className="rounded-xl border border-ink-700 bg-ink-900/40 p-4">
              <h2 className="label">Sugestões de CTA ({detail.suggestions.length})</h2>
              <div className="space-y-4">
                {detail.suggestionsByStyle.map((group) => (
                  <div key={group.style}>
                    <p className="mb-1 text-[10px] uppercase tracking-wide text-accent-soft">{group.style}</p>
                    <ul className="space-y-2">
                      {group.items.map((item) => (
                        <li
                          key={item.id}
                          className={`relative rounded-lg border p-3 text-sm leading-snug transition ${
                            item.id === detail.selection.chosenCtaId
                              ? "border-accent bg-accent/10 text-white"
                              : "border-ink-700 bg-ink-950/40 text-ink-200 hover:border-ink-600"
                          }`}
                        >
                          <p>{item.text}</p>
                          {item.reason && <p className="hint mt-1 text-[10px]">{item.reason}</p>}
                          <div className="mt-2 flex gap-2">
                            <CopyButton text={item.text} compact />
                            <button
                              className="btn-quiet px-2 py-1 text-[10px]"
                              disabled={busy}
                              onClick={() => void handleAction("selection", { chosenCtaId: item.id })}
                            >
                              {item.id === detail.selection.chosenCtaId ? "Escolhido" : "Escolher"}
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex gap-2 border-t border-ink-800 pt-3">
                <button className="btn-quiet flex-1 text-xs" disabled={busy} onClick={() => void handleAction("regenerate")}>
                  Regenerar CTAs
                </button>
              </div>
            </section>
          )}

          {detail.suggestions.length === 0 && detail.status === "done" && (
            <p className="rounded-xl border border-ink-700 bg-ink-900/40 p-4 text-xs text-ink-400">
              Nenhum CTA gerado. A cena pode não ter elementos suficientes para criar um gancho persuasivo.
            </p>
          )}

          <CommentsPanel videoId={detail.id} postUrl={detail.source.originalUrl} />
        </aside>
      </div>
    </div>
  );
}