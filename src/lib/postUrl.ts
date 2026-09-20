/**
 * Identifica o post a partir da URL que o coletor tinha aberto.
 *
 * A extensao sabe a URL da pagina, nao o id interno do video aqui dentro. Este
 * parser faz a ponte, devolvendo (plataforma, codigo) no mesmo formato que
 * `source.ts` ja grava em `videos.platform_video_id` - se os dois divergirem, a
 * captura nunca acha o video.
 *
 * Nao adivinha: URL que nao casa com nenhum formato conhecido devolve null, e
 * quem chamou responde que nao reconheceu o link. Um palpite aqui gravaria os
 * comentarios de um post no video errado, que e pior do que nao gravar.
 */
export interface PostRef {
  platform: "instagram" | "tiktok";
  platformVideoId: string;
}

const INSTAGRAM_RE = /instagram\.com\/(?:[^/]+\/)?(?:reels?|p|tv)\/([A-Za-z0-9_-]{5,20})/i;
const TIKTOK_RE = /tiktok\.com\/@[^/]+\/video\/(\d{15,20})/i;
const TIKTOK_CURTA_RE = /tiktok\.com\/(?:v|embed)\/(\d{15,20})/i;

export function parsePostUrl(url: string): PostRef | null {
  if (typeof url !== "string" || url.length > 2048) return null;
  const limpa = url.trim();
  if (!limpa) return null;

  const ig = INSTAGRAM_RE.exec(limpa);
  if (ig) return { platform: "instagram", platformVideoId: ig[1] };

  const tt = TIKTOK_RE.exec(limpa) ?? TIKTOK_CURTA_RE.exec(limpa);
  if (tt) return { platform: "tiktok", platformVideoId: tt[1] };

  return null;
}
