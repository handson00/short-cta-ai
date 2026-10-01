import { isFullFrame, type NormalizedRect } from "./crop";

/**
 * Perfil de origem (spec §23, §90, §104): o recorte de uma página, gravado uma
 * vez e reaplicado aos vídeos da mesma página.
 *
 * Funções puras, seguras no cliente: a tela e a rota decidem "qual perfil serve
 * a este vídeo" pela mesma conta — duas implementações da mesma regra divergem.
 */

/** O mínimo que o perfil precisa saber de um vídeo. */
export interface ProfileVideo {
  platform: string | null;
  username: string | null;
  sourceFolder: string | null;
  width: number | null;
  height: number | null;
}

export interface ProfileCandidate {
  id: string;
  name: string;
  originKey: string | null;
  /** Largura ÷ altura do vídeo em que o recorte foi desenhado. */
  aspect: number | null;
  updatedAt: string;
}

/**
 * Tolerância de proporção. 720×1280, 576×1024 e 1080×1920 são todos 9:16 e
 * dão exatamente a mesma razão; 2% cobre arredondamento de encoder (1080×1918)
 * sem aceitar um 4:5 como se fosse 9:16.
 */
export const ASPECT_TOLERANCE = 0.02;

/**
 * Abaixo disto, a detecção automática e o perfil discordam de verdade.
 *
 * Calibrado no acervo real: as detecções automáticas de vídeos da mesma página
 * se sobrepõem entre si com IoU ~0,96, e um recorte manual mais folgado contra
 * a detecção fica em ~0,87. Menos que 0,85 é outra moldura, não ruído.
 */
export const DIVERGENCE_IOU = 0.85;

/**
 * Chave da página de origem: `tiktok:helmermovies`.
 *
 * Sai do que a importação já leu do nome do arquivo e da pasta (`source.ts`).
 * Sem usuário conhecido não há chave: adivinhar a página agruparia vídeos de
 * páginas diferentes sob o mesmo recorte, que é o erro que o perfil existe
 * para evitar.
 */
export function originKeyOf(video: Pick<ProfileVideo, "platform" | "username" | "sourceFolder">): string | null {
  const user = cleanUser(video.username) ?? cleanUser(video.sourceFolder);
  if (!user) return null;
  return `${(video.platform ?? "desconhecida").toLowerCase()}:${user}`;
}

function cleanUser(raw: string | null | undefined): string | null {
  const clean = raw?.trim().replace(/^@+/, "").toLowerCase() ?? "";
  return /^[a-z0-9._]{1,48}$/.test(clean) ? clean : null;
}

const PLATFORM_LABEL: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram" };

/** `tiktok:helmermovies` → `@helmermovies (TikTok)`. */
export function originLabel(key: string | null): string | null {
  if (!key) return null;
  const [platform, user] = key.split(":");
  const label = PLATFORM_LABEL[platform];
  return label ? `@${user} (${label})` : `@${user}`;
}

export function aspectOf(width: number | null, height: number | null): number | null {
  return width && height && width > 0 && height > 0 ? width / height : null;
}

/**
 * Um recorte normalizado só aponta para a mesma região em vídeos de mesma
 * proporção. Num 9:16 e num 1:1 da mesma página a moldura é outra, e o mesmo
 * retângulo cortaria o filme.
 */
export function aspectCompatible(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return false;
  return Math.abs(a - b) / Math.max(a, b) <= ASPECT_TOLERANCE;
}

/** Nome da proporção para a tela: 0,5625 → "9:16". */
export function aspectLabel(aspect: number | null): string {
  if (aspect === null) return "proporção desconhecida";
  const known: Array<[number, string]> = [
    [9 / 16, "9:16"],
    [4 / 5, "4:5"],
    [1, "1:1"],
    [16 / 9, "16:9"],
    [3 / 4, "3:4"],
  ];
  const hit = known.find(([r]) => aspectCompatible(r, aspect));
  return hit ? hit[1] : aspect.toFixed(3).replace(".", ",");
}

export type ProfileMatch =
  | { profile: ProfileCandidate; reason: string }
  | { profile: null; reason: string };

/**
 * O perfil que serve a este vídeo: mesma página e mesma proporção. Havendo
 * mais de um, o atualizado por último — é o que o usuário ajustou mais recente.
 *
 * Quando nenhum serve, o motivo vai junto. "Sem perfil" por página não
 * identificada e por proporção diferente pedem ações diferentes do usuário.
 */
export function matchProfile(
  video: { originKey: string | null; width: number | null; height: number | null },
  profiles: ProfileCandidate[],
): ProfileMatch {
  const key = video.originKey;
  if (!key) {
    return { profile: null, reason: "A página de origem não foi identificada pelo nome do arquivo." };
  }
  const samePage = profiles.filter((p) => p.originKey === key);
  if (samePage.length === 0) {
    return { profile: null, reason: `Nenhum perfil salvo para ${originLabel(key)}.` };
  }
  const aspect = aspectOf(video.width, video.height);
  const fits = samePage
    .filter((p) => aspectCompatible(p.aspect, aspect))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (fits.length === 0) {
    const tem = [...new Set(samePage.map((p) => aspectLabel(p.aspect)))].join(", ");
    return {
      profile: null,
      reason: `Os perfis de ${originLabel(key)} são ${tem}; este vídeo é ${aspectLabel(aspect)}.`,
    };
  }
  return { profile: fits[0], reason: `Mesma página (${originLabel(key)}) e mesma proporção.` };
}

/** Sobreposição entre dois retângulos: 1 = iguais, 0 = disjuntos. */
export function rectIoU(a: NormalizedRect, b: NormalizedRect): number {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Erro de validação do recorte de um perfil, ou nulo.
 *
 * Um perfil com o quadro inteiro não recorta nada: aplicado em lote, faria
 * "recorte do perfil" aparecer em vídeos que continuam exatamente como eram.
 */
export function profileCropError(rect: NormalizedRect): string | null {
  if (isFullFrame(rect)) return "O recorte cobre o quadro inteiro: não há o que reaproveitar num perfil.";
  return null;
}
