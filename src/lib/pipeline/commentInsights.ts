import type { PostComment } from "../repo";

/**
 * Análise estratégica de comentários ANTES de gerar CTA.
 *
 * A tentacao seria despejar os 200 comentarios no prompt e pedir um gancho. Isso
 * gasta contexto, dilui o sinal no meio de "kkkk" e emoji, e deixa o modelo
 * escolher sozinho o que e relevante - justamente a parte que da para decidir
 * com regra, de forma repetivel e auditavel.
 *
 * O que interessa num comentario nao e o comentario: e o PADRAO e a ESTRATEGIA.
 * Quarenta pessoas perguntando o nome do filme nao sao quarenta comentarios, sao
 * uma demanda comprovada. Trinta pessoas confusas sobre um detalhe indicam que
 * o CTA deve resolver aquela dúvida específica. Cem pessoas querendo mais contexto
 * sugerem uma estratégia de "deixa pra depois" (FOMO).
 *
 * A saída é um resumo de sinais quantificados + estratégias de CTA sugeridas.
 * O modelo recebe evidência estruturada, não texto solto.
 */

export interface SinalPergunta {
  texto: string;
  vezes: number;
  /** Qual estratégia de CTA este sinal sugere (curiosidade, suspense, FOMO, etc) */
  estrategia?: string;
}

export interface SinalComentario {
  texto: string;
  autor: string | null;
  curtidas: number | null;
  respostas: number;
}

export interface EstrategiasCTA {
  /** Pedido "que filme é esse?" - resolver a dúvida de identidade */
  resolveDuvida: {
    ativo: boolean;
    frequencia: number;
    tema: string; // "qual o nome", "qual ator", "qual série", etc
  };
  /** Muita confusão sobre a trama - criar suspense/curiosidade */
  suspense: {
    ativo: boolean;
    confusaoCount: number;
    temasConfusao: string[];
  };
  /** Muito debate/resposta - criar FOMO (medo de perder a discussão) */
  fomo: {
    ativo: boolean;
    debatesAtivos: number;
    perguntasEmDebate: number;
  };
  /** Alto engajamento em geral - criar curiosidade pura */
  curiosidade: {
    ativo: boolean;
    curtidosAltos: number;
    mediaLikes: number;
  };
  /** Cena polêmica/controversa - criar debate */
  debate: {
    ativo: boolean;
    opinioesDivergentes: number;
  };
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
  /** Estratégias de CTA recomendadas para este conjunto de comentários */
  estrategias: EstrategiasCTA;
  /** Falso quando nao ha nada aproveitavel: melhor dizer isso que inventar. */
  temSinal: boolean;
  motivoSemSinal: string | null;
  /** Qual é a PRINCIPAL estratégia a usar (a mais forte) */
  estrategiaPrincipal: string | null;
}

const RE_PEDIDO_NOME =
  /(que|qual)\s+(filme|serie|novela|anime|doramas?|dorama|ator|atriz)\s*(e|eh)?\s*(esse|essa|isso)|nome\s+d[oa]\s+(filme|serie|novela|anime)|qual\s+(o\s+)?nome|qual\s+e\s+o\s+ator/i;

const RE_CONFUSAO = /(nao|n[aã]o)\s+entendi|alguem\s+explica|algu[ée]m\s+explica|como\s+assim|n[aã]o\s+faz\s+sentido|fiquei\s+perdid|muito\s+confus|que\s+confus|por\s+que\s+ele|entao\s+o\s+final/i;

const RE_PERGUNTA = /\?\s*$|^(que|qual|quem|onde|quando|por\s*que|porque|como)\b/i;

const RE_OPINIAO_FORTE = /(pior|melhor|ador[ei]|odiador|nao\s+gost|amei|odiei|decepcion|surpreend|n[aã]o\s+acredit)\b/i;

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
  let opinioesDivergentes = 0;
  const confusao: string[] = [];
  const grupos = new Map<string, { texto: string; vezes: number }>();

  for (const c of comments) {
    const t = c.text.trim();
    if (RE_PEDIDO_NOME.test(t)) pedidosDeNome += 1;
    if (RE_CONFUSAO.test(t) && confusao.length < 5) confusao.push(t.slice(0, 200));
    if (RE_OPINIAO_FORTE.test(t)) opinioesDivergentes += 1;

    if (!RE_PERGUNTA.test(t) || !ehSubstancial(t)) continue;
    const chave = normalizar(t).split(" ").slice(0, 6).join(" ");
    const g = grupos.get(chave);
    if (g) g.vezes += 1;
    else grupos.set(chave, { texto: t.slice(0, 200), vezes: 1 });
  }

  const perguntasRecorrentes = [...grupos.values()]
    .filter((g) => g.vezes >= 2)
    .sort((a, b) => b.vezes - a.vezes)
    .slice(0, 5)
    .map((g) => ({
      ...g,
      estrategia: g.texto.toLowerCase().includes("qual o nome") || g.texto.toLowerCase().includes("que filme")
        ? "resolveDuvida"
        : "curiosidade",
    }));

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

  // Calcular estratégias baseadas nos padrões detectados
  const mediaLikes = maisCurtidos.length > 0
    ? maisCurtidos.reduce((s, c) => s + (c.curtidas ?? 0), 0) / maisCurtidos.length
    : 0;

  const estrategias: EstrategiasCTA = {
    resolveDuvida: {
      ativo: pedidosDeNome >= 2,
      frequencia: pedidosDeNome,
      tema: pedidosDeNome >= 2
        ? "qual o nome do filme/série/ator"
        : "",
    },
    suspense: {
      ativo: confusao.length >= 2,
      confusaoCount: confusao.length,
      temasConfusao: confusao.slice(0, 3),
    },
    fomo: {
      ativo: totalRespostas >= 8 && maisRespondidos.length >= 2,
      debatesAtivos: maisRespondidos.length,
      perguntasEmDebate: totalRespostas,
    },
    curiosidade: {
      ativo: maisCurtidos.length >= 3,
      curtidosAltos: maisCurtidos.filter((c) => (c.curtidas ?? 0) > 50).length,
      mediaLikes: Math.round(mediaLikes),
    },
    debate: {
      ativo: opinioesDivergentes >= 5,
      opinioesDivergentes,
    },
  };

  // Qual é a estratégia mais forte?
  let estrategiaPrincipal: string | null = null;
  if (estrategias.resolveDuvida.ativo && pedidosDeNome >= 5) {
    estrategiaPrincipal = "resolveDuvida"; // Muita gente quer saber o nome
  } else if (estrategias.fomo.ativo && totalRespostas >= 15) {
    estrategiaPrincipal = "fomo"; // Muito debate em andamento
  } else if (estrategias.suspense.ativo && confusao.length >= 3) {
    estrategiaPrincipal = "suspense"; // Muita confusão sobre a trama
  } else if (estrategias.debate.ativo) {
    estrategiaPrincipal = "debate"; // Muita opinião divergente
  } else if (estrategias.curiosidade.ativo && maisCurtidos.length >= 4) {
    estrategiaPrincipal = "curiosidade"; // Alto engajamento geral
  }

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
    estrategias,
    estrategiaPrincipal,
    temSinal,
    motivoSemSinal,
  };
}
