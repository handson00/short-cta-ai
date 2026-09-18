/**
 * Identificação da origem do corte a partir do nome da pasta e do arquivo.
 *
 * Os downloaders gravam a origem no próprio nome, mas cada plataforma tem o
 * seu formato. O que distingue as duas com segurança é o código:
 *
 *   TikTok    -> ID numérico longo, 15 a 20 dígitos (7234567890123456789)
 *   Instagram -> shortcode alfanumérico curto, com maiúsculas e "_" (DbLs8h_xu5K)
 *
 * Um número nunca é shortcode e um shortcode nunca é ID numérico, então a
 * detecção não depende de o usuário declarar a plataforma.
 *
 * Quando o código não aparece no nome, a origem fica "não identificada" e
 * NENHUM link é formado: um link inventado dá 404 e só se descobre clicando.
 */

export type Platform = "tiktok" | "instagram";

export interface VideoSource {
  username: string | null;
  videoDate: string | null; // ISO "2025-11-08"
  platform: Platform | null;
  platformVideoId: string | null;
  originalUrl: string | null;
  identified: boolean;
}

const TIKTOK_ID = /^\d{15,20}$/;
// Shortcodes do Instagram têm 11 caracteres; aceitamos 10 a 12 porque
// downloaders variam, e um caractere a mais ou a menos ainda é reconhecível.
const INSTAGRAM_CODE = /^[A-Za-z0-9_-]{10,12}$/;

/** "20251108" -> "2025-11-08" (valida o calendário real). */
export function parseDate(raw: string): string | null {
  if (!/^\d{8}$/.test(raw)) return null;
  const month = Number(raw.slice(4, 6));
  const day = Number(raw.slice(6, 8));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  return Number.isNaN(new Date(`${iso}T00:00:00Z`).getTime()) ? null : iso;
}

/** "@resumosmovies" ou "resumosmovies" -> "resumosmovies". */
export function normalizeUsername(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const clean = raw.trim().replace(/^@+/, "");
  if (clean.length === 0 || clean.length > 48) return null;
  if (!/^[A-Za-z0-9._]+$/.test(clean)) return null;
  return clean;
}

interface ParsedName {
  username: string | null;
  videoDate: string | null;
  platform: Platform | null;
  code: string | null;
}

/**
 * Formatos reconhecidos:
 *   usuario-CODIGO.mp4            -> Instagram
 *   AAAAMMDD_1234567890123456789  -> TikTok
 *   usuario_AAAAMMDD_texto        -> usuário e data, sem código
 *   AAAAMMDD_texto                -> só a data
 */
export function parseFilename(filename: string): ParsedName {
  const base = filename.replace(/\.[a-z0-9]+$/i, "");
  const empty: ParsedName = { username: null, videoDate: null, platform: null, code: null };

  // usuario-CODIGO (Instagram): separador hífen, código na ponta
  const dashed = /^(.+)-([A-Za-z0-9_-]+)$/.exec(base);
  if (dashed) {
    const code = dashed[2];
    if (TIKTOK_ID.test(code)) {
      return { username: normalizeUsername(dashed[1]), videoDate: null, platform: "tiktok", code };
    }
    if (INSTAGRAM_CODE.test(code) && /[A-Za-z]/.test(code)) {
      return { username: normalizeUsername(dashed[1]), videoDate: null, platform: "instagram", code };
    }
  }

  const parts = base.split("_");

  // AAAAMMDD_ID
  const dateFirst = parseDate(parts[0] ?? "");
  if (dateFirst) {
    const candidate = parts[1] ?? "";
    if (TIKTOK_ID.test(candidate)) {
      return { username: null, videoDate: dateFirst, platform: "tiktok", code: candidate };
    }
    return { ...empty, videoDate: dateFirst };
  }

  // usuario_AAAAMMDD_...
  if (parts.length >= 2) {
    const dateSecond = parseDate(parts[1]);
    if (dateSecond) return { ...empty, username: normalizeUsername(parts[0]), videoDate: dateSecond };
  }

  // Último recurso: um ID numérico longo em qualquer posição é TikTok.
  const loose = /(\d{15,20})/.exec(base);
  if (loose) return { ...empty, platform: "tiktok", code: loose[1] };

  return empty;
}

export function buildUrl(platform: Platform, username: string | null, code: string): string | null {
  if (platform === "instagram") return `https://www.instagram.com/reel/${code}/`;
  // O TikTok exige o @usuário no caminho do post.
  return username ? `https://www.tiktok.com/@${username}/video/${code}` : null;
}

/** Endereço que pode ser carregado dentro de um iframe (ver embed.ts). */
export function buildEmbedUrl(platform: string | null, code: string | null): string | null {
  if (!code) return null;
  if (platform === "instagram") return `https://www.instagram.com/reel/${code}/embed/`;
  if (platform === "tiktok") return `https://www.tiktok.com/embed/v2/${code}`;
  return null;
}

/** Monta a origem completa. A pasta, quando existe, manda no usuário. */
export function buildVideoSource(filename: string, folder: string | null | undefined): VideoSource {
  const parsed = parseFilename(filename);
  const username = normalizeUsername(folder) ?? parsed.username;

  if (!parsed.platform || !parsed.code) {
    return {
      username,
      videoDate: parsed.videoDate,
      platform: null,
      platformVideoId: null,
      originalUrl: null,
      identified: false,
    };
  }

  const originalUrl = buildUrl(parsed.platform, username, parsed.code);
  return {
    username,
    videoDate: parsed.videoDate,
    platform: parsed.platform,
    platformVideoId: parsed.code,
    originalUrl,
    identified: Boolean(originalUrl),
  };
}

export const PLATFORM_LABEL: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
};

/** "2025-11-08" -> "08/11/2025". */
export function formatDateBR(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
