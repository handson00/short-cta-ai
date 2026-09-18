import { json, requireAuth } from "@/lib/api";
import * as repo from "@/lib/repo";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await ctx.params;
  return json({ ok: repo.requestCancel(id) });
}
