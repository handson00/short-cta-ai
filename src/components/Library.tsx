"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { QueueOverview, VideoSummary } from "@/lib/viewTypes";
import { ACTIVE_STATUSES } from "@/lib/types";
import VideoCard from "./VideoCard";
import PreviewPanel from "./PreviewPanel";

type Filter = "todos" | "concluidos" | "processando" | "erro" | "favoritos";

interface UploadOutcome {
  file: string;
  status: "queued" | "duplicate" | "rejected";
  reason?: string;
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: "todos", label: "Todos" },
  { key: "processando", label: "Em processamento" },
  { key: "concluidos", label: "Concluídos" },
  { key: "erro", label: "Com erro" },
  { key: "favoritos", label: "Favoritos" },
];

export default function Library() {
  const [videos, setVideos] = useState<VideoSummary[]>([]);
  const [queue, setQueue] = useState<QueueOverview | null>(null);
  const [filter, setFilter] = useState<Filter>("todos");
  const [loaded, setLoaded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [outcomes, setOutcomes] = useState<UploadOutcome[]>([]);
  const [onDuplicate, setOnDuplicate] = useState<"skip" | "reanalyze">("skip");
  const [selectedVideo, setSelectedVideo] = useState<VideoSummary | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/videos", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { videos: VideoSummary[]; queue: QueueOverview };
    setVideos(data.videos);
    setQueue(data.queue);
    if (selectedVideo && !data.videos.find(v => v.id === selectedVideo.id)) {
      setSelectedVideo(null);
    }
    // Um vídeo apagado em outra aba não pode continuar marcado aqui.
    setSelectedIds((current) => {
      if (current.size === 0) return current;
      const vivos = new Set(data.videos.map((v) => v.id));
      const mantidos = new Set([...current].filter((id) => vivos.has(id)));
      return mantidos.size === current.size ? current : mantidos;
    });
    setLoaded(true);
  }, [selectedVideo]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const busy = useMemo(
    () => videos.some((v) => v.status === "queued" || ACTIVE_STATUSES.includes(v.status)),
    [videos],
  );

  useEffect(() => {
    const interval = setInterval(() => void refresh(), busy ? 2000 : 8000);
    return () => clearInterval(interval);
  }, [busy, refresh]);

  const upload = useCallback(
    async (files: File[], folderHint?: string | null) => {
      if (files.length === 0) return;
      setOutcomes([]);
      setUploading({ done: 0, total: files.length });
      const collected: UploadOutcome[] = [];
      const folder = folderHint ?? files[0]?.webkitRelativePath?.split("/")[0] ?? null;

      for (let i = 0; i < files.length; i += 1) {
        const form = new FormData();
        form.append("files", files[i]);
        form.append("onDuplicate", onDuplicate);
        if (folder) form.append("sourceFolder", folder);
        try {
          const res = await fetch("/api/videos", { method: "POST", body: form });
          const data = (await res.json().catch(() => ({}))) as { results?: UploadOutcome[]; error?: string };
          if (data.results) collected.push(...data.results);
          else collected.push({ file: files[i].name, status: "rejected", reason: data.error ?? "Falha no envio." });
        } catch {
          collected.push({ file: files[i].name, status: "rejected", reason: "Falha de rede." });
        }
        setUploading({ done: i + 1, total: files.length });
        void refresh();
      }

      setOutcomes(collected);
      setUploading(null);
      void refresh();
    },
    [onDuplicate, refresh],
  );

  const filtered = useMemo(() => {
    let result = videos;
    switch (filter) {
      case "concluidos":
        result = result.filter((v) => v.status === "done");
        break;
      case "processando":
        result = result.filter((v) => v.status === "queued" || ACTIVE_STATUSES.includes(v.status));
        break;
      case "erro":
        result = result.filter((v) => v.status === "error");
        break;
      case "favoritos":
        result = result.filter((v) => v.favorite);
        break;
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter((v) =>
        v.name.toLowerCase().includes(term) ||
        v.source.username?.toLowerCase().includes(term) ||
        v.source.originalUrl?.toLowerCase().includes(term)
      );
    }
    return result;
  }, [videos, filter, searchTerm]);

  const cancelAll = useCallback(async () => {
    const confirmed = window.confirm("Cancelar todos os processos na fila e em andamento?");
    if (!confirmed) return;
    try {
      const res = await fetch("/api/videos/cancel-all", { method: "POST" });
      if (res.ok) void refresh();
      else alert("Falha ao cancelar processos.");
    } catch {
      alert("Falha de rede ao cancelar processos.");
    }
  }, [refresh]);

  function toggleSelect(id: string) {
    setSelectedIds((current) => {
      const proximo = new Set(current);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  async function deleteSelected() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const confirmado = window.confirm(
      ids.length === 1
        ? "Excluir este vídeo? A ação não pode ser desfeita."
        : `Excluir ${ids.length} vídeos selecionados? A ação não pode ser desfeita.`,
    );
    if (!confirmado) return;

    setBulkDeleting(true);
    try {
      const res = await fetch("/api/videos/bulk-delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        deletedCount?: number;
        failed?: { id: string; reason: string }[];
        error?: string;
      };
      if (!res.ok) {
        alert(data.error ?? "Falha ao excluir os vídeos.");
      } else if (data.failed?.length) {
        alert(`${data.deletedCount ?? 0} excluídos. ${data.failed.length} falharam: ${data.failed[0].reason}`);
      }
      setSelectedIds(new Set());
      if (selectedVideo && ids.includes(selectedVideo.id)) setSelectedVideo(null);
      await refresh();
    } finally {
      setBulkDeleting(false);
    }
  }

  const rejected = outcomes.filter((o) => o.status === "rejected");
  const duplicates = outcomes.filter((o) => o.status === "duplicate");

  return (
    <div className="flex gap-4 h-screen">
      {/* Barra lateral esquerda */}
      <aside className="w-48 border-r border-ink-800 flex flex-col space-y-3 p-3">
        <div className="space-y-1">
          <h2 className="text-xs font-medium">Filtros</h2>
          <div className="space-y-0.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`w-full text-left rounded px-2 py-1 text-[10px] transition ${
                  filter === f.key
                    ? "bg-accent/10 text-accent-soft border border-accent/50"
                    : "bg-ink-850 text-ink-300 hover:text-ink-100 border border-transparent"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <h2 className="text-xs font-medium">Busca</h2>
          <input
            type="text"
            placeholder="Nome, usuário, link..."
            className="field text-[10px] w-full"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {queue && queue.total > 0 && (
          <div className="space-y-1">
            <h2 className="text-xs font-medium">Progresso</h2>
            <div className="text-[10px] space-y-0.5">
              <p>{queue.done} de {queue.total} concluídos</p>
              <p className="text-ink-400">{queue.active} em andamento</p>
              <p className="text-ink-400">{queue.queued} aguardando</p>
              {queue.error > 0 && <p className="text-red-400">{queue.error} com erro</p>}
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-ink-800">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${queue.total ? (queue.done / queue.total) * 100 : 0}%` }}
              />
            </div>
            {(queue.queued > 0 || queue.active > 0) && (
              <button className="btn-ghost text-red-400 text-[10px] w-full mt-1" onClick={cancelAll}>
                Cancelar processos
              </button>
            )}
          </div>
        )}

        <div className="space-y-1">
          <h2 className="text-xs font-medium">Exportar</h2>
          <div className="flex gap-1">
            <a className="btn-ghost text-[10px] flex-1" href="/api/export?format=csv">
              CSV
            </a>
            <a className="btn-ghost text-[10px] flex-1" href="/api/export?format=json">
              JSON
            </a>
          </div>
        </div>
      </aside>

      {/* Coluna central - grade de thumbnails */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <section
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void upload(Array.from(e.dataTransfer.files));
          }}
          className={`card border-dashed p-3 text-center transition ${dragging ? "border-accent bg-accent/5" : ""}`}
        >
          <h1 className="text-xs font-semibold">Importar Shorts</h1>
          <p className="hint mx-auto mt-1 max-w-md text-[10px]">
            Arraste arquivos .mp4, .mov ou .webm, ou selecione vários de uma vez.
          </p>

          <div className="mt-2 flex flex-col items-center justify-center gap-1.5 sm:flex-row">
            <button className="btn-primary text-[10px] px-2 py-1" onClick={() => inputRef.current?.click()} disabled={Boolean(uploading)}>
              {uploading ? `Enviando ${uploading.done} de ${uploading.total}…` : "Escolher arquivos"}
            </button>
            <button className="btn-ghost text-[10px] px-2 py-1" onClick={() => folderRef.current?.click()} disabled={Boolean(uploading)}>
              Importar pasta
            </button>
            <label className="flex items-center gap-1 text-[10px] text-ink-400">
              Duplicados:
              <select
                className="field w-auto py-0 text-[10px]"
                value={onDuplicate}
                onChange={(e) => setOnDuplicate(e.target.value as "skip" | "reanalyze")}
              >
                <option value="skip">ignorar</option>
                <option value="reanalyze">analisar novamente</option>
              </select>
            </label>
          </div>

          <input
            ref={folderRef}
            type="file"
            multiple
            // @ts-expect-error atributo experimental suportado em navegadores atuais
            webkitdirectory=""
            directory=""
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              const folder = files[0]?.webkitRelativePath?.split("/")[0] ?? null;
              void upload(files, folder);
              e.target.value = "";
            }}
          />

          <input
            ref={inputRef}
            type="file"
            multiple
            accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
            className="hidden"
            onChange={(e) => {
              void upload(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />

          {(rejected.length > 0 || duplicates.length > 0) && (
            <div className="mt-2 space-y-0.5 text-left text-[10px]">
              {duplicates.map((o) => (
                <p key={`d-${o.file}`} className="text-amber-300">
                  {o.file}: {o.reason}
                </p>
              ))}
              {rejected.map((o) => (
                <p key={`r-${o.file}`} className="text-red-400">
                  {o.file}: {o.reason}
                </p>
              ))}
            </div>
          )}
        </section>

        <div className="flex-1 overflow-y-auto mt-3">
          {!loaded && <p className="hint text-xs text-center py-4">Carregando fila…</p>}
          {loaded && filtered.length === 0 && (
            <p className="hint text-xs text-center py-4">Nenhum vídeo neste filtro. Importe arquivos para começar.</p>
          )}

          {filtered.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-ink-800 bg-ink-900/60 px-2 py-1.5 text-[10px]">
              <span className={selectedIds.size > 0 ? "text-accent-soft" : "text-ink-400"}>
                {selectedIds.size > 0 ? `${selectedIds.size} selecionado(s)` : "Nenhum selecionado"}
              </span>
              <button
                className="btn-quiet px-2 py-0.5 text-[10px]"
                onClick={() => setSelectedIds(new Set(filtered.map((v) => v.id)))}
              >
                Selecionar todos ({filtered.length})
              </button>
              {selectedIds.size > 0 && (
                <>
                  <button className="btn-quiet px-2 py-0.5 text-[10px]" onClick={() => setSelectedIds(new Set())}>
                    Limpar seleção
                  </button>
                  <button
                    className="btn px-2 py-0.5 text-[10px] bg-red-600/90 text-white hover:bg-red-600 ml-auto"
                    onClick={() => void deleteSelected()}
                    disabled={bulkDeleting}
                  >
                    {bulkDeleting ? "Excluindo…" : `Excluir ${selectedIds.size}`}
                  </button>
                </>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
            {filtered.map((video) => (
              <VideoCard
                key={video.id}
                video={video}
                onClick={() => setSelectedVideo(video)}
                selected={selectedIds.has(video.id)}
                onToggleSelect={toggleSelect}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Painel de detalhes à direita */}
      <PreviewPanel videoSummary={selectedVideo} onChanged={refresh} onClose={() => setSelectedVideo(null)} />
    </div>
  );
}