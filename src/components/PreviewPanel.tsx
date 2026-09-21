"use client";

import { useCallback, useEffect, useState } from "react";
import type { VideoDetail, VideoSummary } from "@/lib/viewTypes";
import { ACTIVE_STATUSES, STYLE_LABEL } from "@/lib/types";
import { CONFIDENCE_LABEL, formatDuration } from "@/lib/format";
import { formatDateBR, PLATFORM_LABEL } from "@/lib/source";
import { aspectRatioStyle } from "@/lib/aspect";
import StatusBadge from "./StatusBadge";
import CopyButton from "./CopyButton";
import CommentsPanel, { urlDeCaptura } from "./CommentsPanel";
import ErrorBoundary from "./ErrorBoundary";

interface Props {
  videoSummary: VideoSummary | null;
  onChanged: () => void;
  onClose: () => void;
}

export default function PreviewPanel({ videoSummary, onChanged, onClose }: Props) {
  const [detail, setDetail] = useState<VideoDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showEmbed, setShowEmbed] = useState(false);
  const [capture, setCapture] = useState<{ authorName: string | null; title: string | null; capturedAt: string } | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const loadDetail = useCallback(async (id: string) => {
    const res = await fetch(`/api/videos/${id}`, { cache: "no-store" });
    if (res.ok) setDetail((await res.json()) as VideoDetail);
  }, []);

  useEffect(() => {
    if (!videoSummary) {
      setDetail(null);
      setOpen(false);
      return;
    }
    setLoading(true);
    setShowEmbed(false);
    setCapture(null);
    setCaptureError(null);
    setDraft(videoSummary.chosenText ?? videoSummary.recommendedCta?.text ?? "");
    (async () => {
      await loadDetail(videoSummary.id);
      setLoading(false);
    })();
  }, [videoSummary, loadDetail]);

  const video = (detail ?? videoSummary) as VideoDetail | VideoSummary;
  if (!videoSummary) {
    return (
      <aside className="w-96 border-l border-ink-800 bg-ink-950/40 flex flex-col">
        <div className="p-3 border-b border-ink-800">
          <h2 className="text-xs font-medium">Detalhes</h2>
          <p className="hint text-[10px]">Selecione um vídeo para ver os detalhes</p>
        </div>
      </aside>
    );
  }

  async function act(label: string, path: string, init?: RequestInit) {
    setBusy(label);
    try {
      await fetch(path, init);
      onChanged();
      if (videoSummary) await loadDetail(videoSummary.id);
    } finally {
      setBusy(null);
    }
  }

  async function choose(ctaId: string | null, text?: string) {
    await act("choose", `/api/videos/${video.id}/selection`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chosenCtaId: ctaId, editedText: text ?? null }),
    });
  }

  const active = ACTIVE_STATUSES.includes(video.status ?? "queued");

  async function handleDelete() {
    const confirmed = window.confirm("Tem certeza que deseja excluir este vídeo? Esta ação não pode ser desfeita.");
    if (!confirmed) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/videos/${video.id}`, { method: "DELETE" });
      if (res.ok) {
        onChanged();
        onClose();
      } else {
        alert("Falha ao excluir vídeo.");
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <aside className="w-96 border-l border-ink-800 bg-ink-950/40 flex flex-col">
      <div className="p-3 border-b border-ink-800 flex items-center justify-between gap-2">
        <h2 className="text-xs font-medium">Detalhes do Vídeo</h2>
        <button className="btn-quiet px-2 py-1 text-[10px]" onClick={onClose}>
          Fechar
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="hint">Carregando…</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {video.hasThumbnail && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/videos/${video.id}/thumb`}
              alt=""
              className="w-full object-cover rounded-lg bg-ink-850"
              style={aspectRatioStyle(video.aspectRatio)}
            />
          )}

          <div>
            <div className="flex items-center gap-1.5">
              <StatusBadge status={video.status} />
              <h3 className="truncate text-xs font-medium" title={video.name}>
                {video.name}
              </h3>
            </div>
            <div className="mt-1 space-y-0.5 text-[10px] text-ink-400">
              <p>{formatDuration(video.durationSeconds)} · {video.aspectRatio}</p>
              <p>
                {(video.bytes / 1024 / 1024).toFixed(2)} MB · Criado em {new Date(video.createdAt).toLocaleString("pt-BR")}
              </p>
            </div>
          </div>

          {(video.source?.username || video.source?.originalUrl) && (
            <div className="rounded border border-ink-700 bg-ink-850/60 p-2 space-y-1">
              <p className="text-[10px] uppercase tracking-wide text-ink-400">
                Origem{video.source.platform ? ` ${PLATFORM_LABEL[video.source.platform] ?? video.source.platform}` : ""}
              </p>
              <div className="space-y-0.5 text-[10px]">
                {video.source.username && <p>Usuário: @{video.source.username}</p>}
                {video.source.videoDate && <p>Data: {formatDateBR(video.source.videoDate)}</p>}
                {video.source.platformVideoId && (
                  <p className="font-mono">ID: {video.source.platformVideoId}</p>
                )}

                {video.source.originalUrl ? (
                  <a
                    href={video.source.originalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline block truncate"
                    title="Abrir o post original em nova aba"
                  >
                    {video.source.originalUrl} ↗
                  </a>
                ) : (
                  <p className="text-ink-500">
                    Sem link: o nome do arquivo não traz o código do post.
                  </p>
                )}
              </div>

              {video.source.embedUrl && (
                <div className="space-y-1 pt-1">
                  <div className="flex flex-wrap gap-1">
                    <button className="btn-quiet px-2 py-0.5 text-[10px]" onClick={() => setShowEmbed((v) => !v)}>
                      {showEmbed ? "Fechar player" : "Abrir aqui"}
                    </button>
                    <button
                      className="btn-quiet px-2 py-0.5 text-[10px]"
                      disabled={capturing}
                      onClick={async () => {
                        setCapturing(true);
                        setCaptureError(null);
                        try {
                          const res = await fetch(`/api/videos/${video.id}/capture`, { method: "POST" });
                          const data = (await res.json().catch(() => ({}))) as {
                            ok?: boolean; capture?: typeof capture; reason?: string; error?: string;
                          };
                          if (data.ok && data.capture) setCapture(data.capture);
                          else setCaptureError(data.reason ?? data.error ?? "Falha na captura.");
                        } finally {
                          setCapturing(false);
                        }
                      }}
                    >
                      {capturing ? "Capturando…" : "Capturar dados"}
                    </button>
                    {/* Comentários não vêm por aqui: oEmbed não os devolve. Quem
                        captura é a extensão, na aba do post. Este botão só abre
                        o post com o marcador que a autoriza. */}
                    {video.source.originalUrl && (
                      <a
                        className="btn-quiet px-2 py-0.5 text-[10px]"
                        href={urlDeCaptura(video.source.originalUrl) ?? video.source.originalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Capturar comentários ↗
                      </a>
                    )}
                    <a className="btn-quiet px-2 py-0.5 text-[10px]" href={`/video/${video.id}`}>
                      Ver detalhe
                    </a>
                  </div>

                  {showEmbed && (
                    <div className="space-y-0.5">
                      <iframe
                        src={video.source.embedUrl}
                        className="w-full rounded border border-ink-700 bg-black"
                        style={{ height: 560 }}
                        loading="lazy"
                        allow="autoplay; encrypted-media; picture-in-picture"
                        referrerPolicy="strict-origin-when-cross-origin"
                        title="Post original"
                      />
                      <p className="text-[9px] text-ink-500">
                        Player oficial de incorporação. A página completa não pode ser embutida: a plataforma
                        bloqueia iframe.
                      </p>
                    </div>
                  )}

                  {capture && (
                    <div className="rounded bg-ink-900/60 p-1.5 text-[10px] space-y-0.5">
                      {capture.authorName && <p>Autor: {capture.authorName}</p>}
                      {capture.title && <p className="text-ink-300">{capture.title}</p>}
                      <p className="text-ink-600">Capturado em {new Date(capture.capturedAt).toLocaleString("pt-BR")}</p>
                    </div>
                  )}
                  {captureError && <p className="text-[10px] text-amber-300">{captureError}</p>}
                </div>
              )}
            </div>
          )}

          {video.status === "error" && (
            <div className="rounded border border-red-500/30 bg-red-500/5 p-2 text-[10px] text-red-300">
              {video.errorMessage ?? "Falha no processamento."}
              <span className="ml-1 text-red-400/70">
                (tentativa {video.attempts} de {video.maxAttempts})
              </span>
            </div>
          )}

          {video.sceneSummary && (
            <div className="rounded border border-ink-700 bg-ink-850/60 p-2 space-y-1">
              <p className="text-[10px] uppercase tracking-wide text-ink-400">Resumo da Cena</p>
              <p className="text-xs leading-relaxed">{video.sceneSummary}</p>
            </div>
          )}

          {video.existingCta && (
            <div className="rounded border border-ink-700 bg-ink-850/60 p-2 space-y-1">
              <p className="text-[10px] uppercase tracking-wide text-ink-400">
                {video.existingCta.confidence === "high" ? "CTA detectado no vídeo" : "Possível CTA encontrado"} ·{" "}
                {CONFIDENCE_LABEL[video.existingCta.confidence] ?? video.existingCta.confidence} · aos{" "}
                {video.existingCta?.firstSeenAtSeconds?.toFixed(1) ?? "0.0"}s
              </p>
              <p className="text-xs">{video.existingCta.text}</p>
              {video.existingCtaReview?.strength && (
                <p className="hint text-[10px]">Ponto forte: {video.existingCtaReview.strength}</p>
              )}
              {video.existingCtaReview?.improvement && (
                <p className="hint text-[10px]">Melhoria possível: {video.existingCtaReview.improvement}</p>
              )}
            </div>
          )}

          {video.recommendedCta && (
            <div className="rounded border border-accent/40 bg-accent/5 p-2 space-y-1">
              <p className="text-[10px] uppercase tracking-wide text-accent-soft">CTA Recomendado</p>
              {editing ? (
                <div className="mt-1 space-y-1">
                  <textarea
                    className="field min-h-16 text-xs"
                    value={draft}
                    maxLength={200}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  <div className="flex gap-1">
                    <button
                      className="btn-primary text-[10px] px-2 py-1"
                      onClick={async () => {
                        await choose(null, draft.trim());
                        setEditing(false);
                      }}
                    >
                      Salvar
                    </button>
                    <button className="btn-quiet text-[10px] px-2 py-1" onClick={() => setEditing(false)}>
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-xs font-medium leading-snug">{video.recommendedCta.text}</p>
                  <p className="hint text-[10px]">{video.recommendedCta.reason}</p>
                </>
              )}
              {!editing && (
                <div className="flex gap-1">
                  <CopyButton text={video.recommendedCta.text} compact />
                  <button
                    className="btn-ghost text-[10px] px-2 py-1"
                    onClick={() => {
                      setDraft(video.chosenText ?? video.recommendedCta?.text ?? "");
                      setEditing(true);
                    }}
                  >
                    Editar
                  </button>
                </div>
              )}
            </div>
          )}

          {video.chosenText && (
            <p className="text-[10px] text-emerald-300">Escolhido: {video.chosenText}</p>
          )}

          <p className="text-[10px] text-ink-400">
            {video.work?.identified ? video.work.label : "Obra não identificada com segurança"}
          </p>

          <div className="space-y-2 pt-1">
            <div className="flex flex-wrap gap-1">
              {video.recommendedCta && <CopyButton text={video.recommendedCta.text} />}
              {video.recommendedCta && (
                <button
                  className="btn-ghost text-[10px] px-2 py-1"
                  onClick={() => {
                    setDraft(video.chosenText ?? video.recommendedCta?.text ?? "");
                    setEditing(true);
                  }}
                >
                  Editar
                </button>
              )}
              <button
                className="btn-ghost text-[10px] px-2 py-1"
                disabled={busy === "fav"}
                onClick={() =>
                  void act("fav", `/api/videos/${video.id}/selection`, {
                    method: "PATCH",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ favorite: !video.favorite }),
                  })
                }
              >
                {video.favorite ? "Desfavoritar" : "Favoritar"}
              </button>
            </div>

            <div className="flex flex-wrap gap-1">
              {video.status === "done" && (
                <button
                  className="btn-quiet text-[10px] px-2 py-1"
                  disabled={busy === "regen"}
                  onClick={() => void act("regen", `/api/videos/${video.id}/regenerate`, { method: "POST" })}
                >
                  Regenerar
                </button>
              )}
              {(video.status === "done" || video.status === "error" || video.status === "canceled") && (
                <button
                  className="btn-quiet text-[10px] px-2 py-1"
                  disabled={busy === "again"}
                  onClick={() => void act("again", `/api/videos/${video.id}/reanalyze`, { method: "POST" })}
                >
                  Reanalisar
                </button>
              )}
              {(video.status === "queued" || active) && (
                <button
                  className="btn-quiet text-[10px] px-2 py-1"
                  disabled={busy === "cancel"}
                  onClick={() => void act("cancel", `/api/videos/${video.id}/cancel`, { method: "POST" })}
                >
                  Cancelar
                </button>
              )}
              {video.status === "error" && (
                <button
                  className="btn-ghost text-[10px] px-2 py-1"
                  disabled={busy === "retry"}
                  onClick={() => void act("retry", `/api/videos/${video.id}/retry`, { method: "POST" })}
                >
                  Retentar
                </button>
              )}
              <button
                className="btn-ghost text-red-400 text-[10px] px-2 py-1"
                disabled={deleting}
                onClick={handleDelete}
              >
                {deleting ? "Excluindo…" : "Excluir"}
              </button>
            </div>

            {video.suggestionCount > 0 && detail?.suggestionsByStyle && (
              <div className="pt-1">
                <button
                  className="btn-quiet text-[10px] px-2 py-1 w-full"
                  onClick={() => setOpen(!open)}
                >
                  {open ? "Ocultar alternativas" : `Ver ${video.suggestionCount} alternativas`}
                </button>
                {open && (
                  <div className="mt-2 space-y-2">
                    {detail.suggestionsByStyle.map((group) => (
                      <div key={group.style}>
                        <p className="mb-1 text-[10px] uppercase tracking-wide text-ink-400">
                          {STYLE_LABEL[group.style] ?? group.style}
                        </p>
                        <ul className="space-y-1">
                          {group.items.map((item) => (
                            <li key={item.id} className="rounded bg-ink-900/60 p-1.5">
                              <div className="flex items-start gap-1">
                                <span className="flex-1 text-[10px]">{item.text}</span>
                                <CopyButton text={item.text} compact />
                                <button
                                  className="btn-quiet px-1 py-0.5 text-[10px]"
                                  onClick={() => void choose(item.id)}
                                  disabled={busy === "choose"}
                                >
                                  Escolher
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <ErrorBoundary>
              {video.id && video.source?.originalUrl ? (
                <CommentsPanel videoId={video.id} postUrl={video.source.originalUrl} compact />
              ) : video.id ? (
                <CommentsPanel videoId={video.id} postUrl={null} compact />
              ) : null}
            </ErrorBoundary>
          </div>
        </div>
      )}
    </aside>
  );
}
