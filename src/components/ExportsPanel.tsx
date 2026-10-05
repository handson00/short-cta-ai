"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import AgendadorEnvio, { type ReciboAgendador } from "./AgendadorEnvio";

/** Tipos declarados aqui: componente cliente nunca importa de arquivo que toca o banco. */
interface ExportItem {
  jobId: string;
  videoId: string;
  videoName: string;
  fileName: string;
  outputPath: string;
  bytes: number | null;
  fileMissing: boolean;
  durationSeconds: number | null;
  completedAt: string | null;
  thisSession: boolean;
  cta: string | null;
  description: string | null;
  hashtags: string[];
  kitHashtags: string[];
  aiHashtags: Array<{ tag: string; reason: string | null }>;
  aiHashtagsJa: Array<{ tag: string; reason: string | null }>;
  /** Legenda principal, em português. */
  ptCaption: string | null;
  jpCaption: string | null;
  transcript: string | null;
  sceneSummary: string | null;
  plot: string | null;
  workTitle: string | null;
  originalUrl: string | null;
  sourceLabel: string | null;
  /** Último envio à extensão Agendador IG, se houve. */
  agendador: ReciboAgendador | null;
  /** O vídeo saiu da Fila e está guardado só aqui, no histórico. */
  archivedAt: string | null;
}

/** Arrasto mínimo para trocar de vídeo. Menos que isso é toque, não gesto. */
const SWIPE_PX = 60;
/** Abaixo disto o gesto ainda é um clique (tremida da mão), não um arrasto. */
const DRAG_START_PX = 6;

function mb(bytes: number | null): string {
  return bytes === null ? "—" : `${(bytes / 1e6).toFixed(1)} MB`;
}

function duration(s: number | null): string {
  if (!s || !Number.isFinite(s)) return "—";
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
}

