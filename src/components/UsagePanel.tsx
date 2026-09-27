"use client";

import { useEffect, useState } from "react";

interface UsageRow {
  operation: string;
  model: string | null;
  status: string;
  total: number;
  avg_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
}

interface ErrorRow {
  operation: string;
  model: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
}

interface Payload {
  usage: UsageRow[];
  recentErrors: ErrorRow[];
  queue: { total: number; done: number; active: number; queued: number; error: number };
  worker: { running: boolean; active: number };
}

export default function UsagePanel() {
  const [data, setData] = useState<Payload | null>(null);

  useEffect(() => {
    const load = async () => {
      const res = await fetch("/api/status", { cache: "no-store" });
      if (res.ok) setData((await res.json()) as Payload);
    };
    void load();
    const interval = setInterval(() => void load(), 10_000);
    return () => clearInterval(interval);
  }, []);

  if (!data) return <p className="hint">Carregando uso…</p>;

  const totalRequests = data.usage.reduce((a, r) => a + r.total, 0);
  const failures = data.usage.filter((r: any) => r.status === "error").reduce((a, r) => a + r.total, 0);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-lg font-semibold">Uso da IA</h1>
        <p className="hint mt-1">
          Contagem de requisições, modelo, tempo e erros. Nenhum conteúdo enviado ao modelo é registrado aqui.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Requisições" value={String(totalRequests)} />
        <Stat label="Com erro" value={String(failures)} tone={failures > 0 ? "warn" : undefined} />
        <Stat label="Na fila" value={String(data.queue.queued)} />
        <Stat label="Em execução" value={String(data.worker.active)} />
      </section>

      <section className="card overflow-x-auto p-4">
        <h2 className="mb-3 text-sm font-medium">Por operação</h2>
        {data.usage.length === 0 ? (
          <p className="hint">Nenhuma chamada registrada ainda.</p>
        ) : (
          <table className="w-full min-w-[540px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="pb-2">Operação</th>
                <th className="pb-2">Modelo</th>
                <th className="pb-2">Status</th>
                <th className="pb-2 text-right">Total</th>
                <th className="pb-2 text-right">Tempo médio</th>
                <th className="pb-2 text-right">Tokens</th>
              </tr>
            </thead>
            <tbody>
              {data.usage.map((row, i) => (
                <tr key={i} className="border-t border-ink-800">
                  <td className="py-1.5">{row.operation}</td>
                  <td className="py-1.5 text-ink-400">{row.model ?? "—"}</td>
                  <td className={`py-1.5 ${row.status === "error" ? "text-red-300" : "text-emerald-300"}`}>
                    {row.status}
                  </td>
                  <td className="py-1.5 text-right">{row.total}</td>
                  <td className="py-1.5 text-right text-ink-400">
                    {row.avg_ms ? `${Math.round(row.avg_ms)}ms` : "—"}
                  </td>
                  <td className="py-1.5 text-right text-ink-400">
                    {(row.prompt_tokens ?? 0) + (row.completion_tokens ?? 0) || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card p-4">
        <h2 className="mb-3 text-sm font-medium">Erros recentes</h2>
        {data.recentErrors.length === 0 ? (
          <p className="hint">Nenhum erro registrado.</p>
        ) : (
          <ul className="space-y-2 text-xs">
            {data.recentErrors.map((row, i) => (
              <li key={i} className="rounded-lg bg-ink-900/60 p-2">
                <span className="text-ink-300">{row.operation}</span>
                <span className="ml-2 text-red-300">{row.error_code}</span>
                <p className="mt-0.5 text-ink-400">{row.error_message}</p>
                <p className="text-ink-600">{row.created_at ? String(row.created_at).slice(0, 16).replace("T", " ") : "—"}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="card p-3">
      <p className="text-xs text-ink-400">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${tone === "warn" ? "text-amber-300" : ""}`}>{value}</p>
    </div>
  );
}
