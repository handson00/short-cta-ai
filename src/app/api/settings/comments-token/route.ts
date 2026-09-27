import { fail, json, requireAuth } from "@/lib/api";
import { env } from "@/lib/env";
import { randomBytes } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

/**
 * Lê o token atual (se existir) para exibir na tela de configurações.
 * Nunca devolve o valor real se não houver — apenas null.
 */
export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  return json({ token: env.commentsIngestToken ?? null });
}

/**
 * Gera um novo COMMENTS_INGEST_TOKEN e grava no .env.local.
 * Exige sessão do app (só o admin pode rotacionar o token).
 */
export async function POST() {
  const denied = await requireAuth();
  if (denied) return denied;

  const envPath = path.resolve(process.cwd(), ".env.local");
  const newToken = randomBytes(32).toString("hex");
  const line = `COMMENTS_INGEST_TOKEN=${newToken}`;

  try {
    let content = "";
    try {
      content = readFileSync(envPath, "utf-8");
    } catch {
      // arquivo não existe ainda — será criado
    }

    const lines = content.split(/\r?\n/);
    let replaced = false;
    for (let i = 0; i < lines.length; i++) {
      if (/^COMMENTS_INGEST_TOKEN=/.test(lines[i])) {
        lines[i] = line;
        replaced = true;
      }
    }

    if (replaced) {
      writeFileSync(envPath, lines.join("\n"), "utf-8");
    } else {
      // adiciona ao final, garantindo quebra de linha antes se necessário
      const prefix = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
      appendFileSync(envPath, `${prefix}${line}\n`, "utf-8");
    }

    return json({ ok: true, token: newToken });
  } catch (err) {
    return fail(
      err instanceof Error ? err.message : "Falha ao gravar o token no .env.local.",
      500,
    );
  }
}