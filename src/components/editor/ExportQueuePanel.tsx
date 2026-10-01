"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Declarado aqui, e nao importado de `editorRepo`: componente cliente nunca
 * importa de arquivo que toca o banco, nem com `import type` — o bundler
 * puxaria o better-sqlite3 para o navegador (ver HANDOFF).
 */
interface JobView {
  id: string;
  videoId: string;
  videoName: string;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled" | string;
  progress: number;
  outputPath: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

interface QueueInfo {
  encoder: string | null;
  concurrency: number;
  active: number;
}

const POLL_MS = 1_500;

const STATUS_LABEL: Record<string, string> = {
  pending: "Na fila",
  processing: "Renderizando",
  completed: "Pronto",
  failed: "Falhou",
  cancelled: "Cancelado",
};

function seconds(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const s = (new Date(b).getTime() - new Date(a).getTime()) / 1000;
  return Number.isFinite(s) && s >= 0 ? s : null;
}

/** Resumo do lote, para a barra de ações mostrar o andamento sem duplicar a conta. */
export interface ExportSummary {
  total: number;
  done: number;
  failed: number;
  overall: number;
  busy: boolean;
}

export default function ExportQueuePanel({
  refreshKey,
  onSummary,
}: {
  refreshKey: number;
  /** O andamento a cada consulta; nulo quando não há nada na fila. */
  onSummary?: (summary: ExportSummary | null) => void;
}) {
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [queue, setQueue] = useState<QueueInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/editor/export");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setJobs(data.jobs ?? []);
      setQueue(data.queue ?? null);
      setError(null);
      return (data.jobs ?? []).some((j: JobView) => j.status === "pending" || j.status === "processing");
    } catch (err) {
      // Falha ao consultar não pode parecer "fila vazia".
      setError(err instanceof Error ? err.message : "Falha ao consultar a fila.");
      return true;
    }
  }, []);

  // Consulta só enquanto houver algo andando; parada, a fila não muda sozinha.
  useEffect(() => {
    let stopped = false;
    const loop = async () => {
      const busy = await load();
      if (!stopped && busy) timer.current = setTimeout(loop, POLL_MS);
    };
    void loop();
    return () => {
      stopped = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load, refreshKey]);

  async function act(query: string) {
    await fetch(`/api/editor/export?${query}`, { method: "DELETE" });
    await load();
  }

  // Totais do lote: o que interessa é "12 de 30", não uma lista de 30 barras.
  const total = jobs.length;
  const done = jobs.filter((j) => j.status === "completed").length;
  const failed = jobs.filter((j) => j.status === "failed").length;
  const cancelled = jobs.filter((j) => j.status === "cancelled").length;
  const running = jobs.filter((j) => j.status === "processing");
  const pending = jobs.filter((j) => j.status === "pending").length;
  const busy = running.length + pending > 0;
  const finished = done + failed + cancelled;
  // Os que estão rodando contam pela fração já feita, para a barra andar.
  const overall = total
    ? Math.round(((finished + running.reduce((s, j) => s + j.progress / 100, 0)) / total) * 100)
    : 0;

  const durations = jobs
    .filter((j) => j.status === "completed")
    .map((j) => seconds(j.startedAt, j.completedAt))
    .filter((s): s is number => s !== null);
  const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
  const eta =
    busy && avg !== null && queue && queue.concurrency > 0
      ? Math.ceil(((pending + running.length) * avg) / queue.concurrency / 60)
      : null;

  // A barra de ações mostra o mesmo andamento sem refazer a conta. Vai num
  // efeito, e não no meio do render, para não atualizar o pai durante o render.
  useEffect(() => {
    onSummary?.(total === 0 ? null : { total, done, failed, overall, busy });
  }, [onSummary, total, done, failed, overall, busy]);

  if (jobs.length === 0 && !error) return null;

  return (
    <section id="fila-de-exportacao" className="space-y-3 rounded-xl border border-ink-800 bg-ink-900/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-400">Exportação</h2>
          {queue?.encoder && (
            <p className="text-[10px] text-ink-500">
              {queue.encoder} · {queue.concurrency} em paralelo · MP4 H.264 1080×1920 30 fps, pronto para Reels e TikTok
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {busy && (
            <button
              onClick={() => void act("all=1")}
              className="rounded-md border border-ink-700 px-2 py-1 text-xs text-ink-400 transition hover:border-red-900 hover:text-red-300"
            >
              Cancelar todos
            </button>
          )}
          {!busy && total > 0 && (
            <button
              onClick={() => void act("clear=1")}
              className="rounded-md border border-ink-700 px-2 py-1 text-xs text-ink-400 transition hover:border-ink-600 hover:text-ink-200"
            >
              Limpar lista
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      )}

      <div>
        <div className="mb-1 flex justify-between text-xs text-ink-300">
          <span>
            {done} de {total} prontos
            {failed > 0 && <span className="text-red-300"> · {failed} falharam</span>}
            {cancelled > 0 && <span className="text-ink-500"> · {cancelled} cancelados</span>}
          </span>
          <span>
            {overall}%
            {/* Estimativa só depois de ter tempo medido de verdade (§132). */}
            {eta !== null && <span className="text-ink-500"> · ~{eta} min restantes</span>}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-ink-800">
          <div className="h-full bg-accent transition-all" style={{ width: `${overall}%` }} />
        </div>
      </div>

      <ul className="scroll-thin max-h-72 space-y-1 overflow-y-auto pr-1">
        {jobs.map((j) => (
          <li key={j.id} className="rounded-md border border-ink-800 bg-ink-950/50 px-2 py-1.5">
            <div className="flex items-center gap-2 text-[11px]">
              <span className="min-w-0 flex-1 truncate text-ink-200" title={j.videoName}>
                {j.videoName}
              </span>
              <span
                className={
                  j.status === "completed"
                    ? "text-emerald-300"
                    : j.status === "failed"
                      ? "text-red-300"
                      : j.status === "processing"
                        ? "text-accent"
                        : "text-ink-500"
                }
              >
                {STATUS_LABEL[j.status] ?? j.status}
                {j.status === "processing" && ` ${j.progress}%`}
              </span>
              {(j.status === "pending" || j.status === "processing") && (
                <button
                  onClick={() => void act(`jobId=${encodeURIComponent(j.id)}`)}
                  title="Cancelar"
                  className="rounded px-1 text-ink-600 transition hover:text-red-300"
                >
                  ×
                </button>
              )}
            </div>
            {j.status === "processing" && (
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-ink-800">
                <div className="h-full bg-accent transition-all" style={{ width: `${j.progress}%` }} />
              </div>
            )}
            {j.status === "completed" && j.outputPath && (
              <p className="mt-0.5 truncate font-mono text-[10px] text-ink-500" title={j.outputPath}>
                {j.outputPath}
              </p>
            )}
            {j.status === "failed" && j.errorMessage && (
              <p className="mt-0.5 line-clamp-2 text-[10px] text-red-300/80" title={j.errorMessage}>
                {j.errorMessage}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
