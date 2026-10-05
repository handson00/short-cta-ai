import { json, requireAuth } from "@/lib/api";
import { listExports } from "@/lib/exportsData";
import { outputDir } from "@/lib/editor/outputDir";

export const dynamic = "force-dynamic";

/**
 * Os vídeos já exportados, com tudo que é preciso para publicar.
 *
 * Só entram os jobs `completed`: a página é "o que está pronto". O arquivo que
 * não está mais no disco NÃO é escondido: vem marcado (`fileMissing`), porque
 * sumir da lista faria parecer que a exportação nunca aconteceu — e quem
 * exportou 10 e vê 8 não teria como saber o que houve com os outros dois.
 *
 * A montagem de cada item mora em `lib/exportsData.ts`: o envio ao Agendador IG
 * usa a mesma.
 */
export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;

  const startedAt = (globalThis as { __appStartedAt?: string }).__appStartedAt ?? null;
  const exports = listExports(startedAt);

  return json({ exports, outputDir: outputDir(), sessionStartedAt: startedAt });
}
