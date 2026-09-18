import { describe, expect, it } from "vitest";
import { safeDisplayName, sniffContainer, validateBuffer } from "../src/lib/upload";

function mp4(): Buffer {
  const b = Buffer.alloc(32);
  b.write("ftyp", 4, "ascii");
  b.write("isom", 8, "ascii");
  return b;
}

function webm(): Buffer {
  const b = Buffer.alloc(32);
  b[0] = 0x1a;
  b[1] = 0x45;
  b[2] = 0xdf;
  b[3] = 0xa3;
  return b;
}

describe("sniffContainer", () => {
  it("reconhece mp4 e webm pelo conteúdo", () => {
    expect(sniffContainer(mp4())).toBe("mp4");
    expect(sniffContainer(webm())).toBe("webm");
  });

  it("recusa conteúdo desconhecido", () => {
    expect(sniffContainer(Buffer.from("isto e um texto qualquer aqui"))).toBeNull();
  });
});

describe("validateBuffer", () => {
  const max = 10 * 1024 * 1024;

  it("aceita um mp4 legítimo", () => {
    expect(validateBuffer(mp4(), "corte.mp4", max).ok).toBe(true);
  });

  it("recusa extensão não suportada", () => {
    expect(validateBuffer(mp4(), "corte.avi", max).reason).toMatch(/não suportada/);
  });

  it("recusa quando extensão e conteúdo divergem", () => {
    expect(validateBuffer(webm(), "corte.mp4", max).reason).toMatch(/não corresponde/);
  });

  it("recusa arquivo acima do limite", () => {
    expect(validateBuffer(mp4(), "corte.mp4", 8).reason).toMatch(/limite/);
  });

  it("recusa arquivo vazio", () => {
    expect(validateBuffer(Buffer.alloc(0), "corte.mp4", max).reason).toMatch(/vazio/);
  });
});

describe("safeDisplayName", () => {
  it("descarta caminho e mantém só o nome", () => {
    expect(safeDisplayName("../../etc/passwd.mp4")).toBe("passwd.mp4");
  });

  it("remove caracteres de controle e sinais de marcação", () => {
    const nasty = `a${String.fromCharCode(0)}b<script>.mp4`;
    expect(safeDisplayName(nasty)).toBe("abscript.mp4");
  });
});
