import { NextRequest } from "next/server";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { requireAuth, json, fail, handleError } from "@/lib/api";
import { env } from "@/lib/env";
import { detectAsset } from "@/lib/editor/assets";
import { textLayerFilesInUse } from "@/lib/editorRepo";

export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;
const VIDEO_ID = /^vid_[a-z0-9]+$/;

/**
 * Recebe a camada de texto que o navegador desenhou para um vídeo.
 *
 * O navegador desenha porque é o mesmo desenho do preview: a camada exportada
 * fica idêntica ao que se viu na tela, com emoji e com a fonte escolhida. O
 * servidor só confere que é um PNG e guarda.
 */
export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const form = await req.formData();
    const file = form.get("file");
    const videoId = String(form.get("videoId") ?? "");
    if (!(file instanceof File)) return fail("Nenhuma camada enviada.", 400);
    if (!VIDEO_ID.test(videoId)) return fail("Vídeo inválido.", 400);
    if (file.size > MAX_BYTES) return fail("Camada de texto maior que 8 MB.", 413);

    const buffer = Buffer.from(await file.arrayBuffer());
    if (detectAsset(buffer)?.ext !== ".png") return fail("A camada de texto precisa ser PNG.", 415);

    // Nome pelo conteúdo: o mesmo texto no mesmo estilo gera o mesmo arquivo,
    // e reenviar não duplica nada.
    const hash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
    const name = `txt_${videoId}_${hash}.png`;
    fs.mkdirSync(env.textLayersDir, { recursive: true });
    fs.writeFileSync(path.join(env.textLayersDir, name), buffer);

    // Versões antigas deste vídeo que nenhum job pendente usa saem da pasta.
    const inUse = textLayerFilesInUse();
    for (const other of fs.readdirSync(env.textLayersDir)) {
      if (other !== name && other.startsWith(`txt_${videoId}_`) && !inUse.has(other)) {
        fs.rmSync(path.join(env.textLayersDir, other), { force: true });
      }
    }

    return json({ ok: true, layer: name });
  } catch (err) {
    return handleError(err);
  }
}
