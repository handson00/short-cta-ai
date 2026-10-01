/**
 * As hashtags recomendadas do vídeo, escolhidas SEM IA entre as que a extensão
 * capturou.
 *
 * Pedido do usuário (2026-09-29): só as capturadas, as duas mais relevantes —
 * no lugar da chamada paga que inventava hashtags novas.
 *
 * O limite a saber: a extensão não mede visualização POR HASHTAG (o TikTok não
 * informa isso). O sinal mais próximo de "a que deu visualização" é a hashtag
 * estar no post original, que é o vídeo que teve as visualizações. Os outros
 * sinais são quantas vezes o público a usou nos comentários e se ela fala do
 * que o CTA e a fala do vídeo falam. Cada escolha sai com o motivo.
 */

export const RECOMMENDED_HASHTAGS = 2;

/**
 * Hashtag de volume: não classifica o vídeo, só o mistura com qualquer
 * assunto. A plataforma usa hashtag para classificar, não para distribuir.
 */
export const GENERICAS = new Set([
  "fyp", "fy", "foryou", "foryoupage", "fypage", "viral", "virais", "viralvideo", "explore", "explorar",
  "parati", "paravoce", "pravoce", "tiktok", "tiktokbrasil", "reels", "instagram", "trend", "trending",
  "capcut", "xyzbca", "foryourpage", "fyyyyy",
]);

export interface CapturedHashtags {
  doVideo: string[];
  nosComentarios: Array<{ tag: string; vezes: number }>;
}

export interface HashtagContext {
  /** O CTA que o vídeo vai usar (editado → escolhido → recomendado). */
  cta: string | null;
  plot: string | null;
  transcript: string | null;
}

export interface RankedHashtag {
  tag: string;
  score: number;
  reasons: string[];
}

/** "#MáquinaDoTempo" → "maquinadotempo". */
export function normalizeTag(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^#+/, "")
    .replace(/[^a-z0-9_]/g, "");
}

/** Texto sem acento, espaço nem pontuação: "MÁQUINA DO TEMPO" → "maquinadotempo". */
function squash(text: string | null): string {
  return (text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Menos que isto, "contém" vira coincidência: "ele" está em quase toda frase. */
const MIN_MATCH_LENGTH = 4;

export function rankHashtags(
  captured: CapturedHashtags | null,
  context: HashtagContext,
  limit = RECOMMENDED_HASHTAGS,
): RankedHashtag[] {
  if (!captured) return [];

  const cta = squash(context.cta);
  const story = squash(`${context.plot ?? ""} ${context.transcript ?? ""}`);
  const byTag = new Map<string, RankedHashtag & { order: number }>();

  const get = (raw: string, order: number) => {
    const tag = normalizeTag(raw);
    if (tag.length < 2 || GENERICAS.has(tag)) return null;
    let item = byTag.get(tag);
    if (!item) {
      item = { tag, score: 0, reasons: [], order };
      byTag.set(tag, item);
    }
    return item;
  };

  captured.doVideo.forEach((raw, i) => {
    const item = get(raw, i);
    if (!item || item.reasons.includes("usada no post original")) return;
    item.score += 3;
    item.reasons.push("usada no post original");
  });

  captured.nosComentarios.forEach((h, i) => {
    const item = get(h.tag, 1000 + i);
    if (!item || h.vezes <= 0) return;
    // Teto em 5: um vídeo com a mesma hashtag repetida 80 vezes nos comentários
    // não pode passar por cima de toda a relação com o conteúdo.
    item.score += Math.min(5, h.vezes);
    item.reasons.push(`citada ${h.vezes}x nos comentários`);
  });

  for (const item of byTag.values()) {
    if (item.tag.length < MIN_MATCH_LENGTH) continue;
    if (cta.includes(item.tag)) {
      item.score += 5;
      item.reasons.push("fala do mesmo que o CTA");
    } else if (story.includes(item.tag)) {
      item.score += 3;
      item.reasons.push("aparece na fala do vídeo");
    }
  }

  return [...byTag.values()]
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map(({ tag, score, reasons }) => ({ tag: `#${tag}`, score, reasons }));
}