function hora(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ExportsPanel() {
  const [items, setItems] = useState<ExportItem[]>([]);
  const [dir, setDir] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onlySession, setOnlySession] = useState(true);
  const [index, setIndex] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/exports", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setItems(data.exports ?? []);
      setDir(data.outputDir ?? "");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const daSessao = items.filter((i) => i.thisSession);
  const lista = onlySession ? daSessao : items;

  // Trocar de filtro pode encurtar a lista: sem isto, o índice apontaria para
  // um vídeo que não está mais nela e a tela ficaria vazia.
  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, lista.length - 1)));
  }, [lista.length]);

  if (loading) return <p className="hint">Carregando exportações…</p>;

  const atual = lista[index] ?? null;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Exportações</h1>
          <p className="hint mt-1">
            Os vídeos prontos como aparecem no celular. Arraste para cima para o próximo; os dados ao lado acompanham.
          </p>
          {dir && (
            <p className="hint mt-1">
              Pasta: <span className="font-mono text-ink-300">{dir}</span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg border border-ink-800 bg-ink-950/60 p-1">
            {(
              [
                [true, `Desta sessão (${daSessao.length})`],
                [false, `Todos (${items.length})`],
              ] as const
            ).map(([value, label]) => (
              <button
                key={String(value)}
                onClick={() => {
                  setOnlySession(value);
                  setIndex(0);
                }}
                className={`rounded-md px-3 py-1 text-xs transition ${
                  onlySession === value ? "bg-accent/15 text-accent" : "text-ink-400 hover:text-ink-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={() => void load()}
            className="rounded-lg border border-ink-700 px-3 py-1 text-xs text-ink-300 transition hover:border-accent/50 hover:text-accent"
          >
            Atualizar
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div>
      )}

      {lista.length === 0 ? (
        <div className="rounded-lg border border-dashed border-ink-700 bg-ink-900/30 p-8 text-center">
          <p className="text-sm text-ink-300">
            {onlySession && items.length > 0
              ? "Nenhum vídeo exportado desde que o servidor subiu."
              : "Nenhum vídeo exportado ainda."}
          </p>
          <p className="mt-2 text-xs text-ink-500">
            No{" "}
            <a href="/editor" className="text-accent underline hover:text-accent/80">
              Editor
            </a>
            , selecione os vídeos e clique em &ldquo;Exportar&rdquo;.
            {onlySession && items.length > 0 && " Ou veja os anteriores em “Todos”."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-5 lg:flex-row">
          <Feed lista={lista} index={index} onIndex={setIndex} />
          {atual && (
            <DadosDoVideo
              item={atual}
              posicao={`${index + 1} de ${lista.length}`}
              lista={lista}
              onGerado={load}
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * O feed vertical, como no celular: um vídeo por vez, 9:16, e o gesto de
 * arrastar para cima leva ao próximo.
 *
 * Só os vizinhos (anterior, atual, próximo) ficam montados: com dezenas de
 * exportações, um `<video>` por item deixaria a página pesada e faria o
 * navegador baixar todos ao mesmo tempo.
 */
function Feed({
  lista,
  index,
  onIndex,
}: {
  lista: ExportItem[];
  index: number;
  onIndex: (i: number) => void;
}) {
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [muted, setMuted] = useState(true);
  const startY = useRef(0);
  const wheelLock = useRef(false);
  const videos = useRef(new Map<string, HTMLVideoElement>());

  const ir = useCallback(
    (delta: number) => {
      const next = Math.min(lista.length - 1, Math.max(0, index + delta));
      if (next !== index) onIndex(next);
    },
    [index, lista.length, onIndex],
  );

  // O `muted` é aplicado no elemento, não só pela prop: o React trata `muted`
  // como atributo, e atributo só vale na criação do elemento — o vídeo ficaria
  // mudo mesmo depois de clicar no botão de som.
  useEffect(() => {
    for (const el of videos.current.values()) el.muted = muted;
  }, [muted, index]);

  // Só o vídeo da vez toca: os vizinhos ficam prontos, parados no começo.
  useEffect(() => {
    const atual = lista[index];
    for (const [id, el] of videos.current) {
      if (id === atual?.jobId) {
        el.currentTime = 0;
        void el.play().catch(() => {
          // Autoplay bloqueado pelo navegador: o botão de som resolve.
        });
      } else {
        el.pause();
      }
    }
  }, [index, lista]);

  // Setas do teclado: o mesmo gesto para quem não usa o mouse.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "PageDown") {
        e.preventDefault();
        ir(1);
      } else if (e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault();
        ir(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ir]);

  function onPointerDown(e: React.PointerEvent) {
    // Só o botão principal, e nunca a partir dos controles (som, setas).
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    startY.current = e.clientY;
    setDragging(true);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging) return;
    const dy = e.clientY - startY.current;
    // A captura só entra quando já é arrasto. Capturado desde o pointerdown,
    // o navegador entrega o `click` à área de arrastar, não ao alvo: o botão
    // de som não ligava o som e o toque no vídeo não pausava.
    const area = e.currentTarget as HTMLElement;
    if (Math.abs(dy) > DRAG_START_PX && !area.hasPointerCapture(e.pointerId)) {
      area.setPointerCapture(e.pointerId);
    }
    // Resistência nas pontas: puxar além do primeiro ou do último não desliza
    // a tela inteira, só cede um pouco — como no celular.
    const noLimite = (dy > 0 && index === 0) || (dy < 0 && index === lista.length - 1);
    setDrag(noLimite ? dy / 4 : dy);
  }

  function onPointerUp() {
    if (!dragging) return;
    setDragging(false);
    if (drag <= -SWIPE_PX) ir(1);
    else if (drag >= SWIPE_PX) ir(-1);
    setDrag(0);
  }

  return (
    <div className="flex shrink-0 flex-col items-center gap-2">
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={(e) => {
          if (wheelLock.current || Math.abs(e.deltaY) < 8) return;
          wheelLock.current = true;
          ir(e.deltaY > 0 ? 1 : -1);
          // Uma rolagem = um vídeo: sem isto, um giro da roda pularia vários.
          setTimeout(() => (wheelLock.current = false), 350);
        }}
        className="relative aspect-[9/16] h-[min(74vh,660px)] cursor-grab touch-none select-none overflow-hidden rounded-[2rem] border-4 border-ink-800 bg-black shadow-2xl active:cursor-grabbing"
      >
        {lista.map((item, i) => {
          if (Math.abs(i - index) > 1) return null;
          const offset = (i - index) * 100;
          return (
            <div
              key={item.jobId}
              className="absolute inset-0"
              style={{
                transform: `translateY(calc(${offset}% + ${drag}px))`,
                transition: dragging ? "none" : "transform 280ms cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            >
              {item.fileMissing ? (
                <div className="grid h-full place-items-center p-6 text-center">
                  <div>
                    <p className="text-sm text-amber-200">O arquivo não está mais na pasta.</p>
                    <p className="mt-2 text-xs text-ink-500">
                      Os dados ao lado continuam aqui. Para ter o vídeo, exporte de novo no Editor.
                    </p>
                  </div>
                </div>
              ) : (
                <video
                  ref={(el) => {
                    if (el) videos.current.set(item.jobId, el);
                    else videos.current.delete(item.jobId);
                  }}
                  src={`/api/exports/${item.jobId}/media`}
                  poster={`/api/videos/${item.videoId}/thumb`}
                  loop
                  muted={muted}
                  playsInline
                  preload={i === index ? "auto" : "metadata"}
                  className="h-full w-full object-contain"
                  onClick={(e) => {
                    const v = e.currentTarget;
                    if (v.paused) void v.play().catch(() => {});
                    else v.pause();
                  }}
                />
              )}
            </div>
          );
        })}

        {/* Controles sobre o vídeo, como no app: som e posição. */}
        <button
          onClick={() => setMuted((m) => !m)}
          title={muted ? "Ligar o som" : "Desligar o som"}
          className="absolute bottom-3 right-3 z-10 rounded-full bg-black/70 px-2.5 py-1 text-sm text-white transition hover:bg-black/90"
        >
          {muted ? "🔇" : "🔊"}
        </button>
        <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white">
          {index + 1}/{lista.length}
        </div>

        {index > 0 && (
          <button
            onClick={() => ir(-1)}
            title="Anterior"
            className="absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white/80 transition hover:bg-black/80"
          >
            ▲
          </button>
        )}
        {index < lista.length - 1 && (
          <button
            onClick={() => ir(1)}
            title="Próximo"
            className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 animate-pulse rounded-full bg-black/60 px-2 py-0.5 text-xs text-white/80 transition hover:bg-black/80"
          >
            ▼
          </button>
        )}
      </div>
      <p className="text-[11px] text-ink-500">Arraste, role ou use ↑ ↓ · clique no vídeo para pausar</p>
    </div>
  );
}

/** Todos os dados do vídeo em reprodução, cada um com o seu botão de copiar. */
function DadosDoVideo({
  item,
  posicao,
  lista,
  onGerado,
}: {
  item: ExportItem;
  posicao: string;
  lista: ExportItem[];
  onGerado: () => Promise<void>;
}) {
  const [gerando, setGerando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ kind: "ok" | "erro"; text: string } | null>(null);

  const base = item.hashtags.length > 0 ? item.hashtags : item.kitHashtags;
  const daIa = item.aiHashtags.map((h) => h.tag);
  const daIaJa = item.aiHashtagsJa.map((h) => h.tag);
  const hashtags = [...base, ...daIa].join(" ");
  // Para colar numa publicação em português: a legenda gerada aqui (a
  // principal), senão a do kit, senão o próprio gancho — mais as hashtags.
  const pacote = [item.ptCaption ?? item.description ?? item.cta ?? "", hashtags].filter(Boolean).join("\n\n");
  // A versão japonesa leva a legenda e as hashtags japonesas.
  const pacoteJa = [item.jpCaption ?? "", daIaJa.join(" ")].filter(Boolean).join("\n\n");

  /** O que cada idioma gera, para a confirmação dizer o custo sem rodeio. */
  const temPacote = (v: ExportItem, idioma: "pt" | "ja") => (idioma === "pt" ? v.ptCaption : v.jpCaption) !== null;

  async function gerar(idioma: "pt" | "ja", escopo: "este" | "todos") {
    const alvos = escopo === "este" ? [item] : lista;
    const pendentes = escopo === "todos" ? alvos.filter((v) => !temPacote(v, idioma)) : alvos;
    const refazer = escopo === "este" && temPacote(item, idioma);
    const quantos = refazer ? 1 : pendentes.length;

    const oQue = idioma === "pt" ? "a legenda em português e 2 hashtags" : "a legenda em japonês e 1 hashtag japonesa";
    if (quantos === 0) {
      setAviso({ kind: "ok", text: `Todos os vídeos da lista já têm ${oQue}.` });
      return;
    }
    const confirmado = window.confirm(
      [
        escopo === "este"
          ? `Gerar ${refazer ? "de novo " : ""}${oQue} para este vídeo?`
          : `Gerar ${oQue} para ${quantos} vídeo(s) desta lista?`,
        `Custo: ${quantos} chamada(s) à IA (pagas no GhostCLI; no Gemini gratuito, contam na cota).`,
        escopo === "todos" && alvos.length > pendentes.length
          ? `${alvos.length - pendentes.length} já têm e serão pulados.`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
    if (!confirmado) return;

    setGerando(`${idioma}-${escopo}`);
    setAviso(null);
    try {
      const res = await fetch("/api/exports/hashtags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoIds: (refazer ? alvos : pendentes).map((v) => v.videoId),
          idioma,
          force: refazer,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const falhas = (data.falhas ?? []) as Array<{ reason: string }>;
      setAviso({
        kind: falhas.length > 0 ? "erro" : "ok",
        text:
          `${(data.gerados ?? []).length} vídeo(s) receberam ${oQue}.` +
          (falhas.length > 0 ? ` ${falhas.length} falharam: ${falhas[0].reason}` : ""),
      });
      await onGerado();
    } catch (err) {
      setAviso({ kind: "erro", text: err instanceof Error ? err.message : "Falha ao gerar." });
    } finally {
      setGerando(null);
    }
  }

  return (
    <section className="min-w-0 flex-1 space-y-3">
      <div className="card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink-100" title={item.fileName}>
              {item.fileName}
            </p>
            <p className="mt-0.5 text-[11px] text-ink-500">
              {posicao} · {hora(item.completedAt)} · {duration(item.durationSeconds)} · {mb(item.bytes)}
              {item.sourceLabel && ` · ${item.sourceLabel}`}
            </p>
            {item.workTitle && <p className="mt-0.5 text-[11px] text-ink-400">{item.workTitle}</p>}
          </div>
          <CopyButton label="Copiar tudo" value={pacote} primary />
        </div>
        {item.fileMissing && (
          <p className="mt-2 rounded border border-amber-900/60 bg-amber-950/30 px-2 py-1 text-[11px] text-amber-200">
            O arquivo não está mais nessa pasta (apagado, movido ou disco desconectado).
          </p>
        )}
        {item.archivedAt && (
          <p className="mt-2 rounded border border-ink-700 bg-ink-900/60 px-2 py-1 text-[11px] text-ink-400">
            Este vídeo saiu da Fila em {hora(item.archivedAt)}. Ele está guardado só aqui, com os dados — até você
            remover do histórico.
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-1">
          <CopyButton label="Caminho do arquivo" value={item.outputPath} />
          {item.originalUrl && <CopyButton label="Link de origem" value={item.originalUrl} />}
        </div>
        <RemoverDoHistorico item={item} lista={lista} onRemovido={onGerado} />
      </div>

      <AgendadorEnvio item={item} onEnviado={onGerado} />

      <Field label="Texto no vídeo (CTA)" value={item.cta} />

      <div className="rounded-lg border border-ink-800 bg-ink-950/40 p-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wider text-ink-500">
            Hashtags ({base.length + daIa.length + daIaJa.length})
          </span>
          {hashtags && <CopyButton label="Copiar" value={hashtags} />}
        </div>

        {hashtags ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {base.map((tag) => (
              <span key={tag} className="rounded bg-ink-800 px-1.5 py-0.5 text-[11px] text-ink-300">
                {tag}
              </span>
            ))}
            {item.aiHashtags.map((h) => (
              // Verde = sugerida pela IA, não capturada do post de origem.
              <span
                key={h.tag}
                title={h.reason ?? "Sugerida pela IA"}
                className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] text-emerald-300"
              >
                {h.tag}
              </span>
            ))}
            {item.aiHashtagsJa.map((h) => (
              // Azul = sugerida pela IA em japonês, para separar dos dois outros grupos.
              <span
                key={h.tag}
                title={h.reason ?? "Sugerida pela IA, em japonês"}
                className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[11px] text-sky-300"
              >
                {h.tag}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-[11px] text-ink-500">Nenhuma hashtag ainda.</p>
        )}

        {(daIa.length > 0 || daIaJa.length > 0) && (
          <p className="mt-1.5 text-[10px] text-ink-500">
            Cinza: capturadas do post. Verde: sugeridas pela IA. Azul: em japonês. (Passe o mouse para ver o motivo.)
            Elas classificam o conteúdo — ninguém consegue saber de antemão quais dão visualização, e hashtag genérica
            (#viral, #fyp) não é usada porque mistura o vídeo com qualquer assunto.
          </p>
        )}

        {aviso && (
          <p className={`mt-1.5 text-[11px] ${aviso.kind === "ok" ? "text-emerald-300" : "text-red-300"}`}>
            {aviso.text}
          </p>
        )}
      </div>

      <Legenda
        titulo="Legenda (português)"
        principal
        texto={item.ptCaption}
        vazio="Ainda não gerada. É a legenda principal do post."
        botoes={
          <>
            <BotaoGerar
              rotulo={item.ptCaption ? "↻ Gerar outra" : "✨ Gerar"}
              ocupado={gerando === "pt-este"}
              desabilitado={gerando !== null}
              titulo="Gera a legenda em português e 2 hashtags para este vídeo"
              onClick={() => void gerar("pt", "este")}
            />
            <BotaoGerar
              rotulo={`em todos (${lista.length})`}
              ocupado={gerando === "pt-todos"}
              desabilitado={gerando !== null || lista.length === 0}
              titulo="Gera a legenda em português e 2 hashtags para todos os vídeos da lista que ainda não têm"
              onClick={() => void gerar("pt", "todos")}
              secundario
            />
          </>
        }
      />

      <Legenda
        titulo="Legenda (japonês)"
        texto={item.jpCaption}
        vazio="Ainda não gerada. Opcional, para publicar também em japonês."
        copiarTudo={pacoteJa || undefined}
        botoes={
          <>
            <BotaoGerar
              rotulo={item.jpCaption ? "↻ Gerar outra" : "✨ Gerar em japonês"}
              ocupado={gerando === "ja-este"}
              desabilitado={gerando !== null}
              titulo="Gera a legenda em japonês e 1 hashtag japonesa para este vídeo"
              onClick={() => void gerar("ja", "este")}
            />
            <BotaoGerar
              rotulo={`em todos (${lista.length})`}
              ocupado={gerando === "ja-todos"}
              desabilitado={gerando !== null || lista.length === 0}
              titulo="Gera a legenda em japonês para todos os vídeos da lista que ainda não têm"
              onClick={() => void gerar("ja", "todos")}
              secundario
            />
          </>
        }
      />

      <Field label="Legenda do kit de publicação" value={item.description} collapsed />
      <Field label="Resumo da cena" value={item.sceneSummary} collapsed />
      <Field label="Enredo (pela fala)" value={item.plot} collapsed />
      <Field label="Transcrição" value={item.transcript} collapsed />
    </section>
  );
}

/**
 * "Remover do histórico", com a confirmação no próprio cartão.
 *
 * Não é `window.confirm` porque há uma escolha a fazer — apagar ou não o MP4
 * da pasta — e ela não cabe num OK/Cancelar. O padrão é manter o arquivo: é o
 * vídeo pronto para publicar, numa pasta que é do usuário.
 */
function RemoverDoHistorico({
  item,
  lista,
  onRemovido,
}: {
  item: ExportItem;
  lista: ExportItem[];
  onRemovido: () => Promise<void>;
}) {
  const [aberto, setAberto] = useState(false);
  const [apagarArquivo, setApagarArquivo] = useState(false);
  const [removendo, setRemovendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Ao trocar de vídeo, a confirmação aberta não pode valer para o próximo.
  useEffect(() => {
    setAberto(false);
    setApagarArquivo(false);
    setErro(null);
  }, [item.jobId]);

  // A lista da tela pode estar filtrada ("Desta sessão"): o servidor é quem
  // decide de verdade. Isto só serve para o aviso.
  const ultimaDoVideo = lista.filter((x) => x.videoId === item.videoId).length <= 1;
  const somePraSempre = item.archivedAt !== null && ultimaDoVideo;

  async function remover() {
    setRemovendo(true);
    setErro(null);
    try {
      const res = await fetch(
        `/api/exports/${encodeURIComponent(item.jobId)}${apagarArquivo ? "?apagarArquivo=1" : ""}`,
        { method: "DELETE" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setAberto(false);
      await onRemovido();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao remover.");
    } finally {
      setRemovendo(false);
    }
  }

  if (!aberto) {
    return (
      <div className="mt-2 flex justify-end">
        <button
          onClick={() => setAberto(true)}
          className="rounded-md px-2 py-0.5 text-[10px] text-ink-500 transition hover:text-red-300"
        >
          🗑 Remover do histórico
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-md border border-red-900/60 bg-red-950/20 p-2 text-[11px] text-ink-300">
      <p>
        {somePraSempre
          ? "Este vídeo já saiu da Fila e esta é a última exportação dele: removendo, ele e os dados dele (legendas, hashtags, transcrição) são apagados de vez."
          : item.archivedAt
            ? "Remove esta exportação do histórico. As outras exportações deste vídeo continuam aqui."
            : "Remove esta exportação do histórico. O vídeo continua na Fila."}
      </p>
      <label className="mt-1.5 flex cursor-pointer items-center gap-1.5">
        <input
          type="checkbox"
          checked={apagarArquivo}
          onChange={(e) => setApagarArquivo(e.target.checked)}
          disabled={item.fileMissing}
          className="accent-red-400"
        />
        {item.fileMissing
          ? "O arquivo MP4 já não está na pasta."
          : `Apagar também o arquivo ${item.fileName} da pasta`}
      </label>
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => void remover()}
          disabled={removendo}
          className="rounded-md bg-red-600/80 px-2 py-0.5 text-[11px] text-white transition hover:bg-red-600 disabled:opacity-50"
        >
          {removendo ? "Removendo…" : "Remover"}
        </button>
        <button
          onClick={() => setAberto(false)}
          disabled={removendo}
          className="rounded-md border border-ink-700 px-2 py-0.5 text-[11px] text-ink-400 transition hover:text-ink-200"
        >
          Cancelar
        </button>
      </div>
      {erro && <p className="mt-1.5 text-red-300">{erro}</p>}
    </div>
  );
}

/**
 * Uma legenda com os botões de gerar.
 *
 * Diferente de `Field`: aparece mesmo vazia, porque é aqui que se pede a
 * geração — um campo escondido não teria onde clicar.
 */
function Legenda({
  titulo,
  texto,
  vazio,
  botoes,
  principal,
  copiarTudo,
}: {
  titulo: string;
  texto: string | null;
  vazio: string;
  botoes: ReactNode;
  principal?: boolean;
  /** Valor do "Copiar com hashtags", quando faz sentido para este idioma. */
  copiarTudo?: string;
}) {
  return (
    <div
      className={`rounded-lg border p-2 ${principal ? "border-accent/30 bg-accent/5" : "border-ink-800 bg-ink-950/40"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-ink-500">{titulo}</span>
        <div className="flex flex-wrap gap-1">
          {botoes}
          {texto && <CopyButton label="Copiar" value={texto} />}
          {texto && copiarTudo && <CopyButton label="Com hashtags" value={copiarTudo} />}
        </div>
      </div>
      {texto ? (
        <p className="mt-1 whitespace-pre-wrap text-xs text-ink-300">{texto}</p>
      ) : (
        <p className="mt-1 text-[11px] text-ink-500">{vazio}</p>
      )}
    </div>
  );
}

function BotaoGerar({
  rotulo,
  ocupado,
  desabilitado,
  titulo,
  onClick,
  secundario,
}: {
  rotulo: string;
  ocupado: boolean;
  desabilitado: boolean;
  titulo: string;
  onClick: () => void;
  secundario?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={desabilitado}
      title={titulo}
      className={`rounded-md border px-2 py-0.5 text-[10px] transition disabled:opacity-50 ${
        secundario
          ? "border-ink-700 text-ink-400 hover:border-accent/50 hover:text-accent"
          : "border-accent/50 text-accent hover:bg-accent/10"
      }`}
    >
      {ocupado ? "Gerando…" : rotulo}
    </button>
  );
}

/** Um dado do vídeo com o botão de copiar. Vazio some: nada de campo em branco. */
function Field({ label, value, collapsed }: { label: string; value: string | null; collapsed?: boolean }) {
  if (!value?.trim()) return null;
  const body = <p className="mt-1 whitespace-pre-wrap text-xs text-ink-300">{value}</p>;
  return (
    <div className="rounded-lg border border-ink-800 bg-ink-950/40 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-ink-500">{label}</span>
        <CopyButton label="Copiar" value={value} />
      </div>
      {collapsed ? (
        <details>
          <summary className="cursor-pointer text-[11px] text-ink-500 hover:text-ink-300">
            ver ({value.length} caracteres)
          </summary>
          {body}
        </details>
      ) : (
        body
      )}
    </div>
  );
}

function CopyButton({ label, value, primary }: { label: string; value: string; primary?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Sem permissão da área de transferência: o texto continua na tela.
        }
      }}
      className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] transition ${
        primary
          ? "bg-accent/90 text-white hover:bg-accent"
          : "border border-ink-700 text-ink-400 hover:border-accent/50 hover:text-accent"
      }`}
    >
      {copied ? "Copiado!" : label}
    </button>
  );
}
