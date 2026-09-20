"use client";

import CopyButton from "@/components/CopyButton";
import type { PostComment } from "@/lib/repo";
import { useState } from "react";

interface CommentsPanelProps {
  videoId: string;
  comments: PostComment[] | null;
  capturedAt: Date | null;
  onCommentsCaptured?: () => void;
}


export const urlDeCaptura = "https://example.com/capture"; // URL padrão para captura de comentários

export default function CommentsPanel({ videoId, comments, capturedAt, onCommentsCaptured }: CommentsPanelProps) {
  const [gerando, setGerando] = useState(false);
  const [otimizando, setOtimizando] = useState(false);
  const [erroCta, setErroCta] = useState<string | null>(null);
  const [ctas, setCtas] = useState<{
    suggestions: Array<{
      text: string;
      style: string;
      signal: string;
    }>;
    recommendedIndex: number;
    audienceRead: string;
  } | null>(null);

  const [ctasOtimizadas, setCtasOtimizadas] = useState<{
    suggestions: Array<{
      text: string;
      style: string;
      signal: string;
      technique: string;
    }>;
    recommendedIndex: number;
    strategyExplained: string;
    insights: {
      estrategiaPrincipal: string | null;
      estrategias: {
        resolveDuvida: { ativo: boolean; frequencia: number };
        suspense: { ativo: boolean; confusaoCount: number };
        fomo: { ativo: boolean; debatesAtivos: number; perguntasEmDebate: number };
        curiosidade: { ativo: boolean; mediaLikes: number };
        debate: { ativo: boolean; opinioesDivergentes: number };
      };
      totalComentarios: number;
      totalRespostas: number;
    };
  } | null>(null);

  async function gerar() {
    setGerando(true);
    setErroCta(null);
    setCtas(null);
    try {
      const res = await fetch(`/api/videos/${videoId}/cta-from-comments`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao gerar CTAs");
      }
      const data = await res.json();
      setCtas(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      setErroCta(msg);
    } finally {
      setGerando(false);
    }
  }

  async function otimizar() {
    setOtimizando(true);
    setErroCta(null);
    setCtasOtimizadas(null);
    try {
      const res = await fetch(`/api/videos/${videoId}/cta-from-comments-optimized`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao otimizar CTAs");
      }
      const data = await res.json();
      setCtasOtimizadas(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      setErroCta(msg);
    } finally {
      setOtimizando(false);
    }
  }

  return (
    <div className="rounded-lg border border-ink-700/30 bg-ink-900/20 p-3">
      <h3 className="text-xs font-medium uppercase tracking-wide text-ink-300">Comentarios</h3>

      {comments === null && (
        <p className="mt-2 text-[11px] text-ink-400">
          {capturedAt
            ? "Nenhum comentário capturado ainda."
            : "Nenhum comentário capturado ainda. Abra o post no botão acima e deixe a extensão enviar — o app precisa estar rodando neste momento."}
        </p>
      )}

      {comments !== null && comments.length > 0 && (
        <div className="space-y-3 border-t border-white/10 pt-3">
          {/* Botões de ação */}
          <div className="flex flex-col gap-1">
            <button
              type="button"
              className="btn-quiet px-2 py-1 text-[11px]"
              disabled={gerando || otimizando}
              onClick={() => void gerar()}
            >
              {gerando ? "Analisando…" : "Gerar CTA a partir dos comentários"}
            </button>

            <button
              type="button"
              className="btn-quiet px-2 py-1 text-[11px]"
              disabled={gerando || otimizando}
              onClick={() => void otimizar()}
            >
              {otimizando ? "Otimizando estratégia…" : "Reanalisar CTAs (Otimizado)"}
            </button>
          </div>

          {erroCta && <p className="hint text-amber-400 text-[11px]">{erroCta}</p>}

          {/* CTAs Otimizados - PRINCIPAL */}
          {ctasOtimizadas && (
            <div className="space-y-2 rounded bg-accent/5 border border-accent/30 p-2">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[11px] font-semibold text-accent">CTAs Otimizados por Estratégia</p>
                  {ctasOtimizadas.insights.estrategiaPrincipal && (
                    <p className="text-[10px] text-ink-300 mt-0.5">
                      Estratégia principal: <span className="font-medium uppercase">{ctasOtimizadas.insights.estrategiaPrincipal}</span>
                    </p>
                  )}
                </div>
              </div>

              <p className="text-[10px] italic text-ink-400">{ctasOtimizadas.strategyExplained}</p>

              {/* Insights das estratégias */}
              <div className="grid grid-cols-2 gap-1 text-[9px] text-ink-400">
                {ctasOtimizadas.insights.estrategias.resolveDuvida.ativo && (
                  <div>Resolve dúvida: {ctasOtimizadas.insights.estrategias.resolveDuvida.frequencia}x</div>
                )}
                {ctasOtimizadas.insights.estrategias.suspense.ativo && (
                  <div>Suspense: {ctasOtimizadas.insights.estrategias.suspense.confusaoCount} confusões</div>
                )}
                {ctasOtimizadas.insights.estrategias.fomo.ativo && (
                  <div>FOMO: {ctasOtimizadas.insights.estrategias.fomo.perguntasEmDebate} em debate</div>
                )}
                {ctasOtimizadas.insights.estrategias.curiosidade.ativo && (
                  <div>Curiosidade: {ctasOtimizadas.insights.estrategias.curiosidade.mediaLikes} likes média</div>
                )}
                {ctasOtimizadas.insights.estrategias.debate.ativo && (
                  <div>Debate: {ctasOtimizadas.insights.estrategias.debate.opinioesDivergentes} opiniões</div>
                )}
              </div>

              {/* Sugestões de CTA */}
              <ul className="space-y-1.5 mt-2">
                {ctasOtimizadas.suggestions.map((sg, i) => (
                  <li
                    key={sg.text}
                    className={
                      "rounded border p-1.5 text-[11px] " +
                      (i === ctasOtimizadas.recommendedIndex
                        ? "border-accent/50 bg-accent/10"
                        : "border-ink-700 bg-ink-900/30")
                    }
                  >
                    <div className="flex items-start gap-1 mb-0.5">
                      <p className="flex-1 leading-tight font-medium">{sg.text}</p>
                      <CopyButton text={sg.text} compact />
                    </div>
                    <div className="flex flex-col gap-0.5 text-[9px] text-ink-400">
                      <p>Técnica: <span className="text-accent font-medium">{sg.technique}</span></p>
                      <p>Baseado em: {sg.signal}</p>
                    </div>
                    {i === ctasOtimizadas.recommendedIndex && (
                      <p className="text-[9px] text-accent mt-0.5 font-semibold">★ Recomendado</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* CTAs Básicos (não otimizados) */}
          {ctas && !ctasOtimizadas && (
            <div className="space-y-2">
              <p className="hint text-[10px] italic">{ctas.audienceRead}</p>
              <ul className="space-y-1.5">
                {ctas.suggestions.map((sg, i) => (
                  <li
                    key={sg.text}
                    className={
                      "rounded border p-1.5 text-[11px] " +
                      (i === ctas.recommendedIndex ? "border-accent/50 bg-accent/5" : "border-ink-700")
                    }
                  >
                    <div className="flex items-start gap-2">
                      <p className="flex-1 leading-snug">{sg.text}</p>
                      <CopyButton text={sg.text} compact />
                    </div>
                    <p className="hint mt-1 text-[9px]">Apoia-se em: {sg.signal}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Info de comentários */}
          {comments && (
            <p className="text-[9px] text-ink-400 border-t border-white/10 pt-1">
              {comments.length} comentário(s) capturado(s) {capturedAt && `em ${new Intl.DateTimeFormat("pt-BR").format(capturedAt)}`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
