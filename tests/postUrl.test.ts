import { describe, expect, it } from "vitest";
import { parsePostUrl } from "../src/lib/postUrl";
import { urlDeCaptura } from "../src/components/CommentsPanel";

/**
 * O código que sai daqui precisa bater exatamente com o que `source.ts` grava em
 * videos.platform_video_id. Se os dois divergirem, a captura de comentários
 * nunca encontra o vídeo e o erro aparece como "nenhum vídeo corresponde".
 */
describe("parsePostUrl", () => {
  it("lê o shortcode de um reel do Instagram", () => {
    expect(parsePostUrl("https://www.instagram.com/reel/DbLs8h_xu5K/")).toEqual({
      platform: "instagram",
      platformVideoId: "DbLs8h_xu5K",
    });
  });

  it("aceita as outras formas de link do Instagram", () => {
    for (const url of [
      "https://www.instagram.com/p/DbLs8h_xu5K/",
      "https://instagram.com/reels/DbLs8h_xu5K",
      "https://www.instagram.com/miranhafilmesz/reel/DbLs8h_xu5K/?igsh=abc",
    ]) {
      expect(parsePostUrl(url)?.platformVideoId, url).toBe("DbLs8h_xu5K");
    }
  });

  it("lê o id numérico de um vídeo do TikTok", () => {
    expect(parsePostUrl("https://www.tiktok.com/@alguem/video/7234567890123456789")).toEqual({
      platform: "tiktok",
      platformVideoId: "7234567890123456789",
    });
  });

  it("não confunde as duas plataformas", () => {
    expect(parsePostUrl("https://www.instagram.com/reel/DbLs8h_xu5K/")?.platform).toBe("instagram");
    expect(parsePostUrl("https://www.tiktok.com/@x/video/7234567890123456789")?.platform).toBe("tiktok");
  });

  it("devolve null em vez de adivinhar", () => {
    // Um palpite aqui gravaria os comentários de um post no vídeo errado.
    for (const url of [
      "https://www.instagram.com/miranhafilmesz/",
      "https://www.youtube.com/watch?v=abc",
      "https://www.tiktok.com/@alguem",
      "não é uma url",
      "",
    ]) {
      expect(parsePostUrl(url), url).toBeNull();
    }
  });
});

describe("urlDeCaptura", () => {
  it("acrescenta o marcador que autoriza a extensão", async () => {
    const { urlDeCaptura } = await import("../src/components/CommentsPanel");
    expect(urlDeCaptura("https://www.instagram.com/reel/DbLs8h_xu5K/")).toBe(
      "https://www.instagram.com/reel/DbLs8h_xu5K/?shortcta=1",
    );
  });

  it("preserva parâmetros que já existiam no link", async () => {
    const { urlDeCaptura } = await import("../src/components/CommentsPanel");
    const saida = urlDeCaptura("https://www.instagram.com/reel/DbLs8h_xu5K/?igsh=abc");
    expect(saida).toContain("igsh=abc");
    expect(saida).toContain("shortcta=1");
  });

  it("devolve null se o link não for uma URL válida", () => {
    // Melhor não oferecer o botão do que abrir uma aba quebrada.
    expect(urlDeCaptura("nao é url")).toBeNull();
  });
});
