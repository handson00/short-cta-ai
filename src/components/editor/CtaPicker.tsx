"use client";

import { ctaOriginNote, ctaStyleLabel, currentCtaIndex, stepCta, type CtaOption } from "@/lib/editor/ctaOptions";

/**
 * Troca o texto do vídeo pelos CTAs gerados para ele, um clique de cada vez,
 * e diz de que estilo é o texto que está sobre o vídeo.
 *
 * Só muda o texto do editor (o mesmo campo que o usuário digita); a escolha
 * feita na Fila fica como está.
 */
export default function CtaPicker({
  options,
  text,
  onPick,
}: {
  options: CtaOption[];
  /** O texto que está sobre o vídeo agora. */
  text: string;
  onPick: (text: string) => void;
}) {
  const index = currentCtaIndex(options, text);
  const current = index >= 0 ? options[index] : null;

  if (options.length === 0) {
    return (
      <p className="text-[10px] text-ink-500">
        Nenhum CTA gerado para este vídeo. Use &quot;Gerar CTAs&quot; na Fila para ter opções aqui.
      </p>
    );
  }

  const note = current ? ctaOriginNote(current) : null;
  // Verde = o texto que já estava escrito no vídeo original (lido pelo OCR):
  // o usuário precisa distinguir de relance o CTA do vídeo dos gerados.
  const fromVideo = current?.origin === "original";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
          fromVideo
            ? "bg-emerald-500/20 text-emerald-300"
            : current
              ? "bg-accent/20 text-accent"
              : "bg-ink-800 text-ink-300"
        }`}
        title={
          fromVideo
            ? "Este é o CTA que já estava no vídeo original"
            : current
              ? "Estilo do CTA que está sobre o vídeo"
              : "O texto atual não é um dos CTAs gerados"
        }
      >
        {current ? ctaStyleLabel(current.style) : "Texto próprio"}
      </span>
      {note && <span className={`text-[10px] ${fromVideo ? "font-medium text-emerald-300" : "text-ink-500"}`}>{note}</span>}
      <span className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={() => {
            const prev = stepCta(options, text, -1);
            if (prev) onPick(prev.text);
          }}
          disabled={options.length < 2 && index >= 0}
          title="CTA anterior"
          className="rounded-md border border-ink-700 px-1.5 py-0.5 text-[11px] text-ink-300 transition hover:border-accent/50 hover:text-accent disabled:opacity-40"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={() => {
            const next = stepCta(options, text, 1);
            if (next) onPick(next.text);
          }}
          disabled={options.length < 2 && index >= 0}
          title="Carregar outro CTA gerado para este vídeo"
          className="rounded-md border border-accent/50 px-2 py-0.5 text-[11px] text-accent transition hover:bg-accent/10 disabled:opacity-40"
        >
          ↻ Outro CTA
        </button>
        <span className="text-[10px] tabular-nums text-ink-500">
          {index >= 0 ? `${index + 1}/${options.length}` : `—/${options.length}`}
        </span>
      </span>
    </div>
  );
}
