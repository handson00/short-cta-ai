"use client";

import { useEffect, useState } from "react";
import type { EditorCrop, EditorSystemStatus, EditorTemplate } from "@/lib/types";
import TemplatePanel from "./TemplatePanel";
import { aspectRatioStyle, parseRatio } from "@/lib/aspect";
import { clampRect, FULL_FRAME, type NormalizedRect } from "@/lib/editor/crop";
import CropOverlay from "./CropOverlay";
import CompositionPreview from "./CompositionPreview";

interface LibraryVideo {
  id: string;
  originalName: string;
  thumbnailPath: string | null;
  width: number | null;
  height: number | null;
  aspectRatio: string | null;
  durationSeconds: number | null;
  hasCta: boolean;
  ctaText: string | null;
  commentCount: number;
  hashtagCount: number;
  hasAnalysis: boolean;
  status: string;
  templateId: string | null;
}

export default function EditorShell() {
  const [status, setStatus] = useState<EditorSystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Biblioteca (fonte primária)
  const [libraryVideos, setLibraryVideos] = useState<LibraryVideo[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [previewVideoId, setPreviewVideoId] = useState<string | null>(null);

  // Recorte
  const [crops, setCrops] = useState<Record<string, EditorCrop>>({});
  const [rect, setRect] = useState<NormalizedRect>(FULL_FRAME);
  const [cropMode, setCropMode] = useState(true);
  const [panelTab, setPanelTab] = useState<"recorte" | "preview">("recorte");
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportDone, setExportDone] = useState<Array<{ name: string; path: string }>>([]);
  const [templates, setTemplates] = useState<EditorTemplate[]>([]);
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [detection, setDetection] = useState<{
    videoId: string;
    confidence: number;
    level: string;
    hasBorder: boolean;
  } | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "erro"; text: string } | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/editor/status").then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
      fetch("/api/editor/library").then((r) => (r.ok ? r.json() : { videos: [] })),
      fetch("/api/editor/crop").then((r) => (r.ok ? r.json() : { crops: {} })),
      fetch("/api/editor/templates").then((r) => (r.ok ? r.json() : { templates: [] })),
    ])
      .then(([statusData, libraryData, cropData, templateData]) => {
        setStatus(statusData);
        setLibraryVideos(libraryData.videos ?? []);
        setCrops(cropData.crops ?? {});
        setTemplates(templateData.templates ?? []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  // Ao trocar de vídeo, carrega o recorte salvo dele — ou o quadro inteiro.
  useEffect(() => {
    if (!previewVideoId) return;
    const saved = crops[previewVideoId];
    setRect(saved ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height } : FULL_FRAME);
  }, [previewVideoId, crops]);

  // A caixa marca para o lote; o clique no card abre o recorte. Antes um gesto
  // só fazia as duas coisas, e não dava para ver um vídeo sem selecioná-lo.
  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    if (selectedIds.size === libraryVideos.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(libraryVideos.map((v) => v.id)));
  }

  /**
   * Detecta e carrega o retângulo no editor, sem gravar. Quem decide é o
   * usuário (§22): a detecção avisa, não aplica por conta própria.
   */
  async function detectCrop(videoId: string) {
    setDetecting(true);
    setNotice(null);
    setDetection(null);
    try {
      const res = await fetch("/api/editor/smart-crop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoIds: [videoId], save: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

      const r = data.results?.[0];
      if (!r || r.error) throw new Error(r?.error ?? "Resposta inesperada da detecção.");

      if (!r.hasBorder) {
        setNotice({
          kind: "ok",
          text: "Nenhuma moldura detectada — o conteúdo ocupa o quadro inteiro. Nada a recortar.",
        });
        setDetection({ videoId, confidence: 0, level: "baixa", hasBorder: false });
        return;
      }

      setRect(r.rect);
      setCropMode(true);
      setDetection({ videoId, confidence: r.confidence, level: r.level, hasBorder: true });
    } catch (err) {
      setNotice({
        kind: "erro",
        text: err instanceof Error ? err.message : "Falha ao detectar o recorte.",
      });
    } finally {
      setDetecting(false);
    }
  }

  /** Detecção em lote: aqui grava, porque revisar 30 um a um anula o ganho. */
  async function detectBatch(videoIds: string[]) {
    if (videoIds.length === 0) return;
    setDetecting(true);
    setNotice(null);
    try {
      const res = await fetch("/api/editor/smart-crop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoIds, save: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

      const results: Array<{
        videoId: string;
        rect?: NormalizedRect;
        confidence?: number;
        level?: string;
        hasBorder?: boolean;
        saved?: boolean;
        error?: string | null;
      }> = data.results ?? [];

      setCrops((prev) => {
        const next = { ...prev };
        for (const r of results) {
          if (r.saved && r.rect) {
            next[r.videoId] = {
              ...r.rect,
              normalized: true,
              source: "auto",
              confidence: r.confidence,
            };
          }
        }
        return next;
      });

      const salvos = results.filter((r) => r.saved).length;
      const revisar = results.filter((r) => r.saved && r.level !== "alta").length;
      const semMoldura = results.filter((r) => !r.error && r.hasBorder === false).length;
      const falhas = results.filter((r) => r.error).length;

      // Cada número é dito separadamente: "30 detectados" esconderia que 8
      // precisam de revisão e 2 falharam.
      const partes = [`${salvos} recorte(s) detectado(s)`];
      if (revisar > 0) partes.push(`${revisar} com confiança baixa — revise`);
      if (semMoldura > 0) partes.push(`${semMoldura} sem moldura`);
      if (falhas > 0) partes.push(`${falhas} falhou(ram)`);

      setNotice({ kind: falhas > 0 ? "erro" : "ok", text: partes.join(" · ") });
    } catch (err) {
      setNotice({
        kind: "erro",
        text: err instanceof Error ? err.message : "Falha na detecção em lote.",
      });
    } finally {
      setDetecting(false);
    }
  }

  async function assignTemplate(templateId: string | null) {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setNotice(null);
    try {
      const res = await fetch("/api/editor/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoIds: ids, templateId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setLibraryVideos((prev) =>
        prev.map((v) => (selectedIds.has(v.id) ? { ...v, templateId } : v)),
      );
      setNotice({
        kind: "ok",
        text: templateId
          ? `Template aplicado a ${data.changed} vídeo(s).`
          : `Template removido de ${data.changed} vídeo(s).`,
      });
    } catch (err) {
      setNotice({
        kind: "erro",
        text: err instanceof Error ? err.message : "Falha ao aplicar o template.",
      });
    }
  }

  async function exportSelected() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;

    // Exportar com template diferente por vídeo exigiria uma chamada por
    // template; hoje o lote usa o template aberto no painel.
    if (!activeTemplateId) {
      setNotice({ kind: "erro", text: "Escolha um template no painel da esquerda antes de exportar." });
      return;
    }

    setExporting(true);
    setNotice(null);
    setExportDone([]);
    try {
      const res = await fetch("/api/editor/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoIds: ids, templateId: activeTemplateId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

      const results: Array<{ videoId: string; outputPath?: string; error?: string | null }> =
        data.results ?? [];
      const ok = results.filter((r) => r.outputPath);
      const falhas = results.filter((r) => r.error);

      setExportDone(
        ok.map((r) => ({
          name: libraryVideos.find((v) => v.id === r.videoId)?.originalName ?? r.videoId,
          path: r.outputPath!,
        })),
      );

      // Cada número separado: "12 exportados" esconderia os que falharam.
      const partes = [`${ok.length} vídeo(s) exportado(s) com ${data.encoder}`];
      if (falhas.length > 0) partes.push(`${falhas.length} falhou(ram): ${falhas[0].error}`);
      setNotice({ kind: falhas.length > 0 ? "erro" : "ok", text: partes.join(" · ") });
    } catch (err) {
      setNotice({
        kind: "erro",
        text: err instanceof Error ? err.message : "Falha ao exportar.",
      });
    } finally {
      setExporting(false);
    }
  }

  async function removeFromEditor(videoId: string) {
    setNotice(null);
    try {
      const res = await fetch(`/api/editor/queue?videoId=${encodeURIComponent(videoId)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setLibraryVideos((prev) => prev.filter((v) => v.id !== videoId));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(videoId);
        return next;
      });
      if (previewVideoId === videoId) setPreviewVideoId(null);
    } catch (err) {
      setNotice({
        kind: "erro",
        text: err instanceof Error ? err.message : "Falha ao remover o vídeo da edição.",
      });
    }
  }

  async function applyCrop(videoIds: string[]) {
    if (videoIds.length === 0) return;
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch("/api/editor/crop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoIds, crop: { ...rect, source: "manual" } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setCrops((prev) => {
        const next = { ...prev };
        for (const id of videoIds) {
          next[id] = { ...rect, normalized: true, source: "manual" };
        }
        return next;
      });
      setNotice({ kind: "ok", text: `Recorte salvo em ${data.saved} vídeo(s).` });
    } catch (err) {
      setNotice({ kind: "erro", text: err instanceof Error ? err.message : "Falha ao salvar o recorte." });
    } finally {
      setSaving(false);
    }
  }

  function formatDuration(seconds: number | null): string {
    if (seconds == null) return "--:--";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-ink-400">Verificando sistema…</div>;
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-900/50 bg-red-950/30 p-6 text-red-200">
        Erro ao verificar sistema: {error}
      </div>
    );
  }

  if (!status) return null;

  const allGood = status.ffmpeg && status.ffprobe;
  const previewVideo = libraryVideos.find((v) => v.id === previewVideoId) ?? null;
  const previewBox = previewVideo ? fitBox(previewVideo) : undefined;
  const activeTemplate = templates.find((t) => t.id === activeTemplateId) ?? null;

  return (
    // Sai do container central de 1152px do layout: com template à esquerda e
    // recorte à direita, a lista do meio ficava espremida em ~360px.
    <div className="mx-[calc(50%-50vw)] w-screen space-y-6 px-6">
      <header>
        <h1 className="text-2xl font-bold text-ink-100">Editor de Vídeos</h1>
        <p className="mt-1 text-sm text-ink-400">
          Recorte a região útil e aplique seu template em lote. Os vídeos entram pela Fila.
        </p>
      </header>

      <section className="rounded-xl border border-ink-800 bg-ink-900/50 p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-400">Status do Sistema</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
          <StatusBadge label="FFmpeg" ok={status.ffmpeg} />
          <StatusBadge label="FFprobe" ok={status.ffprobe} />
          <StatusBadge label="NVENC" ok={status.nvenc} optional />
          <StatusBadge label="Quick Sync" ok={status.qsv} optional />
          <StatusBadge label="AMF" ok={status.amf} optional />
          <StatusBadge label="libx264" ok={status.libx264} />
        </div>
        {!allGood && (
          <div className="mt-4 rounded-lg border border-amber-900/50 bg-amber-950/30 p-3 text-sm text-amber-200">
            ⚠ FFmpeg e/ou FFprobe não encontrados. Configure o caminho nas{" "}
            <a href="/settings" className="underline hover:text-amber-100">
              Configurações
            </a>{" "}
            ou instale o FFmpeg no sistema.
          </div>
        )}
      </section>

      {notice && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            notice.kind === "ok"
              ? "border-emerald-800 bg-emerald-950/40 text-emerald-200"
              : "border-red-900 bg-red-950/40 text-red-200"
          }`}
        >
          {notice.text}
        </div>
      )}

      {exporting && (
        <div className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent">
          Renderizando… os vídeos são processados um de cada vez. Não feche a página.
        </div>
      )}

      {exportDone.length > 0 && (
        <div className="rounded-lg border border-emerald-800 bg-emerald-950/30 px-4 py-3">
          <p className="text-sm font-medium text-emerald-200">
            {exportDone.length} arquivo(s) gerado(s)
          </p>
          <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-emerald-300/80">
            {exportDone.slice(0, 8).map((f) => (
              <li key={f.path} className="truncate" title={f.path}>
                {f.path}
              </li>
            ))}
          </ul>
          {exportDone.length > 8 && (
            <p className="mt-1 text-[11px] text-emerald-300/60">
              e mais {exportDone.length - 8}…
            </p>
          )}
        </div>
      )}

      <div className="flex gap-6">
        <TemplatePanel
          templates={templates}
          selectedId={activeTemplateId}
          onSelect={setActiveTemplateId}
          onSaved={(t) => {
            setTemplates((prev) => {
              const i = prev.findIndex((x) => x.id === t.id);
              if (i < 0) return [t, ...prev];
              const next = [...prev];
              next[i] = t;
              return next;
            });
            setActiveTemplateId(t.id);
          }}
          onDeleted={(id) => {
            setTemplates((prev) => prev.filter((t) => t.id !== id));
            setLibraryVideos((prev) =>
              prev.map((v) => (v.templateId === id ? { ...v, templateId: null } : v)),
            );
          }}
          onAssign={(id) => void assignTemplate(id)}
          previewThumb={previewVideo ? `/api/videos/${previewVideo.id}/thumb` : null}
          previewCrop={previewVideo ? (crops[previewVideo.id] ?? null) : null}
          previewVideoWidth={previewVideo?.width ?? 1080}
          previewVideoHeight={previewVideo?.height ?? 1920}
          assignCount={selectedIds.size}
        />
        <section className="min-w-0 flex-1 rounded-xl border border-ink-800 bg-ink-900/50 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-400">
              Na edição ({libraryVideos.length})
            </h2>
            {libraryVideos.length > 0 && (
              <button
                onClick={selectAll}
                className="rounded-md border border-ink-700 px-3 py-1 text-xs text-ink-300 transition hover:border-accent/50 hover:text-accent"
              >
                {selectedIds.size === libraryVideos.length ? "Desmarcar todos" : "Selecionar todos"}
              </button>
            )}
          </div>

          {libraryVideos.length === 0 ? (
            <div className="rounded-lg border border-dashed border-ink-700 bg-ink-900/30 p-8 text-center">
              <p className="text-sm text-ink-300">Nenhum vídeo na fase de edição.</p>
              <p className="mt-2 text-xs text-ink-500">
                Na{" "}
                <a href="/" className="text-accent underline hover:text-accent/80">
                  Fila
                </a>
                , selecione os vídeos já analisados e clique em{" "}
                <span className="text-ink-300">&ldquo;Enviar para edição&rdquo;</span>.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
              {libraryVideos.map((v, i) => {
                const isSelected = selectedIds.has(v.id);
                const isPreview = previewVideoId === v.id;
                return (
                  <div
                    key={v.id}
                    onClick={() => setPreviewVideoId(v.id)}
                    className={`cursor-pointer overflow-hidden rounded-lg border transition ${
                      isPreview
                        ? "border-accent bg-accent/10 ring-1 ring-accent/50"
                        : isSelected
                          ? "border-accent/60 bg-accent/5"
                          : "border-ink-700 bg-ink-950/60 hover:border-ink-600"
                    }`}
                  >
                    <div className="flex items-center justify-between border-b border-ink-800/80 px-3 py-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                        Vídeo {String(i + 1).padStart(2, "0")}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          title="Remover da edição"
                          onClick={(e) => {
                            e.stopPropagation();
                            void removeFromEditor(v.id);
                          }}
                          className="rounded px-1 text-sm leading-none text-ink-600 transition hover:bg-ink-800 hover:text-red-300"
                        >
                          ×
                        </button>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggleSelect(v.id)}
                          title="Selecionar para aplicar em lote"
                          className="h-4 w-4 cursor-pointer accent-accent"
                        />
                      </div>
                    </div>

                    <div className="flex gap-3 p-3">
                      {/* Proporção real do vídeo, igual à Fila: um Short vertical
                          num quadro 16:9 aparece cortado ou deitado. */}
                      <div
                        className="w-16 shrink-0 overflow-hidden rounded-md bg-ink-850"
                        style={aspectRatioStyle(v.aspectRatio)}
                      >
                        {v.thumbnailPath ? (
                          <img
                            src={`/api/videos/${v.id}/thumb`}
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="grid h-full place-items-center text-[9px] text-ink-500">
                            sem prévia
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-ink-200" title={v.originalName}>
                          {v.originalName}
                        </p>
                        <p className="mt-0.5 text-[10px] text-ink-500">
                          {formatDuration(v.durationSeconds)}
                          {v.width && v.height ? ` · ${v.width}×${v.height}` : ""}
                          {crops[v.id] ? " · Recorte personalizado" : ""}
                        </p>

                        {v.ctaText && (
                          <p className="mt-2 line-clamp-2 text-[11px] font-medium text-accent" title={v.ctaText}>
                            ★ {v.ctaText}
                          </p>
                        )}

                        <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
                          {crops[v.id] && (
                            <span className="rounded bg-accent/20 px-1 py-0.5 text-accent">Recorte</span>
                          )}
                          {v.templateId && (
                            <span className="rounded bg-accent/20 px-1 py-0.5 text-accent" title={templates.find((t) => t.id === v.templateId)?.name}>
                              Template
                            </span>
                          )}
                          {v.hasCta && (
                            <span className="rounded bg-emerald-900/50 px-1 py-0.5 text-emerald-300">CTA</span>
                          )}
                          {v.hasAnalysis && (
                            <span className="rounded bg-blue-900/50 px-1 py-0.5 text-blue-300">Análise</span>
                          )}
                          {v.commentCount > 0 && (
                            <span className="rounded bg-ink-800 px-1 py-0.5 text-ink-400">💬 {v.commentCount}</span>
                          )}
                          {v.hashtagCount > 0 && (
                            <span className="rounded bg-ink-800 px-1 py-0.5 text-ink-400"># {v.hashtagCount}</span>
                          )}
                        </div>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewVideoId(v.id);
                            setCropMode(true);
                          }}
                          className="mt-2 rounded-md border border-ink-700 px-2 py-1 text-[11px] text-ink-300 transition hover:border-accent/50 hover:text-accent"
                        >
                          ✂ Recortar
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {selectedIds.size > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent/10 px-4 py-3">
              <span className="text-sm text-accent">
                {selectedIds.size} selecionado(s). Ajuste o recorte ao lado e escolha onde aplicar.
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => void detectBatch([...selectedIds])}
                  disabled={detecting || exporting}
                  className="rounded-lg border border-accent/50 px-3 py-1.5 text-xs text-accent transition hover:bg-accent/10 disabled:opacity-50"
                >
                  {detecting ? "Analisando…" : `✨ Detectar recorte (${selectedIds.size})`}
                </button>
                <button
                  onClick={() => void exportSelected()}
                  disabled={exporting || detecting}
                  className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-accent/90 disabled:opacity-50"
                >
                  {exporting ? "Exportando…" : `⬇ Exportar ${selectedIds.size} vídeo(s)`}
                </button>
              </div>
            </div>
          )}
        </section>

        {previewVideo && (
          <aside className="w-[380px] shrink-0 space-y-4 self-start rounded-xl border border-ink-800 bg-ink-900/50 p-4">
            <div className="flex items-center gap-1 rounded-lg border border-ink-800 bg-ink-950/60 p-1">
              {(
                [
                  ["recorte", "Recorte"],
                  ["preview", "Preview"],
                ] as const
              ).map(([tab, label]) => (
                <button
                  key={tab}
                  onClick={() => setPanelTab(tab)}
                  className={`flex-1 rounded-md px-2 py-1 text-[11px] transition ${
                    panelTab === tab
                      ? "bg-accent/15 text-accent"
                      : "text-ink-400 hover:text-ink-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {panelTab === "recorte" ? (
              <>
                <div className="flex justify-end">
                  <button
                    onClick={() => setCropMode((v) => !v)}
                    className="rounded-md border border-ink-700 px-2 py-1 text-[11px] text-ink-300 transition hover:border-accent/50 hover:text-accent"
                  >
                    {cropMode ? "Reproduzir vídeo" : "Ajustar recorte"}
                  </button>
                </div>

                {/* O container tem a proporção exata do vídeo, e não uma caixa
                    fixa com object-contain. Não é só estética: o CropOverlay se
                    posiciona sobre o container, então qualquer tarja preta
                    dentro dele faria o retângulo apontar para fora da imagem —
                    x=0 cairia na tarja, não na borda do vídeo. */}
                <div className="mx-auto" style={previewBox}>
                  <div className="relative h-full w-full overflow-hidden rounded-lg bg-black">
                    <video
                      key={previewVideo.id}
                      src={`/api/videos/${previewVideo.id}/media`}
                      controls={!cropMode}
                      className="h-full w-full"
                      poster={`/api/videos/${previewVideo.id}/thumb`}
                    />
                    {cropMode && <CropOverlay rect={rect} onChange={setRect} />}
                  </div>
                </div>
              </>
            ) : activeTemplate ? (
              <>
                {/* Mesma composição que a exportação produz: o vídeo toca
                    dentro do template, com o recorte já aplicado. */}
                <CompositionPreview
                  config={activeTemplate.config}
                  crop={crops[previewVideo.id] ?? null}
                  mediaSrc={`/api/videos/${previewVideo.id}/media`}
                  mediaKind="video"
                  posterSrc={`/api/videos/${previewVideo.id}/thumb`}
                  videoWidth={previewVideo.width ?? 1080}
                  videoHeight={previewVideo.height ?? 1920}
                  displayHeight={440}
                />
                <p className="text-center text-[10px] text-ink-500">
                  {activeTemplate.config.canvasWidth}×{activeTemplate.config.canvasHeight} ·{" "}
                  {activeTemplate.name} · {activeTemplate.config.fitMode.toUpperCase()}
                </p>
              </>
            ) : (
              <div className="rounded-lg border border-dashed border-ink-700 p-6 text-center text-xs text-ink-500">
                Escolha um template no painel da esquerda para ver como o vídeo vai sair.
              </div>
            )}

            <div>
              <p className="truncate text-sm font-medium text-ink-200" title={previewVideo.originalName}>
                {previewVideo.originalName}
              </p>
              {previewVideo.width && previewVideo.height && (
                <p className="text-xs text-ink-500">
                  {previewVideo.width}×{previewVideo.height} · {formatDuration(previewVideo.durationSeconds)}
                </p>
              )}
            </div>

            <CropFields rect={rect} onChange={setRect} width={previewVideo.width} height={previewVideo.height} />

            <div className="space-y-2 border-t border-ink-800 pt-3">
              <button
                onClick={() => void detectCrop(previewVideo.id)}
                disabled={detecting}
                className="w-full rounded-lg border border-accent/50 px-3 py-2 text-sm text-accent transition hover:bg-accent/10 disabled:opacity-50"
              >
                {detecting
                  ? "Analisando…"
                  : detection?.videoId === previewVideo.id
                    ? "✨ Detectar novamente"
                    : "✨ Detectar automaticamente"}
              </button>

              {detection?.videoId === previewVideo.id && detection.hasBorder && (
                <div
                  className={`rounded-lg border px-3 py-2 text-xs ${
                    detection.level === "alta"
                      ? "border-emerald-800 bg-emerald-950/40 text-emerald-200"
                      : detection.level === "revisar"
                        ? "border-amber-900/60 bg-amber-950/30 text-amber-200"
                        : "border-red-900/60 bg-red-950/30 text-red-200"
                  }`}
                >
                  {detection.level === "alta"
                    ? `Recorte detectado · ${detection.confidence}%`
                    : `⚠ Revisar recorte · ${detection.confidence}%`}
                  <span className="mt-1 block text-[10px] opacity-80">
                    {detection.level === "alta"
                      ? "Confira e clique em aplicar."
                      : "A moldura deste vídeo também se mexe. Ajuste o retângulo antes de aplicar."}
                  </span>
                </div>
              )}

              <button
                onClick={() => setRect(FULL_FRAME)}
                className="w-full rounded-lg border border-ink-700 px-3 py-2 text-xs text-ink-300 transition hover:border-ink-600 hover:text-ink-100"
              >
                Resetar (quadro inteiro)
              </button>
              <button
                onClick={() => applyCrop([previewVideo.id])}
                disabled={saving}
                className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition hover:bg-accent/90 disabled:opacity-50"
              >
                Aplicar neste vídeo
              </button>
              <button
                onClick={() => applyCrop([...selectedIds])}
                disabled={saving || selectedIds.size === 0}
                className="w-full rounded-lg border border-accent/50 px-3 py-2 text-sm text-accent transition hover:bg-accent/10 disabled:opacity-40"
              >
                Aplicar aos selecionados ({selectedIds.size})
              </button>
              <button
                onClick={() => applyCrop(libraryVideos.map((v) => v.id))}
                disabled={saving || libraryVideos.length === 0}
                className="w-full rounded-lg border border-ink-700 px-3 py-2 text-xs text-ink-400 transition hover:border-ink-600 hover:text-ink-200 disabled:opacity-40"
              >
                Aplicar a todos ({libraryVideos.length})
              </button>
            </div>
          </aside>
        )}
      </div>


    </div>
  );
}

/** Largura útil do painel lateral (380px menos o padding de 16px dos dois lados). */
const PREVIEW_MAX_W = 348;
const PREVIEW_MAX_H = 520;

/**
 * Dimensoes do preview na proporcao real do video.
 *
 * O calculo e em JS, e nao so com `aspect-ratio` no CSS, porque a caixa precisa
 * caber em duas restricoes ao mesmo tempo (largura do painel e altura da tela).
 * Com as duas no CSS, o navegador escolhe uma e quebra a proporcao — e o
 * retangulo de recorte deixa de bater com a imagem.
 */
function fitBox(video: { width: number | null; height: number | null; aspectRatio: string | null }) {
  const parsed = parseRatio(video.aspectRatio);
  const ratio =
    video.width && video.height
      ? video.width / video.height
      : parsed
        ? Number(parsed.split(" / ")[0]) / Number(parsed.split(" / ")[1])
        : 9 / 16;

  const height = Math.min(PREVIEW_MAX_H, PREVIEW_MAX_W / ratio);
  return { width: Math.round(height * ratio), height: Math.round(height) };
}

/**
 * Campos numericos do recorte. Mostra pixels da fonte quando a resolucao e
 * conhecida, porque "x = 84" e conferivel contra o arquivo e "x = 0,0778" nao.
 */
function CropFields({
  rect,
  onChange,
  width,
  height,
}: {
  rect: NormalizedRect;
  onChange: (r: NormalizedRect) => void;
  width: number | null;
  height: number | null;
}) {
  const inPixels = Boolean(width && height);
  const sx = width ?? 100;
  const sy = height ?? 100;

  const fields: Array<{ key: keyof NormalizedRect; label: string; scale: number }> = [
    { key: "x", label: "X", scale: sx },
    { key: "y", label: "Y", scale: sy },
    { key: "width", label: "Largura", scale: sx },
    { key: "height", label: "Altura", scale: sy },
  ];

  function update(key: keyof NormalizedRect, raw: string, scale: number) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    // Nao deixa o retangulo sair do quadro: o backend recusaria e o usuario
    // so descobriria ao clicar em aplicar.
    onChange(clampRect({ ...rect, [key]: parsed / scale }));
  }

  return (
    <div>
      <div className="grid grid-cols-4 gap-2">
        {fields.map((f) => (
          <label key={f.key} className="block">
            <span className="block text-[10px] uppercase tracking-wider text-ink-500">{f.label}</span>
            <input
              type="number"
              value={Math.round(rect[f.key] * f.scale)}
              onChange={(e) => update(f.key, e.target.value, f.scale)}
              className="mt-1 w-full rounded-md border border-ink-700 bg-ink-950/60 px-2 py-1 text-xs text-ink-200 focus:border-accent focus:outline-none"
            />
          </label>
        ))}
      </div>
      <p className="mt-1 text-[10px] text-ink-500">
        {inPixels ? "Pixels do vídeo original." : "Resolução desconhecida — valores em % do quadro."}
      </p>
    </div>
  );
}

function StatusBadge({ label, ok, optional }: { label: string; ok: boolean; optional?: boolean }) {
  const color = ok
    ? "border-emerald-800 bg-emerald-950/40 text-emerald-300"
    : optional
      ? "border-ink-700 bg-ink-800/40 text-ink-500"
      : "border-red-900 bg-red-950/40 text-red-300";

  return (
    <div className={`rounded-lg border px-3 py-2 text-center text-xs font-medium ${color}`}>
      <span className="block text-[10px] uppercase tracking-wider opacity-70">{label}</span>
      <span>{ok ? "OK" : optional ? "N/A" : "Faltando"}</span>
    </div>
  );
}
