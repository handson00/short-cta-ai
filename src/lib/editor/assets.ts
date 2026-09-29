/**
 * Reconhecimento dos arquivos enviados para o template (imagem, fonte, audio).
 *
 * Pelos primeiros bytes, nunca pela extensao: a extensao e do usuario, os bytes
 * sao do arquivo (spec §84). Um ".png" que e outra coisa nao entra.
 */

export type AssetKind = "image" | "font" | "audio";

export interface AssetType {
  kind: AssetKind;
  ext: string;
  mime: string;
}

const ascii = (b: Buffer, start: number, end: number) => b.subarray(start, end).toString("latin1");

const TYPES: Array<AssetType & { test: (b: Buffer) => boolean }> = [
  {
    kind: "image", ext: ".png", mime: "image/png",
    test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    kind: "image", ext: ".jpg", mime: "image/jpeg",
    test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    kind: "image", ext: ".webp", mime: "image/webp",
    test: (b) => b.length > 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP",
  },
  {
    kind: "font", ext: ".ttf", mime: "font/ttf",
    test: (b) => b.length > 4 && (b.readUInt32BE(0) === 0x00010000 || ascii(b, 0, 4) === "true"),
  },
  {
    kind: "font", ext: ".otf", mime: "font/otf",
    test: (b) => b.length > 4 && ascii(b, 0, 4) === "OTTO",
  },
  {
    kind: "audio", ext: ".mp3", mime: "audio/mpeg",
    // ID3 no começo, ou direto um quadro MPEG (11 bits de sincronia ligados).
    test: (b) => b.length > 3 && (ascii(b, 0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)),
  },
  {
    kind: "audio", ext: ".m4a", mime: "audio/mp4",
    // Só a marca M4A: um MP4 de vídeo também começa com "ftyp".
    test: (b) => b.length > 12 && ascii(b, 4, 8) === "ftyp" && ascii(b, 8, 12) === "M4A ",
  },
  {
    kind: "audio", ext: ".wav", mime: "audio/wav",
    test: (b) => b.length > 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WAVE",
  },
  {
    kind: "audio", ext: ".ogg", mime: "audio/ogg",
    test: (b) => b.length > 4 && ascii(b, 0, 4) === "OggS",
  },
  {
    kind: "audio", ext: ".flac", mime: "audio/flac",
    test: (b) => b.length > 4 && ascii(b, 0, 4) === "fLaC",
  },
];

export function detectAsset(buffer: Buffer): AssetType | null {
  const t = TYPES.find((x) => x.test(buffer));
  return t ? { kind: t.kind, ext: t.ext, mime: t.mime } : null;
}

export function mimeForAsset(fileName: string): string {
  return TYPES.find((t) => fileName.endsWith(t.ext))?.mime ?? "application/octet-stream";
}

/** Limite por tipo: uma música ocupa bem mais que uma logo. */
export const ASSET_MAX_BYTES: Record<AssetKind, number> = {
  image: 12 * 1024 * 1024,
  font: 10 * 1024 * 1024,
  audio: 40 * 1024 * 1024,
};
