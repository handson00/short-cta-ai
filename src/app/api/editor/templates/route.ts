import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, json, fail, handleError } from "@/lib/api";
import {
  createEditorTemplate,
  deleteEditorTemplate,
  listEditorTemplates,
  updateEditorTemplate,
  setVideoTemplate,
} from "@/lib/editorRepo";
import { validateTemplateConfig, DEFAULT_TEMPLATE } from "@/lib/editor/template";

export const dynamic = "force-dynamic";

const textSchema = z.object({
  enabled: z.boolean(),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  fontFamily: z.string().min(1).max(80),
  fontFile: z.string().max(80).optional(),
  bold: z.boolean(),
  maxFontSize: z.number().int(),
  minFontSize: z.number().int(),
  lineHeight: z.number(),
  align: z.enum(["left", "center", "right"]),
  uppercase: z.boolean(),
  color: z.string(),
  strokeColor: z.string(),
  strokeWidth: z.number(),
  boxColor: z.string().optional(),
  boxOpacity: z.number().optional(),
  start: z.number(),
  end: z.number().nullable().default(null),
  fadeIn: z.number(),
  fadeOut: z.number(),
});

const audioSchema = z.object({
  mode: z.enum(["original", "mute", "replace", "mix"]),
  music: z.string().max(80).optional(),
  originalVolume: z.number(),
  musicVolume: z.number(),
});

const configSchema = z.object({
  background: z.string().optional(),
  overlay: z.string().optional(),
  logo: z.string().optional(),
  backgroundColor: z.string().optional(),
  canvasWidth: z.number().int().min(16).max(8192),
  canvasHeight: z.number().int().min(16).max(8192),
  videoX: z.number().int().min(0),
  videoY: z.number().int().min(0),
  videoWidth: z.number().int().min(2),
  videoHeight: z.number().int().min(2),
  fitMode: z.enum(["fit", "fill"]),
  logoX: z.number().int().min(0).optional(),
  logoY: z.number().int().min(0).optional(),
  logoWidth: z.number().int().min(2).optional(),
  logoHeight: z.number().int().min(2).optional(),
  // Os limites de verdade (caixa dentro do canvas, cores, tempos) ficam em
  // validateTemplateConfig, com mensagem em português para a tela.
  text: textSchema.optional(),
  audio: audioSchema.optional(),
});

const createSchema = z.object({
  name: z.string().min(1).max(80),
  config: configSchema.default(DEFAULT_TEMPLATE),
});

const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80).optional(),
  config: configSchema.optional(),
});

const assignSchema = z.object({
  videoIds: z.array(z.string().min(1)).min(1),
  templateId: z.string().min(1).nullable(),
});

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  return json({ templates: listEditorTemplates() });
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const body = await req.json();

    // Atribuir template a vídeos é um POST com outra forma de corpo, para não
    // multiplicar rotas por um verbo só.
    if (body && Array.isArray(body.videoIds)) {
      const parsed = assignSchema.safeParse(body);
      if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Dados inválidos.", 422);
      const changed = setVideoTemplate(parsed.data.videoIds, parsed.data.templateId);
      return json({ ok: true, changed });
    }

    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Dados inválidos.", 422);

    const erro = validateTemplateConfig(parsed.data.config);
    if (erro) return fail(erro, 422);

    return json({ ok: true, template: createEditorTemplate(parsed.data.name, parsed.data.config) });
  } catch (err) {
    return handleError(err);
  }
}

export async function PUT(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const parsed = updateSchema.safeParse(await req.json());
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Dados inválidos.", 422);

    if (parsed.data.config) {
      const erro = validateTemplateConfig(parsed.data.config);
      if (erro) return fail(erro, 422);
    }

    const updated = updateEditorTemplate(parsed.data.id, {
      name: parsed.data.name,
      config: parsed.data.config,
    });
    if (!updated) return fail("Template não encontrado.", 404);
    return json({ ok: true, template: updated });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return fail("Parâmetro 'id' ausente.", 400);
  // Os vídeos que usavam este template voltam a ficar sem template
  // (ON DELETE SET NULL); nenhum vídeo é removido da edição.
  deleteEditorTemplate(id);
  return json({ ok: true });
}
