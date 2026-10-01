"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { EditorTemplate, EditorTemplateAudio, EditorTemplateConfig, EditorTextStyle } from "@/lib/types";
import type { NormalizedRect } from "@/lib/editor/crop";
import type { TextLayout } from "@/lib/editor/textLayout";
import {
  DEFAULT_AUDIO,
  DEFAULT_TEMPLATE,
  DEFAULT_TEXT_STYLE,
  SYSTEM_FONTS,
  fromCanvasFraction,
  logoRect,
  slotFromNormalized,
  slotToNormalized,
  toCanvasFraction,
} from "@/lib/editor/template";
import CropOverlay from "./CropOverlay";
import CompositionPreview from "./CompositionPreview";
import CtaPicker from "./CtaPicker";
import type { CtaOption } from "@/lib/editor/ctaOptions";
import type { EditorEffects } from "@/lib/editor/effects";

type EditTarget = "video" | "logo" | "text";
export type SaveState = "saved" | "pending" | "saving" | "error";

/** Espera depois da última alteração antes de salvar: digitar não vira dez PUTs. */
const AUTOSAVE_MS = 500;
type UploadTarget = "background" | "overlay" | "logo" | "font" | "music";

const UPLOAD: Record<UploadTarget, { expect: "image" | "font" | "audio"; accept: string }> = {
  background: { expect: "image", accept: "image/png,image/jpeg,image/webp" },
  overlay: { expect: "image", accept: "image/png,image/jpeg,image/webp" },
  logo: { expect: "image", accept: "image/png,image/jpeg,image/webp" },
  font: { expect: "font", accept: ".ttf,.otf,font/ttf,font/otf" },
  music: { expect: "audio", accept: "audio/*,.mp3,.m4a,.wav,.ogg,.flac" },
};

/** Coluna estreita: o preview cabe em pé sem empurrar os controles para fora. */
const PREVIEW_HEIGHT = 300;

/**
 * Compara campo a campo, sem depender da ordem das chaves, e desce nos blocos
 * de texto e áudio.
 *
 * `JSON.stringify` nao serve: o servidor devolve o template na ordem do schema
 * de validacao, e a tela acusaria "nao salvo" logo depois de salvar. Chave
 * ausente e chave `undefined` contam como iguais — e o que sobra de uma imagem
 * removida.
 */
function sameConfig(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return a === undefined ? b === undefined : false;
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
    if (!sameConfig(ra[k], rb[k])) return false;
  }
  return true;
}

