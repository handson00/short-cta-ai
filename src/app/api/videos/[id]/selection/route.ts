import { fail, json, readJson, requireAuth } from "@/lib/api";
import * as repo from "@/lib/repo";

interface Body {
  chosenCtaId?: string | null;
  editedText?: string | null;
  favorite?: boolean;
  /** Quando true, guarda o texto escolhido entre os exemplos de estilo. */
  keepAsStyleExample?: boolean;
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!repo.getVideo(id)) return fail("Vídeo não encontrado.", 404);

  const body = await readJson<Body>(request);
  const selection = repo.updateSelection(id, {
    chosenCtaId: body.chosenCtaId ?? undefined,
    editedText: body.editedText !== undefined ? (body.editedText?.slice(0, 200) ?? null) : undefined,
    favorite: body.favorite,
  });

  if (body.keepAsStyleExample) {
    const text =
      selection.editedText ?? repo.listSuggestions(id).find((s: any) => s.id === selection.chosenCtaId)?.text ?? "";
    if (text) repo.addStyleExample(text);
  }

  return json({ selection });
}
