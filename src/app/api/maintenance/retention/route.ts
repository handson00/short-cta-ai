import { json, requireAuth } from "@/lib/api";
import { applyRetention } from "@/lib/repo";
import { getSettings } from "@/lib/settings";

/** Aplica a politica de retencao configurada. */
export async function POST() {
  const denied = await requireAuth();
  if (denied) return denied;
  return json({ report: applyRetention(getSettings().retention) });
}
