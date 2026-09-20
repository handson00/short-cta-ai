import type { PostComment } from "../repo";

/**
 * Leitura dos comentarios ANTES de falar com o modelo.
 *
 * A tentacao seria despejar os 200 comentarios no prompt e pedir um gancho. Isso
 * gasta contexto, dilui o sinal no meio de "kkkk" e emoji, e deixa o modelo
 * escolher sozinho o que e relevante - justamente a parte que da para decidir
 * com regra, de forma repetivel e auditavel.
 *
 * O que interessa num comentario nao e o comentario: e o PADRAO. Quarenta
 * pessoas perguntando o nome do filme nao sao quarenta comentarios, sao uma
 * demanda comprovada - e um gancho que promete aquela resposta parte de algo
 * que o publico ja demonstrou querer, em vez de um palpite sobre a cena.
 *
 * Por isso a saida daqui e um resumo de sinais, com contagem. O modelo recebe
 * evidencia quantificada, nao um monte de texto solto.
 */

export interface SinalPergunta {
  texto: string;
  vezes: number;
}

export interface SinalComentario {
  texto: string;
  autor: string | null;
  curtidas: number | null;
  respostas: number;
}

export interface CommentInsights {
  total: number;
  totalRespostas: number;
  /** "que filme e esse?" e variantes - o pedido mais valioso que existe aqui. */
  pedidosDeNome: number;
  perguntasRecorrentes: SinalPergunta[];
  maisCurtidos: SinalComentario[];
  maisRespondidos: SinalComentario[];
  confusao: string[];
  /** Falso quando nao ha nada aproveitavel: melhor dizer isso que inventar. */
  temSinal: boolean;
  motivoSemSinal: string | null;
}

const RE_PEDIDO_NOME =
  /(que|qual)\s+(filme|serie|novela|anime|doramas?|dorama)\s*(e|eh)?\s*(esse|essa|isso)|nome\s+d[oa]\s+(filme|serie|novela|anime)|qual\s+(o\s+)?nome/i;

const RE_CONFUSAO = /(nao|n[aã]o)\s+entendi|alguem\s+explica|algu[ée]m\s+explica|como\s+assim|n[aã]o\s+faz\s+sentido|fiquei\s+perdid/i;

const RE_PERGUNTA = /\?\s*$|^(que|qual|quem|onde|quando|por\s*que|porque|como)\b/i;

/** Só letras e dígitos, sem acento: agrupa "Que filme é esse??" com "que filme e esse". */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ehSubstancial(texto: string): boolean {
  // Um comentário só de riso ou emoji não sustenta gancho nenhum.
  const limpo = normalizar(texto);
  if (limpo.length < 8) return false;
  if (/^(k+|ha+|rs+|haha+)(\s+(k+|ha+|rs+))*$/.test(limpo)) return false;
  return limpo.split(" ").filter((p) => p.length > 2).length >= 2;
}

export function extrairSinais(comments: PostComment[]): CommentInsights {
  const porId = new Map(comments.filter((c) => c.externalId).map((c) => [c.externalId as string, c]));
  const raiz = comments.filter((c) => !c.parentExternalId || !porId.has(c.parentExternalId));
  const totalRespostas = comments.length - raiz.length;

  const respostasPorPai = new Map<string, number>();
  for (const c of comments) {
    if (!c.parentExternalId) continue;
    respostasPorPai.set(c.parentExternalId, (respostasPorPai.get(c.parentExternalId) ?? 0) + 1);
  }
  const nRespostas = (c: PostComment) => (c.externalId ? respostasPorPai.get(c.externalId) ?? 0 : 0);

  let pedidosDeNome = 0;
  const confusao: string[] = [];
  const grupos = new Map<string, { texto: string; vezes: number }>();

  for (const c of comments) {
    const t = c.text.trim();
    if (RE_PEDIDO_NOME.test(t)) pedidosDeNome += 1;
    if (RE_CONFUSAO.test(t) && confusao.length < 5) confusao.push(t.slice(0, 200));

    if (!RE_PERGUNTA.test(t) || !ehSubstancial(t)) continue;
    const chave = normalizar(t).split(" ").slice(0, 6).join(" ");
    const g = grupos.get(chave);
    if (g) g.vezes += 1;
    else grupos.set(chave, { texto: t.slice(0, 200), vezes: 1 });
  }

  const perguntasRecorrentes = [...grupos.values()]
    .filter((g) => g.vezes >= 2)
    .sort((a, b) => b.vezes - a.vezes)
    .slice(0, 5);

  const resumir = (c: PostComment): SinalComentario => ({
    texto: c.text.slice(0, 220),
    autor: c.author,
    curtidas: c.likeCount,
    respostas: nRespostas(c),
  });

  const maisCurtidos = comments
    .filter((c) => ehSubstancial(c.text) && (c.likeCount ?? 0) > 0)
    .sort((a, b) => (b.likeCount ?? 0) - (a.likeCount ?? 0))
    .slice(0, 5)
    .map(resumir);

  const maisRespondidos = raiz
    .filter((c) => nRespostas(c) >= 2 && ehSubstancial(c.text))
    .sort((a, b) => nRespostas(b) - nRespostas(a))
    .slice(0, 3)
    .map(resumir);

  // O teste de sinal existe para a ferramenta poder dizer "não dá" em vez de
  // devolver um gancho bonito apoiado em nada.
  const temSinal =
    pedidosDeNome >= 2 ||
    perguntasRecorrentes.length > 0 ||
    maisCurtidos.length > 0 ||
    maisRespondidos.length > 0 ||
    confusao.length >= 2;

  const motivoSemSinal = temSinal
    ? null
    : comments.length === 0
      ? "Nenhum comentário capturado para este vídeo."
      : "Os comentários capturados não trazem pergunta recorrente, debate nem comentário em destaque — só reações curtas.";

  return {
    total: comments.length,
    totalRespostas,
    pedidosDeNome,
    perguntasRecorrentes,
    maisCurtidos,
    maisRespondidos,
    confusao,
    temSinal,
    motivoSemSinal,
  };
}
