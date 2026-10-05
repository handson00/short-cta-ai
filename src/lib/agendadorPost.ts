/**
 * O post que vai para a extensão "Agendador IG": o que o usuário marcou na
 * página de Exportações, montado do jeito que a extensão monta.
 *
 * Puro (sem banco, sem Node): o painel usa para a prévia e o servidor usa para
 * gerar o que é enviado. Uma implementação só — duas divergiriam, e a prévia
 * mostraria um texto diferente do que chega ao Instagram.
 *
 * As regras vêm do painel compilado da extensão (0.4.0): `Ns` junta legenda e
 * hashtags, `Dn` valida cada hashtag, `Lo` impõe 2200 caracteres e 30 hashtags.
 * Se a extensão mudar essas regras, mude aqui também.
 */

/** Limites do Instagram, como o painel da extensão confere. */
export const AGENDADOR_LIMITES = { caracteres: 2200, hashtags: 30 } as const;

/** Os textos que podem entrar na legenda, na ordem em que entram. */
export const BLOCOS = ["cta", "pt", "ja", "kit"] as const;
export type Bloco = (typeof BLOCOS)[number];

export const ROTULO_BLOCO: Record<Bloco, string> = {
  cta: "Texto do vídeo (CTA)",
  pt: "Legenda (português)",
  ja: "Legenda (japonês)",
  kit: "Legenda do kit",
};

export interface FontesDoPost {
  cta: string | null;
  ptCaption: string | null;
  jpCaption: string | null;
  /** Legenda do kit de publicação. */
  description: string | null;
}

export interface Selecao {
  blocos: Bloco[];
  hashtags: string[];
}

export interface PostMontado {
  /** Vai no campo "legenda" da extensão. */
  caption: string;
  /** Vai no campo "hashtags" da extensão, separadas por espaço. */
  hashtags: string;
  /** O texto final, como a extensão vai colar no Instagram. */
  textoFinal: string;
  caracteres: number;
  totalHashtags: number;
  /** Motivos para não enviar. Vazio = pode enviar. */
  problemas: string[];
}

/** As hashtags de um vídeo, como a página de Exportações agrupa. */
export interface HashtagsDoVideo {
  /** Capturadas do post de origem e recomendadas pelo ranking. */
  hashtags: string[];
  /** As do kit de publicação: entram só quando não há capturadas. */
  kitHashtags: string[];
  aiHashtags: Array<{ tag: string }>;
  aiHashtagsJa: Array<{ tag: string }>;
}

/** As hashtags que a página oferece para o post, na ordem em que aparecem na tela. */
export function hashtagsOferecidas(v: HashtagsDoVideo): string[] {
  const base = v.hashtags.length > 0 ? v.hashtags : v.kitHashtags;
  return [...base, ...v.aiHashtags.map((h) => h.tag), ...v.aiHashtagsJa.map((h) => h.tag)];
}

/** Hashtag aceita pela extensão: letras, números, marcas e `_`. Sem hífen ou espaço. */
const HASHTAG_VALIDA = /^#[\p{L}\p{M}\p{N}_]+$/u;
const HASHTAGS_NO_TEXTO = /#[\p{L}\p{M}\p{N}_]+/gu;

function textoDoBloco(fontes: FontesDoPost, bloco: Bloco): string | null {
  const v = { cta: fontes.cta, pt: fontes.ptCaption, ja: fontes.jpCaption, kit: fontes.description }[bloco];
  return v?.trim() ? v.trim() : null;
}

/** Blocos com texto: só esses aparecem para marcar. */
export function blocosDisponiveis(fontes: FontesDoPost): Bloco[] {
  return BLOCOS.filter((b) => textoDoBloco(fontes, b) !== null);
}

/** O que vem marcado ao abrir: a legenda principal, senão a do kit. */
export function selecaoPadrao(fontes: FontesDoPost, hashtags: string[]): Selecao {
  const disp = blocosDisponiveis(fontes);
  const blocos: Bloco[] = disp.includes("pt") ? ["pt"] : disp.includes("kit") ? ["kit"] : [];
  return { blocos, hashtags: [...hashtags] };
}

/** Conta como o painel da extensão: por grafema, não por unidade de UTF-16 (emoji conta 1). */
export function contarCaracteres(texto: string): number {
  // `Intl.Segmenter` existe no Node 24 e no Chrome, mas não nas definições de
  // tipo que o projeto carrega (lib ES2020).
  const Segmenter = (Intl as unknown as {
    Segmenter?: new (locale: string, opts: { granularity: "grapheme" }) => { segment(t: string): Iterable<unknown> };
  }).Segmenter;
  if (!Segmenter) return [...texto].length;
  let n = 0;
  for (const _ of new Segmenter("pt-BR", { granularity: "grapheme" }).segment(texto)) n++;
  return n;
}

const chave = (tag: string) => tag.toLocaleLowerCase("pt-BR");

export function montarPost(fontes: FontesDoPost, sel: Selecao): PostMontado {
  const problemas: string[] = [];

  // Na ordem fixa de BLOCOS, não na ordem dos cliques: o CTA abre a legenda.
  const caption = BLOCOS.filter((b) => sel.blocos.includes(b))
    .map((b) => textoDoBloco(fontes, b))
    .filter((t): t is string => t !== null)
    .join("\n\n");

  const vistas = new Set<string>();
  const hashtags: string[] = [];
  for (const bruta of sel.hashtags) {
    const tag = "#" + bruta.trim().replace(/^#+/, "");
    if (tag === "#") continue;
    if (!HASHTAG_VALIDA.test(tag)) {
      problemas.push(`Hashtag inválida para o Instagram: ${bruta} (só letras, números e _).`);
      continue;
    }
    if (vistas.has(chave(tag))) continue;
    vistas.add(chave(tag));
    hashtags.push(tag);
  }

  // A extensão não repete a hashtag que já está na legenda (a japonesa abre
  // com uma). Fazer igual aqui é o que mantém a prévia fiel.
  const naLegenda = new Set((caption.match(HASHTAGS_NO_TEXTO) ?? []).map(chave));
  const extras = hashtags.filter((t) => !naLegenda.has(chave(t)));
  const corpo = caption.replace(/\s+$/u, "");
  const textoFinal = extras.length === 0 ? corpo : corpo ? `${corpo}\n\n${extras.join(" ")}` : extras.join(" ");

  const caracteres = contarCaracteres(textoFinal);
  const totalHashtags = (textoFinal.match(HASHTAGS_NO_TEXTO) ?? []).length;

  if (!textoFinal.trim()) problemas.push("Marque ao menos uma legenda ou uma hashtag.");
  if (caracteres > AGENDADOR_LIMITES.caracteres) {
    problemas.push(`O texto tem ${caracteres} caracteres; o Instagram aceita ${AGENDADOR_LIMITES.caracteres}.`);
  }
  if (totalHashtags > AGENDADOR_LIMITES.hashtags) {
    problemas.push(`São ${totalHashtags} hashtags; o Instagram aceita ${AGENDADOR_LIMITES.hashtags}.`);
  }

  return { caption, hashtags: hashtags.join(" "), textoFinal, caracteres, totalHashtags, problemas };
}
