import { NextResponse } from "next/server";
import { guardApi } from "./auth";
import { AiError } from "./providers/ai/errors";

export async function requireAuth(): Promise<NextResponse | null> {
  return guardApi();
}

export function json(data: unknown, init?: number | ResponseInit): NextResponse {
  return NextResponse.json(data as object, typeof init === "number" ? { status: init } : init);
}

export function fail(message: string, status = 400, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/** Converte erros conhecidos em respostas seguras: nunca devolve a credencial. */
export function handleError(err: unknown): NextResponse {
  if (err instanceof AiError) {
    const status =
      err.code === "not_configured" ? 409 : err.code === "rate_limited" ? 429 : err.httpStatus && err.httpStatus < 500 ? 400 : 502;
    return fail(err.message, status, { code: err.code });
  }
  const message = err instanceof Error ? err.message : "Falha inesperada";
  return fail(message, 500);
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new Error("Corpo da requisição não é JSON válido.");
  }
}
