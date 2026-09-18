import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env } from "./env";

export const ALLOWED_EXTENSIONS = [".mp4", ".mov", ".webm"] as const;

export interface UploadValidation {
  ok: boolean;
  reason?: string;
  container?: "mp4" | "mov" | "webm";
}

/**
 * Valida pelo conteudo, nao pelo nome. O nome original so serve para exibir:
 * o arquivo e gravado com um nome gerado pelo servidor, o que evita travessia
 * de diretorio e colisao.
 */
export function validateBuffer(buffer: Buffer, originalName: string, maxBytes: number): UploadValidation {
  if (buffer.length === 0) return { ok: false, reason: "Arquivo vazio." };
  if (buffer.length > maxBytes) {
    return { ok: false, reason: `Arquivo acima do limite de ${(maxBytes / 1024 / 1024).toFixed(0)} MB.` };
  }

  const ext = path.extname(originalName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext as (typeof ALLOWED_EXTENSIONS)[number])) {
    return { ok: false, reason: `Extensão ${ext || "(vazia)"} não suportada.` };
  }

  const container = sniffContainer(buffer);
  if (!container) {
    return { ok: false, reason: "O conteúdo não parece um MP4, MOV ou WebM válido." };
  }
  if ((ext === ".webm" && container !== "webm") || (ext !== ".webm" && container === "webm")) {
    return { ok: false, reason: "A extensão não corresponde ao conteúdo do arquivo." };
  }

  return { ok: true, container };
}

/** MP4/MOV tem a caixa "ftyp" nos primeiros bytes; WebM/Matroska comeca com EBML. */
export function sniffContainer(buffer: Buffer): "mp4" | "mov" | "webm" | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return "webm";
  const box = buffer.subarray(4, 8).toString("ascii");
  if (box === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("ascii");
    return brand.startsWith("qt") ? "mov" : "mp4";
  }
  // Alguns MOV comecam com outras caixas conhecidas.
  if (["moov", "mdat", "free", "wide", "skip"].includes(box)) return "mov";
  return null;
}

export function sha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

const CONTROL_CHARS = new RegExp("[\\x00-\\x1f<>]", "g");

export function safeDisplayName(originalName: string): string {
  return path.basename(originalName).replace(CONTROL_CHARS, "").slice(0, 180) || "video";
}

export function storeUpload(buffer: Buffer, extension: string): { storedName: string; absolutePath: string } {
  fs.mkdirSync(env.uploadsDir, { recursive: true });
  const storedName = `${crypto.randomUUID()}${extension}`;
  const absolutePath = path.join(env.uploadsDir, storedName);
  fs.writeFileSync(absolutePath, buffer, { mode: 0o600 });
  return { storedName, absolutePath };
}