/**
 * Editor de template (spec §28-§37).
 *
 * O preview desenha as camadas na ordem da §28 (fundo → vídeo → overlay → logo
 * → texto) com o mesmo componente da aba Preview e a mesma conta da
 * exportação (§86).
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
  previewText,
  previewLiveText,
  previewPlaceholder,
  previewCtaOptions,
  onPreviewTextChange,
  onDraftChange,
  onSaveStateChange,
  assignCount,
  previewEffects,
}: {
  templates: EditorTemplate[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onSaved: (t: EditorTemplate) => void;
  onDeleted: (id: string) => void;
  onAssign: (templateId: string | null) => void;
  previewThumb: string | null;
  /** Recorte do vídeo em preview. `null` = quadro inteiro. */
  previewCrop: NormalizedRect | null;
  previewVideoWidth: number;
  previewVideoHeight: number;
  /** Texto do vídeo em preview (editável aqui); nulo = nenhum vídeo aberto. */
  previewText: string | null;
  /** O texto que de fato vai sobre o vídeo (rascunho, ou o CTA se vazio). */
  previewLiveText: string;
  /** O CTA da análise, mostrado quando o campo está vazio. */
  previewPlaceholder: string;
  /** CTAs gerados para o vídeo aberto: o botão "Outro CTA" percorre esta lista. */
  previewCtaOptions: CtaOption[];
  onPreviewTextChange: (text: string) => void;
  /** O rascunho a cada alteração, para a aba Preview mostrar em tempo real. */
  onDraftChange: (templateId: string | null, config: EditorTemplateConfig) => void;
  /** Se há salvamento pendente: a exportação espera ele terminar. */
  onSaveStateChange: (state: SaveState) => void;
  assignCount: number;
  /** Efeitos do vídeo em preview: a miniatura mostra zoom, espelho e cor. */
  previewEffects?: EditorEffects | null;
}) {
  const selected = templates.find((t) => t.id === selectedId) ?? null;
  const [draft, setDraft] = useState<EditorTemplateConfig>(selected?.config ?? DEFAULT_TEMPLATE);
  const [name, setName] = useState(selected?.name ?? "Meu template");
  // A exportação lê o template salvo, não o rascunho da tela: sem este aviso,
  // mover a logo e esquecer de salvar produzia vídeos com a logo no lugar antigo.
  const dirty = selected !== null && (name !== selected.name || !sameConfig(draft, selected.config));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<UploadTarget | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget>("video");
  const [textLayout, setTextLayout] = useState<TextLayout | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const lastSavedRef = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<UploadTarget>("background");

  const text = draft.text;
  const audio = draft.audio ?? DEFAULT_AUDIO;
  const setText = (patch: Partial<EditorTextStyle>) =>
    setDraft((d) => ({ ...d, text: { ...(d.text ?? DEFAULT_TEXT_STYLE), ...patch } }));
  const setAudio = (patch: Partial<EditorTemplateAudio>) =>
    setDraft((d) => ({ ...d, audio: { ...(d.audio ?? DEFAULT_AUDIO), ...patch } }));

  function loadTemplate(t: EditorTemplate | null) {
    onSelect(t?.id ?? null);
    setDraft(t?.config ?? DEFAULT_TEMPLATE);
    setName(t?.name ?? "Meu template");
    setEditTarget("video");
    setError(null);
    setSaveState("saved");
    lastSavedRef.current = null;
  }

  function pickFile(target: UploadTarget) {
    uploadTargetRef.current = target;
    if (fileRef.current) {
      fileRef.current.accept = UPLOAD[target].accept;
      fileRef.current.click();
    }
  }

  async function uploadAsset(file: File) {
    const target = uploadTargetRef.current;
    setUploading(target);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("expect", UPLOAD[target].expect);
      const res = await fetch("/api/editor/template-asset", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (target === "font") {
        // O nome do arquivo original vira o rótulo da fonte na lista.
        setText({ fontFile: data.asset, fontFamily: file.name.replace(/\.(ttf|otf)$/i, "") });
      } else if (target === "music") {
        setAudio({ music: data.asset, mode: audio.mode === "original" || audio.mode === "mute" ? "mix" : audio.mode });
      } else {
        setDraft((d) => ({ ...d, [target]: data.asset }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enviar o arquivo.");
    } finally {
      setUploading(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  /** Cria um template novo. Os já existentes são salvos sozinhos (autosave). */
  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/editor/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, config: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      lastSavedRef.current = JSON.stringify({ id: data.template.id, name, config: draft });
      setSaveState("saved");
      onSaved(data.template);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar o template.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Salva o template aberto. O mesmo conteúdo nunca é enviado duas vezes
   * seguidas: sem isso, uma resposta do servidor que normalizasse algum campo
   * reabriria o "não salvo" e o autosave entraria em laço.
   */
  async function autosave() {
    if (!selected) return;
    const payload = JSON.stringify({ id: selected.id, name, config: draft });
    if (payload === lastSavedRef.current) {
      setSaveState("saved");
      return;
    }
    setSaveState("saving");
    try {
      const res = await fetch("/api/editor/templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      lastSavedRef.current = payload;
      setError(null);
      setSaveState("saved");
      onSaved(data.template);
    } catch (err) {
      // Erro não tenta de novo sozinho: espera a próxima alteração.
      setError(err instanceof Error ? err.message : "Falha ao salvar o template.");
      setSaveState("error");
    }
  }

  useEffect(() => {
    if (!selected || !dirty) {
      // Desfazer a alteração à mão não pode deixar a tela presa em "pendente".
      setSaveState((s) => (s === "pending" ? "saved" : s));
      return;
    }
    setSaveState("pending");
    const timer = setTimeout(() => void autosave(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
    // autosave lê draft/name/selected do render atual; as dependências abaixo
    // são exatamente o que deve disparar um novo salvamento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, name, selected, dirty]);

  useEffect(() => onSaveStateChange(saveState), [saveState, onSaveStateChange]);
  useEffect(() => onDraftChange(selectedId, draft), [selectedId, draft, onDraftChange]);

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

  // O retângulo arrastável controla o slot, a logo ou a caixa do texto.
  const overlayRect =
    editTarget === "video"
      ? slotToNormalized(draft)
      : editTarget === "logo"
        ? toCanvasFraction(logoRect(draft), draft)
        : toCanvasFraction(text ?? DEFAULT_TEXT_STYLE, draft);

  function onOverlayChange(rect: NormalizedRect) {
    if (editTarget === "video") {
      setDraft((d) => slotFromNormalized(rect, d));
      return;
    }
    const px = fromCanvasFraction(rect, draft);
    if (editTarget === "logo") {
      setDraft((d) => ({ ...d, logoX: px.x, logoY: px.y, logoWidth: px.width, logoHeight: px.height }));
    } else {
      setText({ x: px.x, y: px.y, width: px.width, height: px.height });
    }
  }

  const sampleText = previewLiveText.trim() || "Seu texto aparece aqui";
  const textOn = Boolean(text?.enabled);

  return (
    <section className="w-[320px] shrink-0 space-y-4 self-start rounded-xl border border-ink-800 bg-ink-900/50 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-400">Template</h2>
        {selected && (
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] ${
              saveState === "error"
                ? "bg-red-950/60 text-red-200"
                : saveState === "saved"
                  ? "text-emerald-300/80"
                  : "bg-ink-800 text-ink-300"
            }`}
            title="Toda alteração é salva sozinha."
          >
            {saveState === "error" ? "não salvo" : saveState === "saved" ? "✓ salvo" : "salvando…"}
          </span>
        )}
      </div>

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
          {!selected ? (
            <button
              onClick={() => void create()}
              disabled={busy}
              className="flex-1 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-accent/90 disabled:opacity-50"
            >
              {busy ? "Criando…" : "Criar template"}
            </button>
          ) : (
            <>
              <p className="flex-1 self-center text-[10px] text-ink-500">Alterações são salvas sozinhas.</p>
              <button
                onClick={() => void remove()}
                disabled={busy}
                className="rounded-md border border-ink-700 px-2 py-1.5 text-xs text-ink-400 transition hover:border-red-900 hover:text-red-300 disabled:opacity-50"
              >
                Excluir
              </button>
            </>
          )}
        </div>
        {!selected && (
          <p className="text-[10px] text-ink-500">
            Depois de criado, o template é salvo sozinho a cada alteração.
          </p>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void uploadAsset(f);
        }}
      />

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
          text={textOn ? sampleText : null}
          onTextLayout={setTextLayout}
          effects={previewEffects}
        >
          {/* Sem máscara: escurecer o template inteiro em volta do slot (ou da
              logo) esconderia justamente a composição que se está montando. */}
          <CropOverlay
            rect={overlayRect}
            onChange={onOverlayChange}
            mask={false}
            minSize={editTarget === "video" ? undefined : editTarget === "logo" ? 0.01 : 0.02}
          />
        </CompositionPreview>

        {textOn && textLayout?.overflow && (
          <p className="rounded-md border border-amber-900/60 bg-amber-950/30 px-2 py-1 text-[10px] text-amber-200">
            Este texto não coube na caixa nem no tamanho mínimo e sairia cortado. Aumente a caixa ou
            diminua o tamanho mínimo.
          </p>
        )}

        <Section title="Arrastar no preview">
          <div className="flex gap-1">
            {(
              [
                ["video", "Vídeo"],
                ["logo", "Logo"],
                ["text", "Texto"],
              ] as const
            ).map(([target, label]) => (
              <button
                key={target}
                onClick={() => setEditTarget(target)}
                disabled={(target === "logo" && !draft.logo) || (target === "text" && !textOn)}
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
          <div className="mt-2 grid grid-cols-4 gap-2">
            {(editTarget === "video"
              ? ([
                  ["X", draft.videoX, (v: number) => setDraft((d) => ({ ...d, videoX: v }))],
                  ["Y", draft.videoY, (v: number) => setDraft((d) => ({ ...d, videoY: v }))],
                  ["Larg.", draft.videoWidth, (v: number) => setDraft((d) => ({ ...d, videoWidth: v }))],
                  ["Alt.", draft.videoHeight, (v: number) => setDraft((d) => ({ ...d, videoHeight: v }))],
                ] as const)
              : editTarget === "logo"
                ? ([
                    ["X", logoRect(draft).x, (v: number) => setDraft((d) => ({ ...d, logoX: v }))],
                    ["Y", logoRect(draft).y, (v: number) => setDraft((d) => ({ ...d, logoY: v }))],
                    ["Larg.", logoRect(draft).width, (v: number) => setDraft((d) => ({ ...d, logoWidth: v }))],
                    ["Alt.", logoRect(draft).height, (v: number) => setDraft((d) => ({ ...d, logoHeight: v }))],
                  ] as const)
                : ([
                    ["X", text?.x ?? 0, (v: number) => setText({ x: v })],
                    ["Y", text?.y ?? 0, (v: number) => setText({ y: v })],
                    ["Larg.", text?.width ?? 0, (v: number) => setText({ width: v })],
                    ["Alt.", text?.height ?? 0, (v: number) => setText({ height: v })],
                  ] as const)
            ).map(([label, value, set]) => (
              <Num key={label} label={label} value={value} onChange={(v) => set(Math.round(v))} />
            ))}
          </div>
        </Section>

        <Section title="Fundo">
          <div className="flex items-center gap-2">
            <ColorInput
              value={draft.backgroundColor ?? "#0a0b0f"}
              onChange={(v) => setDraft((d) => ({ ...d, backgroundColor: v }))}
            />
            <span className="text-[10px] text-ink-500">
              {draft.background ? "a imagem cobre a cor" : "template sem imagem"}
            </span>
          </div>
          <div className="mt-2 space-y-1">
            {(["background", "overlay", "logo"] as const).map((slot) => (
              <AssetRow
                key={slot}
                label={slot === "background" ? "Imagem de fundo" : slot === "overlay" ? "Overlay" : "Logo"}
                present={Boolean(draft[slot])}
                busy={uploading === slot}
                disabled={uploading !== null}
                onPick={() => pickFile(slot)}
                onRemove={() => {
                  setDraft((d) => ({ ...d, [slot]: undefined }));
                  if (slot === "logo" && editTarget === "logo") setEditTarget("video");
                }}
              />
            ))}
          </div>
        </Section>

        <Section title="Encaixe (§30)">
          <div className="flex gap-2">
            {(["fit", "fill"] as const).map((mode) => (
              <Toggle
                key={mode}
                active={draft.fitMode === mode}
                onClick={() => setDraft((d) => ({ ...d, fitMode: mode }))}
                label={mode === "fit" ? "FIT — cabe inteiro" : "FILL — preenche"}
              />
            ))}
          </div>
        </Section>

        <Section title="Texto (CTA)">
          {!textOn ? (
            <button
              onClick={() => {
                setText({ ...(text ?? DEFAULT_TEXT_STYLE), enabled: true });
                setEditTarget("text");
              }}
              className="w-full rounded-md border border-accent/50 px-2 py-1.5 text-xs text-accent transition hover:bg-accent/10"
            >
              + Mostrar o CTA sobre o vídeo
            </button>
          ) : (
            <div className="space-y-2">
              {previewText !== null ? (
                <label className="block">
                  <span className="block text-[10px] text-ink-500">Texto do vídeo aberto</span>
                  <textarea
                    value={previewText}
                    onChange={(e) => onPreviewTextChange(e.target.value)}
                    rows={3}
                    placeholder={previewPlaceholder || "Escreva o texto que aparece sobre este vídeo"}
                    className="mt-1 w-full resize-none rounded-md border border-ink-700 bg-ink-950/60 px-2 py-1.5 text-xs text-ink-200 focus:border-accent focus:outline-none"
                  />
                  <span className="mb-1 block">
                    <CtaPicker options={previewCtaOptions} text={previewLiveText} onPick={onPreviewTextChange} />
                  </span>
                  <span className="block text-[10px] text-ink-500">
                    Salvo sozinho, só neste vídeo. Vazio = usa o CTA da análise. O estilo abaixo
                    vale para todos os vídeos do template.
                  </span>
                </label>
              ) : (
                <p className="text-[10px] text-ink-500">
                  Clique num vídeo da lista para editar o texto dele. O estilo abaixo vale para
                  todos os vídeos do template.
                </p>
              )}
              <div className="flex gap-2">
                <select
                  value={text!.fontFile ? "__file__" : text!.fontFamily}
                  onChange={(e) =>
                    e.target.value === "__file__"
                      ? undefined
                      : setText({ fontFamily: e.target.value, fontFile: undefined })
                  }
                  className="min-w-0 flex-1 rounded-md border border-ink-700 bg-ink-950 px-2 py-1 text-xs text-ink-200"
                >
                  {text!.fontFile && <option value="__file__">{text!.fontFamily} (enviada)</option>}
                  {SYSTEM_FONTS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => pickFile("font")}
                  disabled={uploading !== null}
                  title="Enviar fonte TTF ou OTF"
                  className="rounded-md border border-ink-700 px-2 py-1 text-[11px] text-ink-300 transition hover:border-accent/50 hover:text-accent disabled:opacity-50"
                >
                  {uploading === "font" ? "…" : "TTF/OTF"}
                </button>
              </div>
              <div className="flex gap-1">
                <Toggle active={text!.bold} onClick={() => setText({ bold: !text!.bold })} label="Negrito" />
                <Toggle
                  active={text!.uppercase}
                  onClick={() => setText({ uppercase: !text!.uppercase })}
                  label="MAIÚSC."
                />
                {(["left", "center", "right"] as const).map((a) => (
                  <Toggle
                    key={a}
                    active={text!.align === a}
                    onClick={() => setText({ align: a })}
                    label={a === "left" ? "⟸" : a === "center" ? "≡" : "⟹"}
                  />
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Num label="Fonte máx." value={text!.maxFontSize} onChange={(v) => setText({ maxFontSize: Math.round(v) })} />
                <Num label="Fonte mín." value={text!.minFontSize} onChange={(v) => setText({ minFontSize: Math.round(v) })} />
                <Num label="Entrelinha" value={text!.lineHeight} step={0.05} onChange={(v) => setText({ lineHeight: v })} />
              </div>
              <div className="flex items-end gap-2">
                <label className="block">
                  <span className="block text-[10px] text-ink-500">Cor</span>
                  <ColorInput value={text!.color} onChange={(v) => setText({ color: v })} compact />
                </label>
                <label className="block">
                  <span className="block text-[10px] text-ink-500">Contorno</span>
                  <ColorInput value={text!.strokeColor} onChange={(v) => setText({ strokeColor: v })} compact />
                </label>
                <div className="w-16">
                  <Num label="Espessura" value={text!.strokeWidth} onChange={(v) => setText({ strokeWidth: Math.round(v) })} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-[11px] text-ink-300">
                  <input
                    type="checkbox"
                    checked={Boolean(text!.boxColor)}
                    onChange={(e) =>
                      setText(e.target.checked ? { boxColor: "#000000", boxOpacity: 0.6 } : { boxColor: undefined, boxOpacity: undefined })
                    }
                    className="accent-accent"
                  />
                  Faixa atrás
                </label>
                {text!.boxColor && (
                  <>
                    <ColorInput value={text!.boxColor} onChange={(v) => setText({ boxColor: v })} compact />
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={text!.boxOpacity ?? 1}
                      onChange={(e) => setText({ boxOpacity: Number(e.target.value) })}
                      className="min-w-0 flex-1 accent-accent"
                      title="Opacidade da faixa"
                    />
                  </>
                )}
              </div>
              <div className="grid grid-cols-4 gap-2">
                <Num label="Início (s)" value={text!.start} step={0.1} onChange={(v) => setText({ start: Math.max(0, v) })} />
                <Num
                  label="Fim (s)"
                  value={text!.end ?? 0}
                  step={0.1}
                  onChange={(v) => setText({ end: v > 0 ? v : null })}
                />
                <Num label="Fade ent." value={text!.fadeIn} step={0.1} onChange={(v) => setText({ fadeIn: Math.max(0, v) })} />
                <Num label="Fade saí." value={text!.fadeOut} step={0.1} onChange={(v) => setText({ fadeOut: Math.max(0, v) })} />
              </div>
              <p className="text-[10px] text-ink-500">Fim 0 = até o final do vídeo.</p>
              <button
                onClick={() => {
                  setText({ enabled: false });
                  if (editTarget === "text") setEditTarget("video");
                }}
                className="w-full rounded-md border border-ink-700 px-2 py-1 text-[11px] text-ink-400 transition hover:border-ink-600 hover:text-ink-200"
              >
                Tirar o texto do template
              </button>
            </div>
          )}
        </Section>

        <Section title="Áudio (§36)">
          <div className="grid grid-cols-4 gap-1">
            {(
              [
                ["original", "Original"],
                ["mute", "Mudo"],
                ["replace", "Música"],
                ["mix", "Misturar"],
              ] as const
            ).map(([mode, label]) => (
              <Toggle key={mode} active={audio.mode === mode} onClick={() => setAudio({ mode })} label={label} />
            ))}
          </div>
          {(audio.mode === "replace" || audio.mode === "mix") && (
            <div className="mt-2">
              <AssetRow
                label="Música"
                present={Boolean(audio.music)}
                busy={uploading === "music"}
                disabled={uploading !== null}
                onPick={() => pickFile("music")}
                onRemove={() => setAudio({ music: undefined })}
              />
            </div>
          )}
          <div className="mt-2 space-y-1">
            {audio.mode !== "mute" && audio.mode !== "replace" && (
              <Volume label="Áudio do vídeo" value={audio.originalVolume} onChange={(v) => setAudio({ originalVolume: v })} />
            )}
            {(audio.mode === "replace" || audio.mode === "mix") && (
              <Volume label="Música" value={audio.musicVolume} onChange={(v) => setAudio({ musicVolume: v })} />
            )}
          </div>
          <p className="mt-1 text-[10px] text-ink-500">
            A música entra em loop e é cortada no fim do vídeo. O preview não toca a música.
          </p>
        </Section>

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
    </section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[10px] uppercase tracking-wider text-ink-500">{title}</p>
      {children}
    </div>
  );
}

function Num({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <label className="block">
      <span className="block truncate text-[10px] text-ink-500">{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        className="mt-1 w-full rounded-md border border-ink-700 bg-ink-950/60 px-1.5 py-1 text-xs text-ink-200 focus:border-accent focus:outline-none"
      />
    </label>
  );
}

function Toggle({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-md border px-1.5 py-1 text-[11px] transition ${
        active ? "border-accent bg-accent/10 text-accent" : "border-ink-700 text-ink-400 hover:border-ink-600"
      }`}
    >
      {label}
    </button>
  );
}

function ColorInput({
  value,
  onChange,
  compact,
}: {
  value: string;
  onChange: (v: string) => void;
  compact?: boolean;
}) {
  return (
    <span className="flex items-center gap-1">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-9 cursor-pointer rounded border border-ink-700 bg-ink-950"
      />
      {!compact && (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-20 rounded-md border border-ink-700 bg-ink-950 px-2 py-1 font-mono text-xs text-ink-200 focus:border-accent focus:outline-none"
        />
      )}
    </span>
  );
}

function AssetRow({
  label,
  present,
  busy,
  disabled,
  onPick,
  onRemove,
}: {
  label: string;
  present: boolean;
  busy: boolean;
  disabled: boolean;
  onPick: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onPick}
        disabled={disabled}
        className="flex-1 rounded-md border border-ink-700 px-2 py-1 text-left text-xs text-ink-300 transition hover:border-accent/50 hover:text-accent disabled:opacity-50"
      >
        {busy ? "Enviando…" : label}
        {present ? " ✓" : " —"}
      </button>
      {present && (
        <button onClick={onRemove} className="rounded px-1 text-xs text-ink-600 transition hover:text-red-300">
          ×
        </button>
      )}
    </div>
  );
}

function Volume({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-2 text-[11px] text-ink-300">
      <span className="w-24 shrink-0">{label}</span>
      <input
        type="range"
        min={0}
        max={2}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1 accent-accent"
      />
      <span className="w-10 text-right tabular-nums">{Math.round(value * 100)}%</span>
    </label>
  );
}
