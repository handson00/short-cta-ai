import { json } from "@/lib/api";
import * as repo from "@/lib/repo";

export const dynamic = "force-dynamic";

/**
 * Endpoint público para a extensão consultar a fila de capturas pendentes.
 * Não exige sessão do app — a extensão usa o COMMENTS_INGEST_TOKEN via header.
 * Query params: ?limit=N (default 5)
 */
export async function GET(request: Request) {
  // Validação simples por token (mesmo padrão do /api/comments/ingest)
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    return json({ error: "Token obrigatório." }, 401);
  }

  // Compara com o token de ingestão configurado
  const { env } = await import("@/lib/env");
  if (!env.commentsIngestToken || token !== env.commentsIngestToken) {
    return json({ error: "Token inválido." }, 403);
  }

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 5), 20);

  const items = repo.getPendingCaptures(limit);
  return json({ items });
}

/**
 * Marca um item como concluído ou com erro.
 * Body: { id: string; status: "done" | "error" }
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    return json({ error: "Token obrigatório." }, 401);
  }

  const { env } = await import("@/lib/env");
  if (!env.commentsIngestToken || token !== env.commentsIngestToken) {
    return json({ error: "Token inválido." }, 403);
  }

  const body = (await request.json()) as {
    id?: string;
    status?: "done" | "error";
  };

  if (!body.id || !body.status) {
    return json({ error: "id e status são obrigatórios." }, 400);
  }

  if (body.status === "done") {
    repo.completeCaptureQueueItem(body.id);
  } else if (body.status === "error") {
    repo.failCaptureQueueItem(body.id);
  } else {
    return json({ error: "status deve ser 'done' ou 'error'." }, 400);
  }

  return json({ ok: true });
}