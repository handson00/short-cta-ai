"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  DEFAULT_EFFECTS,
  countEffects,
  effectsError,
  SPEED_OPTIONS,
  ZOOM_OPTIONS,
  type EditorEffects,
} from "@/lib/editor/effects";

export type EffectsScope = "este" | "selecao" | "todos";

/**
 * Aba Efeitos (coluna da esquerda, no lugar do template).
 *
 * Cada alteração é gravada na hora no escopo escolhido — o vídeo aberto, os
 * selecionados ou todos da edição. Gravar em "Seleção" ou "Todos" SUBSTITUI os
 * efeitos daqueles vídeos por esta configuração inteira, e a tela diz isso: um
 * lote que só ligasse um interruptor e mantivesse o resto de cada vídeo seria
 * impossível de conferir.
 */
export default function EffectsPanel({
  video,
  videoEffects,
  selectedCount,
  totalCount,
  busy,
  onApply,
}: {
  /** Vídeo aberto no painel da direita; nulo = nenhum. */
  video: { id: string; name: string; durationSeconds: number | null } | null;
  /** Efeitos gravados no vídeo aberto. */
  videoEffects: EditorEffects | null;
  selectedCount: number;
  totalCount: number;
  busy: boolean;
  onApply: (scope: EffectsScope, effects: EditorEffects) => Promise<void>;
}) {
  const [scope, setScope] = useState<EffectsScope>(video ? "este" : "todos");
  const [draft, setDraft] = useState<EditorEffects>(videoEffects ?? DEFAULT_EFFECTS);

  // Ao abrir outro vídeo, a tela mostra os efeitos DELE.
  useEffect(() => {
    setDraft(videoEffects ?? DEFAULT_EFFECTS);
    if (!video && scope === "este") setScope("todos");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.id, videoEffects]);

  const scopeCount = scope === "este" ? (video ? 1 : 0) : scope === "selecao" ? selectedCount : totalCount;
  const trimProblem = video ? effectsError(video.durationSeconds ?? 0, draft) : null;

  function change(patch: Partial<EditorEffects>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    // "Este vídeo" grava a cada toque. Em lote, só pelo botão: um toque sem
    // querer não pode reescrever os efeitos de 98 vídeos.
    if (scope === "este" && video) void onApply("este", next);
  }

  const scopeLabel: Record<EffectsScope, string> = {
    este: "Este vídeo",
    selecao: `Seleção (${selectedCount})`,
    todos: `Todos (${totalCount})`,
  };

  return (
    <section className="w-[320px] shrink-0 space-y-3 self-start rounded-xl border border-ink-800 bg-ink-900/50 p-4">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-300">Efeitos rápidos</h2>
        <p className="mt-0.5 text-[10px] text-ink-500">Funcionam em Este, Seleção ou Todos</p>
      </div>

      <div className="flex gap-1 rounded-lg border border-ink-800 bg-ink-950/60 p-1">
        {(["este", "selecao", "todos"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setScope(s)}
            disabled={(s === "este" && !video) || (s === "selecao" && selectedCount === 0)}
            className={`flex-1 rounded-md px-1.5 py-1 text-[10px] transition disabled:opacity-40 ${
              scope === s ? "bg-accent/15 text-accent" : "text-ink-400 hover:text-ink-200"
            }`}
          >
            {scopeLabel[s]}
          </button>
        ))}
      </div>

      {scope === "este" && video && (
        <p className="truncate text-[10px] text-ink-500" title={video.name}>
          Editando: <span className="text-ink-300">{video.name}</span> · salvo a cada alteração
        </p>
      )}
      {scope === "este" && !video && (
        <p className="text-[10px] text-ink-500">Clique num vídeo da lista para editar os efeitos dele.</p>
      )}

      <div className="divide-y divide-ink-800 rounded-lg border border-ink-800">
        <Row icon="⇋" label="Espelhar vídeo">
          <Switch on={draft.mirror} onChange={(v) => change({ mirror: v })} />
        </Row>

        <Row icon="✂" label="Cortar início/fim">
          <Switch
            on={draft.trimStart > 0 || draft.trimEnd > 0}
            onChange={(v) => change(v ? { trimStart: 0.5, trimEnd: 0.5 } : { trimStart: 0, trimEnd: 0 })}
          />
        </Row>
        {(draft.trimStart > 0 || draft.trimEnd > 0) && (
          <div className="flex items-center gap-2 px-3 pb-2 text-[11px] text-ink-400">
            <SecondsInput label="Início" value={draft.trimStart} onChange={(v) => change({ trimStart: v })} />
            <SecondsInput label="Fim" value={draft.trimEnd} onChange={(v) => change({ trimEnd: v })} />
          </div>
        )}
        {trimProblem && <p className="px-3 pb-2 text-[10px] text-red-300">{trimProblem}</p>}

        <Row icon="✦" label="Realçar cores" hint="contraste e saturação">
          <Switch on={draft.enhanceColor} onChange={(v) => change({ enhanceColor: v })} />
        </Row>

        <Row icon="⏩" label={`Velocidade ${draft.speed !== 1 ? `${draft.speed}x` : ""}`}>
          <Switch on={draft.speed !== 1} onChange={(v) => change({ speed: v ? SPEED_OPTIONS[0] : 1 })} />
        </Row>
        {draft.speed !== 1 && (
          <Options
            values={SPEED_OPTIONS}
            current={draft.speed}
            suffix="x"
            onPick={(v) => change({ speed: v })}
          />
        )}

        <Row icon="🔍" label={`Zoom leve ${draft.zoom !== 1 ? `${draft.zoom}x` : ""}`}>
          <Switch on={draft.zoom !== 1} onChange={(v) => change({ zoom: v ? ZOOM_OPTIONS[0] : 1 })} />
        </Row>
        {draft.zoom !== 1 && (
          <Options values={ZOOM_OPTIONS} current={draft.zoom} suffix="x" onPick={(v) => change({ zoom: v })} />
        )}

        <Row icon="🔊" label="Melhorar áudio" hint="volume padrão -14 LUFS, sem ronco">
          <Switch on={draft.enhanceAudio} onChange={(v) => change({ enhanceAudio: v })} />
        </Row>
      </div>

      {scope !== "este" && (
        <div className="space-y-1.5">
          <button
            onClick={() => void onApply(scope, draft)}
            disabled={busy || scopeCount === 0}
            className="w-full rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white transition hover:bg-accent/90 disabled:opacity-50"
          >
            {busy ? "Aplicando…" : `Aplicar em ${scopeCount} vídeo(s)`}
          </button>
          <p className="text-[10px] text-ink-500">
            Substitui os efeitos desses vídeos por esta configuração ({countEffects(draft)} ligado(s)).
            {countEffects(draft) === 0 && " Com tudo desligado, tira os efeitos deles."}
          </p>
        </div>
      )}

      <p className="text-[10px] text-ink-500">
        Os efeitos valem na exportação e na aba Preview. No preview, o realce de cor é aproximado; o áudio só existe
        no arquivo exportado.
      </p>
    </section>
  );
}

