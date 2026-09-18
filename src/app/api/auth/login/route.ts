import { NextResponse } from "next/server";
import { authMode, checkPassword, issueToken, SESSION_COOKIE } from "@/lib/auth";
import { fail } from "@/lib/api";

export async function POST(request: Request): Promise<NextResponse> {
  if (authMode() === "locked") {
    return fail("APP_PASSWORD não configurada no servidor.", 503);
  }
  if (authMode() === "open-dev") {
    return NextResponse.json({ ok: true, mode: "open-dev" });
  }

  let password = "";
  try {
    password = String(((await request.json()) as { password?: unknown }).password ?? "");
  } catch {
    return fail("Corpo inválido.");
  }

  // Custo fixo: a comparacao acontece mesmo com senha vazia.
  if (!checkPassword(password)) {
    await new Promise((r) => setTimeout(r, 400));
    return fail("Senha incorreta.", 401);
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, issueToken(), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 12 * 60 * 60,
  });
  return response;
}
