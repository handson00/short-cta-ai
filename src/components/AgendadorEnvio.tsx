"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AGENDADOR_LIMITES,
  ROTULO_BLOCO,
  blocosDisponiveis,
  hashtagsOferecidas,
  montarPost,
  selecaoPadrao,
  type Bloco,
  type FontesDoPost,
  type HashtagsDoVideo,
} from "@/lib/agendadorPost";

/**
 * "✈ Enviar para o Agendador IG": manda o vídeo exportado, com o que foi
 * marcado, para a extensão do usuário — como rascunho, no próximo horário
 * livre da grade dela. Quem programa no Instagram continua sendo a extensão.
 *
 * O caminho: o servidor monta o post e um link assinado do vídeo; a página
 * entrega à extensão pela ponte (`ponte-short-cta.js`, que roda nesta página);
 * a extensão baixa o vídeo e responde. Só então o recibo é gravado.
 */

const DA_PAGINA = "short-cta-ai→agendador";
const DA_EXTENSAO = "agendador→short-cta-ai";
/** Baixar ~100 MB e recarregar o painel leva segundos; isto é a margem. */
const TEMPO_LIMITE_MS = 120_000;

type EstadoExtensao =
  | { tipo: "procurando" }
  | { tipo: "pronta"; versao: string }
  | { tipo: "ausente" }
  | { tipo: "outro-endereco" };

interface RespostaExtensao {
  ok: boolean;
  message?: string;
  code?: string;
  postId?: string;
  date?: string;
  time?: string;
  painelAberto?: boolean;
}

export interface ReciboAgendador {
  data: string | null;
  hora: string | null;
  enviadoEm: string;
}

/** Procura a ponte da extensão nesta página. Sem resposta, diz que não achou — não esconde. */
function useExtensao(): EstadoExtensao {
  const [estado, setEstado] = useState<EstadoExtensao>({ tipo: "procurando" });

  useEffect(() => {
    if (!["localhost", "127.0.0.1"].includes(window.location.hostname)) {
      setEstado({ tipo: "outro-endereco" });
      return;
    }
    let achou = false;
    const ouvir = (ev: MessageEvent) => {
      if (ev.source !== window || ev.data?.canal !== DA_EXTENSAO || ev.data.tipo !== "pronto") return;
      achou = true;
      setEstado({ tipo: "pronta", versao: String(ev.data.versao ?? "?") });
    };
    window.addEventListener("message", ouvir);
    window.postMessage({ canal: DA_PAGINA, tipo: "ping" }, window.location.origin);
    const t = window.setTimeout(() => {
      if (!achou) setEstado({ tipo: "ausente" });
    }, 2000);
    return () => {
      window.removeEventListener("message", ouvir);
      window.clearTimeout(t);
    };
  }, []);

  return estado;
}

function pedirAExtensao(tipo: "enviar" | "abrir-painel", dados: Record<string, unknown> = {}): Promise<RespostaExtensao> {
  const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return new Promise((resolve) => {
    const ouvir = (ev: MessageEvent) => {
      if (ev.source !== window || ev.data?.canal !== DA_EXTENSAO || ev.data.tipo !== "resposta" || ev.data.id !== id) return;
      fim(ev.data as RespostaExtensao);
    };
    const t = window.setTimeout(
      () => fim({ ok: false, message: "O Agendador IG não respondeu a tempo. Confira o painel dele antes de mandar de novo." }),
      TEMPO_LIMITE_MS,
    );
    function fim(r: RespostaExtensao) {
      window.removeEventListener("message", ouvir);
      window.clearTimeout(t);
      resolve(r);
    }
    window.addEventListener("message", ouvir);
    window.postMessage({ canal: DA_PAGINA, tipo, id, ...dados }, window.location.origin);
  });
}

function dataCurta(data: string | null, hora: string | null): string {
  if (!data) return "sem horário";
  const [a, m, d] = data.split("-").map(Number);
  const dia = new Date(a, m - 1, d).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
  return hora ? `${dia} às ${hora}` : dia;
}

