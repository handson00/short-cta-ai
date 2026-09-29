"use client";

import { useRef, useState } from "react";
import type { EditorTemplate, EditorTemplateConfig } from "@/lib/types";
import type { NormalizedRect } from "@/lib/editor/crop";
import {
  DEFAULT_TEMPLATE,
  fromCanvasFraction,
  logoRect,
  slotFromNormalized,
  slotToNormalized,
  toCanvasFraction,
} from "@/lib/editor/template";
import CropOverlay from "./CropOverlay";
import CompositionPreview from "./CompositionPreview";

type EditTarget = "video" | "logo";

/** Coluna estreita: o preview cabe em pé sem empurrar os controles para fora. */
const PREVIEW_HEIGHT = 300;

/**
 * Editor de template (spec §28-§32).
 *
 * O preview desenha as camadas na ordem da §28 (fundo → vídeo → overlay → logo)
 * usando a mesma conta de encaixe que a exportação vai usar (§86).
 */
export default function TemplatePanel({
  templates,
  selectedId,
  onSelect,
  onSaved,
  onDeleted,
  onAssign,
  previewThumb,
  previewCrop,
  previewVideoWidth,
  previewVideoHeight,
  assignCount,
}: {
  templates: EditorTemplate[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onSaved: (t: EditorTemplate) => void;
  onDeleted: (id: string) => void;
  onAssign: (templateId: string | null) => void;
  previewThumb: string | null;
  /** Recorte do vídedo em preview. `null` = quadro inteiro. */
  previewCrop: NormalizedRect | null;
  previewVideoWidth: number;
  previewVideoHeight: number;
  assignCount: number;
}) {
  const selected = templates.find((t) => t.id === selectedId) ?? null;
  const [draft, setDraft] = useState<EditorTemplateConfig>(selected?.config ?? DEFAULT_TEMPLATE);
  const [name, setName] = useState(selected?.name ?? "Meu template");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingSlot, setUploadingSlot] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget>("video");
  const fileRef = useRef<HTMLInputElement>(null);
  const slotTargetRef = useRef<"background" | "overlay" | "logo">("background");

  function loadTemplate(t: EditorTemplate | null) {
    onSelect(t?.id ?? null);
    setDraft(t?.config ?? DEFAULT_TEMPLATE);
    setName(t?.name ?? "Meu template");
    setError(null);
  }

  async function uploadAsset(file: File) {
    const target = slotTargetRef.current;
    setUploadingSlot(target);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/editor/template-asset", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setDraft((d) => ({ ...d, [target]: data.asset }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enviar a imagem.");
    } finally {
      setUploadingSlot(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/editor/templates", {
        method: selected ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selected ? { id: selected.id, name, config: draft } : { name, config: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onSaved(data.template);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar o template.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!selected) return;
    if (!window.confirm(`Excluir o template "${selected.name}"? Os vídeos que o usavam ficam sem template.`)) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/editor/templates?id=${encodeURIComponent(selected.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onDeleted(selected.id);
      loadTemplate(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao excluir.");
    } finally {
      setBusy(false);
    }
  }

  // O retângulo arrastável controla o slot ou a logo, conforme o seletor.
  const overlayRect =
    editTarget === "video"
      ? slotToNormalized(draft)
      : toCanvasFraction(logoRect(draft), draft);

  function onOverlayChange(rect: NormalizedRect) {
    if (editTarget === "video") {
      setDraft((d) => slotFromNormalized(rect, d));
      return;
    }
    setDraft((d) => {
      const px = fromCanvasFraction(rect, d);
      return { ...d, logoX: px.x, logoY: px.y, logoWidth: px.width, logoHeight: px.height };
    });
  }

  return (
    <section className="w-[320px] shrink-0 space-y-4 self-start rounded-xl border border-ink-800 bg-ink-900/50 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-400">Template</h2>

      <div className="space-y-2">
        <select
          value={selectedId ?? ""}
          onChange={(e) => loadTemplate(templates.find((t) => t.id === e.target.value) ?? null)}
          className="w-full rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-xs text-ink-200"
        >
          <option value="">+ Novo template</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome do template"
          className="w-full rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-xs text-ink-200 focus:border-accent focus:outline-none"
        />
        <div className="flex gap-2">
          <button
            onClick={() => void save()}
            disabled={busy}
            className="flex-1 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-accent/90 disabled:opacity-50"
          >
            {busy ? "Salvando…" : selected ? "Salvar" : "Criar"}
          </button>
          {selected && (
            <button
              onClick={() => void remove()}
              disabled={busy}
              className="rounded-md border border-ink-700 px-2 py-1.5 text-xs text-ink-400 transition hover:border-red-900 hover:text-red-300 disabled:opacity-50"
            >
              Excluir
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {/* A composição vem do mesmo componente da aba Preview: duas telas
            desenhando isto por caminhos diferentes divergiriam (§86). */}
        <CompositionPreview
          config={draft}
          crop={previewCrop}
          mediaSrc={previewThumb}
          mediaKind="image"
          videoWidth={previewVideoWidth}
          videoHeight={previewVideoHeight}
          displayHeight={PREVIEW_HEIGHT}
        >
          {/* Sem máscara: escurecer o template inteiro em volta do slot (ou da
              logo) esconderia justamente a composição que se está montando. */}
          <CropOverlay
            rect={overlayRect}
            onChange={onOverlayChange}
            mask={false}
            minSize={editTarget === "logo" ? 0.01 : undefined}
          />
        </CompositionPreview>

        {/* Controles */}
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-[10px] uppercase tracking-wider text-ink-500">Fundo</p>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={draft.backgroundColor ?? "#0a0b0f"}
                onChange={(e) => setDraft((d) => ({ ...d, backgroundColor: e.target.value }))}
                className="h-8 w-12 cursor-pointer rounded border border-ink-700 bg-ink-950"
                title="Cor de fundo"
              />
              <input
                value={draft.backgroundColor ?? "#0a0b0f"}
                onChange={(e) => setDraft((d) => ({ ...d, backgroundColor: e.target.value }))}
                className="w-24 rounded-md border border-ink-700 bg-ink-950 px-2 py-1 font-mono text-xs text-ink-200 focus:border-accent focus:outline-none"
              />
              <span className="text-[10px] text-ink-500">
                {draft.background ? "a imagem cobre a cor" : "template sem imagem"}
              </span>
            </div>
          </div>

          <div>
            <p className="mb-2 text-[10px] uppercase tracking-wider text-ink-500">
              Arrastar no preview
            </p>
            <div className="flex gap-2">
              {(
                [
                  ["video", "Área do vídeo"],
                  ["logo", "Logo"],
                ] as const
              ).map(([target, label]) => (
                <button
                  key={target}
                  onClick={() => setEditTarget(target)}
                  disabled={target === "logo" && !draft.logo}
                  className={`flex-1 rounded-md border px-2 py-1 text-xs transition disabled:opacity-40 ${
                    editTarget === target
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-ink-700 text-ink-400 hover:border-ink-600"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {!draft.logo && (
              <p className="mt-1 text-[10px] text-ink-500">Envie uma logo para poder posicioná-la.</p>
            )}
          </div>

          <div>
            <p className="mb-2 text-[10px] uppercase tracking-wider text-ink-500">Imagens (§28)</p>
            <div className="space-y-1">
              {(["background", "overlay", "logo"] as const).map((slot) => (
                <div key={slot} className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      slotTargetRef.current = slot;
                      fileRef.current?.click();
                    }}
                    disabled={uploadingSlot !== null}
                    className="flex-1 rounded-md border border-ink-700 px-2 py-1 text-left text-xs text-ink-300 transition hover:border-accent/50 hover:text-accent disabled:opacity-50"
                  >
                    {uploadingSlot === slot ? "Enviando…" : slot === "background" ? "Fundo" : slot === "overlay" ? "Overlay" : "Logo"}
                    {draft[slot] ? " ✓" : " —"}
                  </button>
                  {draft[slot] && (
                    <button
                      onClick={() => {
                        setDraft((d) => ({ ...d, [slot]: undefined }));
                        // Sem logo não há o que arrastar: volta para a área do vídeo.
                        if (slot === "logo") setEditTarget("video");
                      }}
                      className="rounded px-1 text-xs text-ink-600 transition hover:text-red-300"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadAsset(f);
              }}
            />
          </div>

          <div>
            <p className="mb-2 text-[10px] uppercase tracking-wider text-ink-500">
              {editTarget === "video" ? "Área do vídeo (§29)" : "Posição da logo"}
            </p>
            <div className="grid grid-cols-4 gap-2">
              {(editTarget === "video"
                ? ([
                    ["videoX", "X"],
                    ["videoY", "Y"],
                    ["videoWidth", "Larg."],
                    ["videoHeight", "Alt."],
                  ] as const)
                : ([
                    ["logoX", "X"],
                    ["logoY", "Y"],
                    ["logoWidth", "Larg."],
                    ["logoHeight", "Alt."],
                  ] as const)
              ).map(([key, label]) => (
                <label key={key} className="block">
                  <span className="block text-[10px] text-ink-500">{label}</span>
                  <input
                    type="number"
                    value={draft[key] ?? 0}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) setDraft((d) => ({ ...d, [key]: Math.round(n) }));
                    }}
                    className="mt-1 w-full rounded-md border border-ink-700 bg-ink-950/60 px-2 py-1 text-xs text-ink-200 focus:border-accent focus:outline-none"
                  />
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-[10px] uppercase tracking-wider text-ink-500">Encaixe (§30)</p>
            <div className="flex gap-2">
              {(["fit", "fill"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setDraft((d) => ({ ...d, fitMode: mode }))}
                  className={`flex-1 rounded-md border px-2 py-1 text-xs transition ${
                    draft.fitMode === mode
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-ink-700 text-ink-400 hover:border-ink-600"
                  }`}
                >
                  {mode === "fit" ? "FIT — cabe inteiro" : "FILL — preenche"}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-ink-500">
              {draft.fitMode === "fit"
                ? "Mostra o conteúdo completo; pode sobrar espaço."
                : "Preenche a área; pode cortar as bordas."}
            </p>
          </div>

          {selected && (
            <div className="space-y-2 border-t border-ink-800 pt-3">
              <button
                onClick={() => onAssign(selected.id)}
                disabled={assignCount === 0}
                className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition hover:bg-accent/90 disabled:opacity-40"
              >
                Aplicar template aos {assignCount} selecionados
              </button>
              <button
                onClick={() => onAssign(null)}
                disabled={assignCount === 0}
                className="w-full rounded-lg border border-ink-700 px-3 py-2 text-xs text-ink-400 transition hover:border-ink-600 hover:text-ink-200 disabled:opacity-40"
              >
                Tirar o template dos selecionados
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
