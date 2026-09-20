"use client";

import { useCallback, useEffect, useState } from "react";
import type { PostComment } from "@/lib/repo";
import CopyButton from "./CopyButton";

/**
 * Comentários do post de origem.
 *
 * A aplicação não coleta comentário nenhum: ela recebe o que a extensão envia
 * (ver HANDOFF, §10). O botão daqui só abre o post com um marcador na URL —
 * é esse marcador que autoriza a extensão a capturar sozinha, para ela não
 * disparar toda vez que o usuário abre um Reel por lazer.
 *
 * O texto é de terceiros: renderizado como texto puro, nunca como HTML.
 */

/** A extensão só captura automaticamente quando vê este marcador. */
export const MARCADOR_CAPTURA = "shortcta";

interface KitPublicacao {
  description: string;
  hashtags: string[];
  sendTrigger: string | null;
  titleStrategy: string | null;
  audienceRead: string | null;
}

interface CtaDeComentarios {
  audienceRead: string;
  recommendedIndex: number;
  suggestions: { text: string; style: string; signal: string }[];
}

export function urlDeCaptura(postUrl: string): string | null {
  try {
    const url = new URL(postUrl);
    url.searchParams.set(MARCADOR_CAPTURA, "1");
    return url.toString();
  } catch {
    return null;
  }
}

