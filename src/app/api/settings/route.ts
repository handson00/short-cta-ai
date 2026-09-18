import { handleError, json, readJson, requireAuth } from "@/lib/api";
import { credentialStatus, getSettings, saveSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  return json({ settings: getSettings(), credential: credentialStatus() });
}

export async function PUT(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  try {
    const body = await readJson<unknown>(request);
    // A credencial nunca chega por aqui: tem rota propria.
    const patch = body as Record<string, unknown>;
    delete patch.apiKey;
    return json({ settings: saveSettings(patch), credential: credentialStatus() });
  } catch (err) {
    return handleError(err);
  }
}
