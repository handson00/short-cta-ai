import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { env } from "./env";
import { timingSafeEqual } from "./crypto";

export const SESSION_COOKIE = "shortcta_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

// Se APP_SESSION_SECRET nao for definida, usamos um segredo efemero: as sessoes
// caem a cada reinicio, o que e ruidoso mas nunca inseguro.
const ephemeralSecret = crypto.randomBytes(32).toString("hex");

function secret(): string {
  return env.sessionSecret || ephemeralSecret;
}

function sign(value: string): string {
  return crypto.createHmac("sha256", secret()).update(value).digest("base64url");
}

export function issueToken(): string {
  const payload = String(Date.now() + SESSION_TTL_MS);
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string | undefined): boolean {
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  if (!timingSafeEqual(sign(payload), signature)) return false;
  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

export function checkPassword(candidate: string): boolean {
  if (!env.appPassword) return false;
  return timingSafeEqual(
    crypto.createHash("sha256").update(candidate).digest("hex"),
    crypto.createHash("sha256").update(env.appPassword).digest("hex"),
  );
}

/** Sem senha configurada, so o modo de desenvolvimento segue aberto. */
export function authMode(): "password" | "open-dev" | "locked" {
  if (env.appPassword) return "password";
  return env.isProduction ? "locked" : "open-dev";
}

export async function isAuthenticated(): Promise<boolean> {
  const mode = authMode();
  if (mode === "open-dev") return true;
  if (mode === "locked") return false;
  const jar = await cookies();
  return verifyToken(jar.get(SESSION_COOKIE)?.value);
}

/** Guarda das rotas de API. Devolve null quando a requisicao pode seguir. */
export async function guardApi(): Promise<NextResponse | null> {
  if (authMode() === "locked") {
    return NextResponse.json(
      { error: "APP_PASSWORD nao configurada. Defina uma senha antes de expor a aplicacao." },
      { status: 503 },
    );
  }
  if (await isAuthenticated()) return null;
  return NextResponse.json({ error: "Nao autenticado" }, { status: 401 });
}
