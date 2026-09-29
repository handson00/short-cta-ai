import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { env } from "@/lib/env";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const file = req.nextUrl.searchParams.get("file");
  if (!file) {
    return NextResponse.json({ error: "Parâmetro 'file' ausente" }, { status: 400 });
  }

  // Previne path traversal
  const safeName = path.basename(file);
  const filePath = path.join(env.artifactsDir, safeName);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Thumbnail não encontrado" }, { status: 404 });
  }

  const buffer = fs.readFileSync(filePath);
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=86400",
    },
  });
}