/**
 * Captura de dados públicos do post de origem.
 *
 * TikTok publica um oEmbed aberto, que devolve autor, legenda e miniatura sem
 * credencial. O Instagram fechou o dele: o oEmbed oficial exige um token de
 * app do Facebook. Enquanto esse token não estiver configurado, a captura do
 * Instagram falha dizendo isso, em vez de devolver dados inventados ou raspar
 * a página por vias que quebram a cada mudança de layout.
 */

export interface CapturedPost {
  platform: string;
  authorName: string | null;
  authorUrl: string | null;
  title: string | null;
  thumbnailUrl: string | null;
  raw: unknown;
}

export type CaptureResult =
  | { ok: true; data: CapturedPost }
  | { ok: false; reason: string };

const TIMEOUT_MS = 15_000;

export async function capturePostMetadata(platform: string, postUrl: string): Promise<CaptureResult> {
  if (platform === "tiktok") return captureTiktok(postUrl);
  if (platform === "instagram") {
    return {
      ok: false,
      reason:
        "O oEmbed do Instagram exige um token de app do Facebook. Configure INSTAGRAM_OEMBED_TOKEN para habilitar a captura.",
    };
  }
  return { ok: false, reason: `Plataforma sem captura implementada: ${platform}.` };
}

async function captureTiktok(postUrl: string): Promise<CaptureResult> {
  const endpoint = `https://www.tiktok.com/oembed?url=${encodeURIComponent(postUrl)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(endpoint, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!res.ok) {
      return { ok: false, reason: `O TikTok respondeu HTTP ${res.status} para este post.` };
    }
    const data = (await res.json()) as Record<string, unknown>;
    return {
      ok: true,
      data: {
        platform: "tiktok",
        authorName: str(data.author_name),
        authorUrl: str(data.author_url),
        title: str(data.title),
        thumbnailUrl: str(data.thumbnail_url),
        raw: data,
      },
    };
  } catch (err) {
    const aborted = (err as Error).name === "AbortError";
    return { ok: false, reason: aborted ? "O TikTok não respondeu a tempo." : "Não foi possível alcançar o TikTok." };
  } finally {
    clearTimeout(timer);
  }
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 1000) : null;
}
