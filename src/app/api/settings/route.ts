import { fail, handleError, json, readJson, requireAuth } from "@/lib/api";
import { credentialStatus, getSettings, saveSettings } from "@/lib/settings";
import { outputDir, validateOutputDir } from "@/lib/editor/outputDir";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  // `outputDirInUse`: a pasta que de fato recebe os vídeos, já resolvida — com
  // o campo vazio, a tela mostra qual é a padrão em vez de deixar em branco.
  return json({ settings: getSettings(), credential: credentialStatus(), outputDirInUse: outputDir() });
}

export async function PUT(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  try {
    const body = await readJson<unknown>(request);
    // A credencial nunca chega por aqui: tem rota propria.
    const patch = body as Record<string, unknown>;
    delete patch.apiKey;

    // A pasta é conferida ESCREVENDO nela antes de salvar: uma pasta inválida
    // salva em silêncio só apareceria no meio de um lote, com o vídeo já
    // renderizado e sem onde gravar.
    const wanted = (patch.paths as { outputDir?: unknown } | undefined)?.outputDir;
    if (typeof wanted === "string") {
      const problem = validateOutputDir(wanted);
      if (problem) return fail(problem, 422);
    }

    return json({ settings: saveSettings(patch), credential: credentialStatus(), outputDirInUse: outputDir() });
  } catch (err) {
    return handleError(err);
  }
}