function Row({ icon, label, hint, children }: { icon: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2.5">
      <span className="w-5 text-center text-sm text-ink-400">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-ink-200">{label}</span>
        {hint && <span className="block text-[10px] text-ink-500">{hint}</span>}
      </span>
      {children}
    </div>
  );
}

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition ${on ? "bg-accent" : "bg-ink-700"}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? "left-[18px]" : "left-0.5"}`}
      />
    </button>
  );
}

function Options({
  values,
  current,
  suffix,
  onPick,
}: {
  values: readonly number[];
  current: number;
  suffix: string;
  onPick: (v: number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 px-3 pb-2">
      {values.map((v) => (
        <button
          key={v}
          onClick={() => onPick(v)}
          className={`rounded-md border px-2 py-0.5 text-[10px] transition ${
            current === v ? "border-accent bg-accent/15 text-accent" : "border-ink-700 text-ink-400 hover:text-ink-200"
          }`}
        >
          {v}
          {suffix}
        </button>
      ))}
    </div>
  );
}

function SecondsInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-1">
      {label}
      <input
        type="number"
        min={0}
        max={10}
        step={0.1}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v >= 0) onChange(Math.min(10, v));
        }}
        className="w-14 rounded-md border border-ink-700 bg-ink-950 px-1.5 py-0.5 text-[11px] text-ink-200"
      />
      s
    </label>
  );
}
