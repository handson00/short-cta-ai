/**
 * Os CTAs gerados para um vídeo, para trocar o texto no editor com um clique.
 *
 * Funções puras, seguras no cliente (não tocam o banco): o painel de template
 * e a aba Preview usam a mesma regra para "qual é o próximo" e "de que estilo
 * é o texto atual".
 */

export interface CtaOption {
  text: string;
  /** curiosidade | suspense | ... — ou, nos gerados pelos comentários, resolveDuvida | fomo | ... */
  style: string;
  /** generated | original | comments | manual */
  origin: string;
  recommended: boolean;
}

const STYLE_LABEL: Record<string, string> = {
  curiosidade: "Curiosidade",
  suspense: "Suspense",
  conflito: "Conflito",
  reviravolta: "Reviravolta",
  emocional: "Emocional",
  ultracurto: "Ultracurto",
  // Estratégias do CTA otimizado por comentários.
  resolveDuvida: "Resolve dúvida",
  fomo: "FOMO",
  debate: "Debate",
};

const ORIGIN_LABEL: Record<string, string> = {
  original: "já estava no vídeo",
  comments: "dos comentários",
  manual: "manual",
};

export function ctaStyleLabel(style: string): string {
  return STYLE_LABEL[style] ?? (style ? style.charAt(0).toUpperCase() + style.slice(1) : "Sem estilo");
}

/** O que acompanha o estilo na etiqueta: recomendado, de onde veio. */
export function ctaOriginNote(option: CtaOption): string | null {
  const parts: string[] = [];
  if (option.recommended) parts.push("recomendado");
  const origin = ORIGIN_LABEL[option.origin];
  if (origin) parts.push(origin);
  return parts.length ? parts.join(" · ") : null;
}

/** Compara como o usuário vê: espaços extras não fazem dois textos diferentes. */
function same(a: string, b: string): boolean {
  return a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();
}

/** Posição do texto atual entre os CTAs; -1 = texto próprio (ou vazio). */
export function currentCtaIndex(options: CtaOption[], text: string): number {
  if (!text.trim()) return -1;
  return options.findIndex((o) => same(o.text, text));
}

/**
 * O CTA seguinte (ou anterior) ao texto atual, dando a volta na lista. Texto
 * próprio não está na lista: o primeiro clique leva ao primeiro CTA.
 */
export function stepCta(options: CtaOption[], text: string, direction: 1 | -1 = 1): CtaOption | null {
  if (options.length === 0) return null;
  const i = currentCtaIndex(options, text);
  if (i === -1) return direction === 1 ? options[0] : options[options.length - 1];
  return options[(i + direction + options.length) % options.length];
}
