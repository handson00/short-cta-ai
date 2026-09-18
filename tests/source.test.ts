import { describe, expect, it } from "vitest";
import {
  buildEmbedUrl,
  buildVideoSource,
  formatDateBR,
  normalizeUsername,
  parseFilename,
} from "../src/lib/source";

/**
 * Os casos abaixo vêm dos arquivos reais da biblioteca: é o que distingue um
 * shortcode do Instagram de um ID do TikTok sem ninguém precisar declarar a
 * plataforma.
 */

describe("detecção de plataforma", () => {
  it("reconhece shortcode do Instagram no padrão usuario-CODIGO", () => {
    const s = buildVideoSource("miranhafilmesz-DbLs8h_xu5K.mp4", "miranhafilmesz");
    expect(s.platform).toBe("instagram");
    expect(s.platformVideoId).toBe("DbLs8h_xu5K");
    expect(s.originalUrl).toBe("https://www.instagram.com/reel/DbLs8h_xu5K/");
    expect(s.identified).toBe(true);
  });

  it("aceita shortcode com 10 caracteres, que alguns downloaders produzem", () => {
    expect(buildVideoSource("miranhafilmesz-DaGaG3yx43.mp4", "miranhafilmesz").platform).toBe("instagram");
  });

  it("reconhece ID numérico do TikTok no padrão AAAAMMDD_ID", () => {
    const s = buildVideoSource("20251108_7234567890123456789.mp4", "resumosmovies");
    expect(s.platform).toBe("tiktok");
    expect(s.videoDate).toBe("2025-11-08");
    expect(s.originalUrl).toBe("https://www.tiktok.com/@resumosmovies/video/7234567890123456789");
  });

  it("não confunde as duas: número nunca é shortcode", () => {
    expect(parseFilename("usuario-7234567890123456789.mp4").platform).toBe("tiktok");
    expect(parseFilename("usuario-DbLs8h_xu5K.mp4").platform).toBe("instagram");
  });

  it("um TikTok sem o @usuário não vira link, porque o caminho exige o perfil", () => {
    const s = buildVideoSource("20251108_7234567890123456789.mp4", null);
    expect(s.platform).toBe("tiktok");
    expect(s.originalUrl).toBeNull();
    expect(s.identified).toBe(false);
  });
});

describe("arquivos fora de padrão", () => {
  it("não inventa link para nome com data e legenda", () => {
    const s = buildVideoSource("20260103_Esse_homem_rob_encontrou_essa_garotinha.mp4", null);
    expect(s.originalUrl).toBeNull();
    expect(s.identified).toBe(false);
    // A data ainda é aproveitada.
    expect(s.videoDate).toBe("2026-01-03");
  });

  it("aproveita usuário e data do padrão usuario_AAAAMMDD_texto", () => {
    const s = buildVideoSource("cineresumo47_20260915_resumodefilmes_filmes.mp4", null);
    expect(s.username).toBe("cineresumo47");
    expect(s.videoDate).toBe("2026-09-15");
    expect(s.originalUrl).toBeNull();
  });

  it("não identifica nada em um nome qualquer", () => {
    expect(buildVideoSource("video_qualquer.mp4", null).identified).toBe(false);
  });

  it("a pasta manda no usuário quando as duas fontes divergem", () => {
    expect(buildVideoSource("outro-DbLs8h_xu5K.mp4", "@perfiloficial").username).toBe("perfiloficial");
  });
});

describe("endereços de embed", () => {
  it("monta o embed de cada plataforma", () => {
    expect(buildEmbedUrl("instagram", "DbLs8h_xu5K")).toBe("https://www.instagram.com/reel/DbLs8h_xu5K/embed/");
    expect(buildEmbedUrl("tiktok", "7234567890123456789")).toBe("https://www.tiktok.com/embed/v2/7234567890123456789");
  });

  it("sem código não há embed", () => {
    expect(buildEmbedUrl("instagram", null)).toBeNull();
    expect(buildEmbedUrl(null, "DbLs8h_xu5K")).toBeNull();
  });
});

describe("auxiliares", () => {
  it("normaliza o usuário", () => {
    expect(normalizeUsername("@resumosmovies")).toBe("resumosmovies");
    expect(normalizeUsername("  perfil.oficial ")).toBe("perfil.oficial");
    expect(normalizeUsername("pasta com espaço")).toBeNull();
    expect(normalizeUsername("")).toBeNull();
  });

  it("formata a data no padrão brasileiro", () => {
    expect(formatDateBR("2025-11-08")).toBe("08/11/2025");
    expect(formatDateBR(null)).toBeNull();
  });

  it("recusa data impossível", () => {
    expect(buildVideoSource("20259932_teste.mp4", null).videoDate).toBeNull();
  });
});
