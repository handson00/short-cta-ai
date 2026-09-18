import { json, readJson, requireAuth } from "@/lib/api";
import * as repo from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  return json({ examples: repo.listStyleExamples(), max: repo.MAX_STYLE_EXAMPLES });
}

export async function POST(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { text, note } = await readJson<{ text?: string; note?: string }>(request);
  return json({ examples: repo.addStyleExample(text ?? "", note) });
}

export async function DELETE(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get("id");
  if (id) repo.removeStyleExample(id);
  return json({ examples: repo.listStyleExamples() });
}
