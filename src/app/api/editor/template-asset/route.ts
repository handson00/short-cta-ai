import { NextRequest } from "next/server";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { requireAuth, json, fail, handleError } from "@/lib/api";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Assinaturas dos formatos aceitos.
 *
 * A extensao do arquivo e do usuario; os primeiros bytes sao do arquivo. Um
 * `.png` que na verdade e outra coisa nao entra — mesma regra que o upload de
 * video do projeto ja segue (spec §84).
 */
const SIGNATURES: Array<{ ext: string; mime: string; test: (b: Buffer) => boolean }> = [
  {
    ext: ".png",
    mime: "image/png",
    test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    ext: ".jpg",
    mime: "image/jpeg",
    test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    ext: ".webp",
    mime: "image/webp",
    test: (b) =>
      b.length > 12 &&
      b.subarray(0, 4).toString("ascii") === "RIFF" &&
      b.subarray(8, 12).toString("ascii") === "WEBP",
  },
];

const MAX_BYTES = 12 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return fail("Nenhuma imagem enviada.", 400);
    if (file.size > MAX_BYTES) return fail("Imagem maior que 12 MB.", 413);

    const buffer = Buffer.from(await file.arrayBuffer());
    const match = SIGNATURES.find((s) => s.test(buffer));
    if (!match) return fail("Formato não reconhecido. Use PNG, JPG ou WebP.", 415);

    // Nome gerado pelo servidor: o nome original do usuário nunca vira caminho.
    const name = `tpl_${crypto.randomBytes(8).toString("hex")}${match.ext}`;
    fs.mkdirSync(env.templatesDir, { recursive: true });
    fs.writeFileSync(path.join(env.templatesDir, name), buffer);

    return json({ ok: true, asset: name, url: `/api/editor/template-asset?file=${name}` });
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
  if (!fs.existsSync(full)) return fail("Imagem não encontrada.", 404);

  const mime = SIGNATURES.find((s) => safe.endsWith(s.ext))?.mime ?? "application/octet-stream";
  return new Response(new Uint8Array(fs.readFileSync(full)), {
    headers: { "Content-Type": mime, "Cache-Control": "public, max-age=86400" },
  });
}