export default function CommentsPanel({
  videoId,
  postUrl,
  compact = false,
}: {
  videoId: string;
  postUrl: string | null;
  /** No painel lateral o espaço é estreito: some o botão (já existe acima). */
  compact?: boolean;
}) {
  const [comments, setComments] = useState<PostComment[] | null>(null);
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [gerando, setGerando] = useState(false);
  const [ctas, setCtas] = useState<CtaDeComentarios | null>(null);
  const [erroCta, setErroCta] = useState<string | null>(null);
  const [kit, setKit] = useState<KitPublicacao | null>(null);
  const [gerandoKit, setGerandoKit] = useState(false);
  const [erroKit, setErroKit] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch(`/api/videos/${videoId}/comments`);
      if (!res.ok) throw new Error("Falha ao carregar comentários.");
      const d = (await res.json()) as { comments: PostComment[]; capturedAt: string | null };
      setComments(d.comments);
      setCapturedAt(d.capturedAt);
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [videoId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // O usuário captura numa outra aba e volta para esta. Recarregar ao voltar o
  // foco evita que ele precise atualizar a página na mão para ver o resultado.
  useEffect(() => {
    const aoVoltar = () => void carregar();
    window.addEventListener("focus", aoVoltar);
    return () => window.removeEventListener("focus", aoVoltar);
  }, [carregar]);

  async function gerar() {
    setGerando(true);
    setErroCta(null);
    try {
      const res = await fetch(`/api/videos/${videoId}/cta-from-comments`, { method: "POST" });
      const d = (await res.json().catch(() => ({}))) as CtaDeComentarios & { error?: string };
      if (!res.ok) {
        setErroCta(d.error ?? "Falha ao gerar.");
        return;
      }
      setCtas(d);
    } catch (e) {
      setErroCta((e as Error).message);
    } finally {
      setGerando(false);
    }
  }

  async function gerarKit() {
    setGerandoKit(true);
    setErroKit(null);
    try {
      const res = await fetch(`/api/videos/${videoId}/publish-kit`, { method: "POST" });
      const d = (await res.json().catch(() => ({}))) as { kit?: KitPublicacao; error?: string };
      if (!res.ok || !d.kit) {
        setErroKit(d.error ?? "Falha ao gerar a legenda.");
        return;
      }
      setKit(d.kit);
    } catch (e) {
      setErroKit((e as Error).message);
    } finally {
      setGerandoKit(false);
    }
  }

  const linkCaptura = postUrl ? urlDeCaptura(postUrl) : null;
  const total = comments?.length ?? 0;

  return (
    <section className="card space-y-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">
          Comentários do post{total > 0 ? ` (${total})` : ""}
        </h2>
        <div className="flex items-center gap-3">
          {capturedAt && (
            <span className="hint text-[10px]">
              capturado em {new Date(capturedAt).toLocaleString("pt-BR")}
            </span>
          )}
          {comments !== null && (
            <button type="button" className="hint text-[10px] hover:underline" onClick={() => void carregar()}>
              Atualizar
            </button>
          )}
        </div>
      </div>

      {!compact &&
        (linkCaptura ? (
          <a
            href={linkCaptura}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded border border-ink-700 px-3 py-1.5 text-xs hover:border-accent hover:text-accent"
          >
            Abrir post e capturar comentários ↗
          </a>
        ) : (
          <p className="hint text-[11px]">
            Sem link do post: não dá para capturar comentários deste vídeo.
          </p>
        ))}

      {erro && <p className="hint text-amber-400">{erro}</p>}

      {comments !== null && comments.length === 0 && (
        <p className="hint text-[11px]">
          {compact
            ? "Nenhum comentário capturado ainda."
            : "Nenhum comentário capturado ainda. Abra o post no botão acima e deixe a extensão enviar — o app precisa estar rodando neste momento."}
        </p>
      )}

      {comments !== null && comments.length > 0 && (
        <div className="space-y-2 border-t border-white/10 pt-3">
          <button
            type="button"
            className="btn-quiet px-2 py-1 text-[11px]"
            disabled={gerando}
            onClick={() => void gerar()}
          >
            {gerando ? "Analisando os comentários…" : "Gerar CTA a partir dos comentários"}
          </button>

          {erroCta && <p className="hint text-amber-400 text-[11px]">{erroCta}</p>}

          {ctas && (
            <div className="space-y-2">
              <p className="hint text-[10px] italic">{ctas.audienceRead}</p>
              <ul className="space-y-2">
                {ctas.suggestions.map((sg, i) => (
                  <li
                    key={sg.text}
                    className={
                      "rounded border p-2 " +
                      (i === ctas.recommendedIndex ? "border-accent/50 bg-accent/5" : "border-ink-700")
                    }
                  >
                    <div className="flex items-start gap-2">
                      <p className="flex-1 text-[12px] leading-snug">{sg.text}</p>
                      <CopyButton text={sg.text} compact />
                    </div>
                    {/* O sinal é o que separa um gancho apoiado em evidência de
                        um gancho inventado com os comentários de pano de fundo. */}
                    <p className="hint mt-1 text-[10px]">Apoia-se em: {sg.signal}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="space-y-2 border-t border-white/10 pt-3">
        <button
          type="button"
          className="btn-quiet px-2 py-1 text-[11px]"
          disabled={gerandoKit}
          onClick={() => void gerarKit()}
        >
          {gerandoKit ? "Escrevendo…" : "Gerar legenda e hashtags"}
        </button>

        {erroKit && <p className="hint text-amber-400 text-[11px]">{erroKit}</p>}

        {kit && (
          <div className="space-y-2 rounded border border-ink-700 p-2">
            <div className="flex items-start gap-2">
              <p className="flex-1 whitespace-pre-wrap text-[12px] leading-snug">{kit.description}</p>
              <CopyButton text={kit.description} compact />
            </div>

            <div className="flex items-start gap-2">
              <p className="flex-1 text-[11px] text-accent">{kit.hashtags.join(" ")}</p>
              <CopyButton text={kit.hashtags.join(" ")} compact />
            </div>

            <div className="flex items-start gap-2 border-t border-white/10 pt-2">
              <p className="flex-1 text-[10px]">Legenda + hashtags juntas</p>
              <CopyButton text={`${kit.description}\n\n${kit.hashtags.join(" ")}`} compact />
            </div>

            {/* Envio em DM pesa de 3 a 5x a curtida: é o trecho que mais
                importa na legenda, então fica visível e nomeado. */}
            {kit.sendTrigger && <p className="hint text-[10px]">Gatilho de envio: {kit.sendTrigger}</p>}
            {kit.titleStrategy && <p className="hint text-[10px]">Sobre o título: {kit.titleStrategy}</p>}
            {kit.audienceRead && <p className="hint text-[10px] italic">{kit.audienceRead}</p>}
          </div>
        )}
      </div>

      {comments !== null && comments.length > 0 && <Lista comments={comments} />}
    </section>
  );
}

function Lista({ comments }: { comments: PostComment[] }) {
  const porId = new Map(comments.filter((c) => c.externalId).map((c) => [c.externalId as string, c]));
  // Uma resposta cujo pai não veio na captura aparece no nível de cima, em vez
  // de sumir da tela.
  const raiz = comments.filter((c) => !c.parentExternalId || !porId.has(c.parentExternalId));
  const respostasDe = (externalId: string | null) =>
    externalId ? comments.filter((c) => c.parentExternalId === externalId) : [];

  return (
    <ul className="space-y-3">
      {raiz.map((c) => (
        <li key={c.id} className="space-y-2">
          <Comentario c={c} />
          {respostasDe(c.externalId).length > 0 && (
            <ul className="ml-4 space-y-2 border-l border-white/10 pl-3">
              {respostasDe(c.externalId).map((r) => (
                <li key={r.id}>
                  <Comentario c={r} />
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

function Comentario({ c }: { c: PostComment }) {
  return (
    <div className="text-sm">
      <div className="flex items-baseline gap-2">
        <span className="font-medium text-ink-100">{c.author ?? "sem autor"}</span>
        {c.publishedLabel && <span className="hint text-[10px]">{c.publishedLabel}</span>}
        {typeof c.likeCount === "number" && c.likeCount > 0 && (
          <span className="hint text-[10px]">
            {c.likeCount} curtida{c.likeCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <p className="whitespace-pre-wrap break-words text-ink-200">{c.text}</p>
    </div>
  );
}
