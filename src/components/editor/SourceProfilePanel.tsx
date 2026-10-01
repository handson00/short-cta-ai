"use client";

import { useEffect, useState } from "react";
import type { EditorCrop, SourceProfile } from "@/lib/types";
import { aspectLabel, matchProfile } from "@/lib/editor/profile";

/** Perfil como a rota devolve: com o rótulo da página e quantos vídeos o usam. */
export interface ProfileView extends SourceProfile {
  originLabel: string | null;
  videoCount: number;
}

interface Props {
  video: {
    id: string;
    originKey: string | null;
    originLabel: string | null;
    width: number | null;
    height: number | null;
  };
  crop: EditorCrop | null;
  profiles: ProfileView[];
  selectedCount: number;
  busy: boolean;
  /** Põe o recorte do perfil no editor, sem gravar — mesma regra da detecção (§22). */
  onLoad: (profile: ProfileView) => void;
  onApplyHere: (profile: ProfileView) => void;
  onApplySelected: (profile: ProfileView) => void;
  onSaveNew: (name: string) => void;
  onUpdate: (profile: ProfileView) => void;
  onDelete: (profile: ProfileView) => void;
}

/**
 * Perfil de origem do vídeo aberto (spec §104): salvar, carregar e aplicar.
 *
 * A sugestão sai de `matchProfile` — a mesma regra que a aplicação em lote usa
 * — e, quando não há perfil que sirva, a tela diz o motivo em vez de só não
 * mostrar nada: "página não identificada" e "proporção diferente" pedem ações
 * diferentes do usuário.
 */
export default function SourceProfilePanel({
  video,
  crop,
  profiles,
  selectedCount,
  busy,
  onLoad,
  onApplyHere,
  onApplySelected,
  onSaveNew,
  onUpdate,
  onDelete,
}: Props) {
  const match = matchProfile(video, profiles);
  const defaultName = video.originLabel ?? "Perfil sem página";
  const [name, setName] = useState(defaultName);
  useEffect(() => setName(defaultName), [defaultName, video.id]);

  const cropProfile = crop?.profileId ? profiles.find((p) => p.id === crop.profileId) : null;
  const cropLabel = !crop
    ? "Sem recorte — quadro inteiro."
    : crop.source === "profile"
      ? cropProfile
        ? `Do perfil "${cropProfile.name}".`
        : "De um perfil que foi excluído."
      : crop.source === "auto"
        ? `Detectado automaticamente${crop.confidence != null ? ` · ${crop.confidence}%` : ""}.`
        : "Ajustado manualmente.";

  return (
    <div className="space-y-2 border-t border-ink-800 pt-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">Perfil de origem</h3>

      <p className="text-[11px] text-ink-300">
        Página:{" "}
        {video.originLabel ? (
          <span className="text-ink-100">{video.originLabel}</span>
        ) : (
          <span className="text-amber-200">não identificada pelo nome do arquivo</span>
        )}
      </p>
      <p className="text-[11px] text-ink-400">Recorte salvo: {cropLabel}</p>

      {match.profile ? (
        <div className="space-y-2 rounded-lg border border-accent/40 bg-accent/5 p-2">
          <p className="text-[11px] text-accent">
            Perfil desta página: <span className="font-medium">{match.profile.name}</span>
          </p>
          <p className="text-[10px] text-ink-500">{match.reason}</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => onLoad(match.profile as ProfileView)}
              disabled={busy}
              title="Coloca o recorte do perfil no editor, sem gravar"
              className="rounded-md border border-accent/50 px-2 py-1 text-[11px] text-accent transition hover:bg-accent/10 disabled:opacity-50"
            >
              Carregar no editor
            </button>
            <button
              onClick={() => onApplyHere(match.profile as ProfileView)}
              disabled={busy}
              className="rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-white transition hover:bg-accent/90 disabled:opacity-50"
            >
              Aplicar neste vídeo
            </button>
          </div>
          <button
            onClick={() => onUpdate(match.profile as ProfileView)}
            disabled={busy}
            title="Troca o recorte do perfil pelo que está no editor. Vídeos que já receberam o perfil não mudam."
            className="w-full rounded-md border border-ink-700 px-2 py-1 text-[11px] text-ink-300 transition hover:border-ink-600 hover:text-ink-100 disabled:opacity-50"
          >
            Atualizar &ldquo;{match.profile.name}&rdquo; com o recorte do editor
          </button>
        </div>
      ) : (
        <p className="rounded-md border border-ink-800 bg-ink-950/60 px-2 py-1.5 text-[10px] text-ink-400">
          {match.reason}
        </p>
      )}

      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          className="min-w-0 flex-1 rounded-md border border-ink-700 bg-ink-950/60 px-2 py-1 text-xs text-ink-200 focus:border-accent focus:outline-none"
        />
        <button
          onClick={() => onSaveNew(name.trim() || defaultName)}
          disabled={busy}
          title="Salva o recorte que está no editor como um perfil novo desta página"
          className="shrink-0 rounded-md border border-accent/50 px-2 py-1 text-[11px] text-accent transition hover:bg-accent/10 disabled:opacity-50"
        >
          Salvar como perfil
        </button>
      </div>

      {profiles.length > 0 && (
        <ul className="space-y-1">
          {profiles.map((p) => (
            <li key={p.id} className="rounded-md border border-ink-800 bg-ink-950/40 px-2 py-1.5 text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-ink-200" title={p.name}>
                  {p.name}
                </span>
                <button
                  onClick={() => {
                    if (window.confirm(`Excluir o perfil "${p.name}"? Os vídeos mantêm o recorte que já receberam.`)) {
                      onDelete(p);
                    }
                  }}
                  disabled={busy}
                  title="Excluir perfil"
                  className="shrink-0 rounded px-1 text-sm leading-none text-ink-600 transition hover:bg-ink-800 hover:text-red-300 disabled:opacity-50"
                >
                  ×
                </button>
              </div>
              <p className="text-[10px] text-ink-500">
                {p.originLabel ?? "sem página"} · {aspectLabel(p.aspect)} · {p.videoCount} vídeo(s)
              </p>
              {selectedCount > 0 && (
                <button
                  onClick={() => onApplySelected(p)}
                  disabled={busy}
                  className="mt-1 text-[10px] text-accent underline hover:text-accent/80 disabled:opacity-50"
                >
                  Aplicar aos selecionados ({selectedCount})
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
