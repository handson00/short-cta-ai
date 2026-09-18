import crypto from "node:crypto";
import { env } from "./env";

/**
 * Criptografia da credencial em repouso. A chave mestra vive fora do banco
 * (SECRETS_MASTER_KEY), de modo que um dump do banco nao revela a chave da API.
 */

function masterKey(): Buffer {
  const raw = env.masterKey.trim();
  if (!raw) throw new Error("SECRETS_MASTER_KEY nao configurada");
  const key = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex")
    : crypto.createHash("sha256").update(raw).digest();
  if (key.length !== 32) throw new Error("SECRETS_MASTER_KEY invalida");
  return key;
}

export function canEncrypt(): boolean {
  try {
    masterKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

export function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(".");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Credencial armazenada em formato desconhecido");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64url")), decipher.final()]).toString("utf8");
}

/** Exibicao segura: gcli_abc...xyz. Nunca devolve a chave inteira. */
export function maskSecret(plain: string): string {
  const trimmed = plain.trim();
  if (trimmed.length <= 10) return "•".repeat(Math.max(trimmed.length, 4));
  return `${trimmed.slice(0, 7)}…${trimmed.slice(-4)}`;
}

export function timingSafeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    // Compara mesmo assim para nao vazar o tamanho por tempo de resposta.
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}
