import { NextRequest } from "next/server";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { requireAuth, json, fail, handleError } from "@/lib/api";
import { env } from "@/lib/env";
import { probe } from "@/lib/media/ffmpeg";
import { ASSET_MAX_BYTES, detectAsset, mimeForAsset, type AssetKind } from "@/lib/editor/assets";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<AssetKind, string> = {
  image: "uma imagem (PNG, JPG ou WebP)",
  font: "uma fonte (TTF ou OTF)",
  audio: "um áudio (MP3, M4A, WAV, OGG ou FLAC)",
};

/**
 * Recebe imagem, fonte ou musica do template.
 *
 * O campo `expect` diz o que a tela pediu: uma musica enviada no lugar da
 * logo e recusada aqui, e nao descoberta so na hora de exportar.
 */
export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return fail("Nenhum arquivo enviado.", 400);

    const expect = String(form.get("expect") ?? "image") as AssetKind;
    if (!(expect in ASSET_MAX_BYTES)) return fail("Tipo de arquivo esperado inválido.", 400);
    if (file.size > ASSET_MAX_BYTES[expect]) {
      return fail(`Arquivo maior que ${Math.round(ASSET_MAX_BYTES[expect] / 1024 / 1024)} MB.`, 413);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const type = detectAsset(buffer);
    if (!type || type.kind !== expect) {
      return fail(`Este campo espera ${KIND_LABEL[expect]}.`, 415);
    }

    // Nome gerado pelo servidor: o nome original do usuário nunca vira caminho.
    const name = `tpl_${crypto.randomBytes(8).toString("hex")}${type.ext}`;
    fs.mkdirSync(env.templatesDir, { recursive: true });
    const full = path.join(env.templatesDir, name);
    fs.writeFileSync(full, buffer);

    // Cabeçalho certo não garante arquivo legível: a música é conferida pelo
    // mesmo FFmpeg que vai usá-la, para o erro aparecer agora e não no lote.
    let durationSeconds: number | null = null;
    if (type.kind === "audio") {
      try {
        const info = await probe(full);
        if (!info.hasAudio) throw new Error("sem trilha de áudio");
        durationSeconds = info.durationSeconds;
      } catch {
        fs.rmSync(full, { force: true });
        return fail("O FFmpeg não conseguiu ler este áudio.", 415);
      }
    }

    return json({
      ok: true,
      asset: name,
      kind: type.kind,
      durationSeconds,
      url: `/api/editor/template-asset?file=${name}`,
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function GET(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const file = req.nextUrl.searchParams.get("file");
  if (!file) return fail("Parâmetro 'file' ausente.", 400);

  // basename corta qualquer "../": o cliente escolhe o arquivo, não o caminho.
  const safe = path.basename(file);
  const full = path.join(env.templatesDir, safe);
  if (!fs.existsSync(full)) return fail("Arquivo não encontrado.", 404);

  return new Response(new Uint8Array(fs.readFileSync(full)), {
    headers: { "Content-Type": mimeForAsset(safe), "Cache-Control": "public, max-age=86400" },
  });
}