export default function AgendadorEnvio({
  item,
  onEnviado,
}: {
  item: FontesDoPost &
    HashtagsDoVideo & { jobId: string; fileMissing: boolean; agendador: ReciboAgendador | null };
  onEnviado: () => Promise<void>;
}) {
  const extensao = useExtensao();
  const disponiveis = useMemo(() => blocosDisponiveis(item), [item]);
  const oferecidas = useMemo(() => hashtagsOferecidas(item), [item]);
  const japonesas = useMemo(() => new Set(item.aiHashtagsJa.map((h) => h.tag)), [item]);
  const daIa = useMemo(() => new Set(item.aiHashtags.map((h) => h.tag)), [item]);

  const [blocos, setBlocos] = useState<Bloco[]>([]);
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ kind: "ok" | "erro" | "atencao"; text: string } | null>(null);

  // Ao trocar de vídeo, volta ao padrão dele: a marcação de um vídeo não pode
  // vazar para o próximo e sair no post errado.
  const jobAtual = useRef<string | null>(null);
  useEffect(() => {
    if (jobAtual.current === item.jobId) return;
    jobAtual.current = item.jobId;
    const padrao = selecaoPadrao(item, oferecidas);
    setBlocos(padrao.blocos);
    setHashtags(padrao.hashtags);
    setAviso(null);
  }, [item, oferecidas]);

  const post = useMemo(() => montarPost(item, { blocos, hashtags }), [item, blocos, hashtags]);

  const alternar = <T,>(lista: T[], v: T) => (lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v]);

  const enviar = useCallback(async () => {
    setAviso(null);
    try {
      setEnviando("Preparando o vídeo…");
      const res = await fetch(`/api/agendador/${encodeURIComponent(item.jobId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocos, hashtags }),
      });
      const preparo = await res.json();
      if (!res.ok) throw new Error(preparo.error ?? `HTTP ${res.status}`);

      setEnviando("Entregando ao Agendador…");
      const r = await pedirAExtensao("enviar", { post: preparo.post, videoUrl: preparo.videoUrl });
      if (!r.ok) {
        setAviso({ kind: r.code === "duplicado" ? "atencao" : "erro", text: r.message ?? "O Agendador recusou o envio." });
        return;
      }

      setEnviando("Gravando o recibo…");
      const conf = await fetch(`/api/agendador/${encodeURIComponent(item.jobId)}/confirmar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extPostId: r.postId, data: r.date || null, hora: r.time || null, texto: preparo.textoFinal }),
      });
      // O post JÁ está na extensão: falhar o recibo não desfaz o envio, e a
      // mensagem precisa dizer isso para ninguém mandar duas vezes.
      const recibo = conf.ok ? null : ((await conf.json().catch(() => ({}))) as { error?: string });

      setAviso({
        kind: recibo ? "atencao" : "ok",
        text:
          (r.date
            ? `✓ No Agendador como rascunho para ${dataCurta(r.date, r.time ?? null)}. Confira lá e clique em Agendar.`
            : "✓ No Agendador como rascunho, mas sem horário: a grade não tem vaga livre. Escolha o horário no painel.") +
          (recibo ? ` (O recibo não foi gravado aqui: ${recibo.error ?? "erro"}.)` : ""),
      });
      await onEnviado();
    } catch (err) {
      setAviso({ kind: "erro", text: err instanceof Error ? err.message : "Falha ao enviar." });
    } finally {
      setEnviando(null);
    }
  }, [item.jobId, blocos, hashtags, onEnviado]);

  const pronta = extensao.tipo === "pronta";
  const bloqueio =
    item.fileMissing
      ? "O arquivo deste vídeo não está mais na pasta."
      : extensao.tipo === "outro-endereco"
        ? "Abra o sistema por http://localhost:3000 para enviar: a extensão só fala com esse endereço."
        : extensao.tipo === "ausente"
          ? "Agendador IG 0.5 não encontrado nesta aba. Instale/recarregue a extensão e depois recarregue esta página (F5)."
          : post.problemas[0] ?? null;

  return (
    <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-indigo-200">✈ Enviar para o Agendador IG</span>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] ${
            pronta ? "bg-emerald-500/15 text-emerald-300" : extensao.tipo === "procurando" ? "text-ink-500" : "bg-amber-500/15 text-amber-200"
          }`}
        >
          {pronta ? `extensão conectada · v${extensao.versao}` : extensao.tipo === "procurando" ? "procurando a extensão…" : "extensão não conectada"}
        </span>
      </div>

      {item.agendador && (
        <p className="mt-1.5 text-[11px] text-indigo-200/80">
          Já enviado em {new Date(item.agendador.enviadoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} —
          rascunho para {dataCurta(item.agendador.data, item.agendador.hora)}.
        </p>
      )}

      <div className="mt-2">
        <p className="text-[10px] text-ink-500">Legenda</p>
        {disponiveis.length === 0 ? (
          <p className="mt-0.5 text-[11px] text-ink-500">Nenhum texto gerado para este vídeo ainda.</p>
        ) : (
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {disponiveis.map((b) => (
              <label key={b} className="flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-300">
                <input
                  type="checkbox"
                  checked={blocos.includes(b)}
                  onChange={() => setBlocos((l) => alternar(l, b))}
                  className="accent-indigo-400"
                />
                {ROTULO_BLOCO[b]}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="mt-2">
        <p className="text-[10px] text-ink-500">Hashtags (clique para tirar ou pôr)</p>
        {oferecidas.length === 0 ? (
          <p className="mt-0.5 text-[11px] text-ink-500">Nenhuma hashtag para este vídeo.</p>
        ) : (
          <div className="mt-1 flex flex-wrap gap-1">
            {oferecidas.map((tag) => {
              const marcada = hashtags.includes(tag);
              const cor = japonesas.has(tag)
                ? "bg-sky-500/15 text-sky-300"
                : daIa.has(tag)
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "bg-ink-800 text-ink-300";
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setHashtags((l) => alternar(l, tag))}
                  aria-pressed={marcada}
                  className={`rounded px-1.5 py-0.5 text-[11px] transition ${cor} ${marcada ? "" : "line-through opacity-40"}`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-2">
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-ink-500">Como vai chegar no Agendador</p>
          <p className="text-[10px] text-ink-500">
            <span className={post.caracteres > AGENDADOR_LIMITES.caracteres ? "text-red-300" : ""}>
              {post.caracteres}/{AGENDADOR_LIMITES.caracteres} caracteres
            </span>{" "}
            ·{" "}
            <span className={post.totalHashtags > AGENDADOR_LIMITES.hashtags ? "text-red-300" : ""}>
              {post.totalHashtags}/{AGENDADOR_LIMITES.hashtags} hashtags
            </span>
          </p>
        </div>
        {post.textoFinal ? (
          <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-ink-800 bg-ink-950/60 p-2 text-[11px] text-ink-300">
            {post.textoFinal}
          </p>
        ) : (
          <p className="mt-1 text-[11px] text-ink-500">Nada marcado.</p>
        )}
        <p className="mt-1 text-[10px] text-ink-500">
          As hashtags fixas configuradas no Agendador entram lá, depois destas. O post chega como rascunho, no próximo
          horário livre da sua grade.
        </p>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void enviar()}
          disabled={!pronta || bloqueio !== null || enviando !== null}
          className="rounded-md bg-indigo-500 px-3 py-1 text-xs font-medium text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {enviando ?? (item.agendador ? "✈ Enviar de novo" : "✈ Enviar para o Agendador")}
        </button>
        {pronta && (
          <button
            type="button"
            onClick={() => void pedirAExtensao("abrir-painel")}
            className="rounded-md border border-indigo-500/40 px-2 py-1 text-[11px] text-indigo-200 transition hover:bg-indigo-500/10"
          >
            Abrir o painel do Agendador
          </button>
        )}
      </div>

      {bloqueio && !enviando && extensao.tipo !== "procurando" && (
        <p className="mt-1.5 text-[11px] text-amber-200">{bloqueio}</p>
      )}
      {aviso && (
        <p
          className={`mt-1.5 text-[11px] ${
            aviso.kind === "ok" ? "text-emerald-300" : aviso.kind === "atencao" ? "text-amber-200" : "text-red-300"
          }`}
        >
          {aviso.text}
        </p>
      )}
    </div>
  );
}
