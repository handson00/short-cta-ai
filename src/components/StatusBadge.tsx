import { ACTIVE_STATUSES, STATUS_LABEL, type JobStatus } from "@/lib/types";

const TONE: Record<string, string> = {
  done: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  error: "border-red-500/40 bg-red-500/10 text-red-300",
  canceled: "border-ink-600 bg-ink-850 text-ink-400",
  queued: "border-ink-600 bg-ink-850 text-ink-300",
  // Não é erro nem trabalho em andamento: a parte local terminou e espera o usuário.
  awaiting_ai: "border-emerald-500/30 bg-emerald-500/5 text-emerald-200",
};

export default function StatusBadge({ status }: { status: JobStatus }) {
  const active = ACTIVE_STATUSES.includes(status);
  const tone = TONE[status] ?? "border-accent/40 bg-accent/10 text-accent-soft";

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${tone}`}>
      {active && (
        /* Indicador de atividade: nenhuma etapa expõe percentual que não seja medido de verdade. */
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-soft opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent-soft" />
        </span>
      )}
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
