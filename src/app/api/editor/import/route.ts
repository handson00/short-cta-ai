import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { probe, extractThumbnail } from "@/lib/media/ffmpeg";
import { env } from "@/lib/env";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";

const ALLOWED_EXTS = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi"]);

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const formData = await req.formData();
  const files = formData.getAll("files") as File[];

  if (files.length === 0) {
    return NextResponse.json({ error: "Nenhum arquivo enviado" }, { status: 400 });
  }

  const results: Array<{
    name: string;
    videoId: string | null;
    width: number | null;
    height: number | null;
    durationSeconds: number | null;
    thumbnailUrl: string | null;
    error: string | null;
  }> = [];

  for (const file of files) {
    const ext = path.extname(file.name).toLowerCase();
    if (!ALLOWED_EXTS.has(ext)) {
      results.push({ name: file.name, videoId: null, width: null, height: null, durationSeconds: null, thumbnailUrl: null, error: `Extensão não suportada: ${ext}` });
      continue;
    }

    try {
      // Gera hash para deduplicação
      const buffer = Buffer.from(await file.arrayBuffer());
      const hash = crypto.createHash("sha256").update(buffer).digest("hex");

      // Nome único no disco
      const storedName = `${hash.slice(0, 16)}_${Date.now()}${ext}`;
      const filePath = path.join(env.uploadsDir, storedName);
      fs.mkdirSync(env.uploadsDir, { recursive: true });
      fs.writeFileSync(filePath, buffer);

      // Probe via ffprobe
      const mediaInfo = await probe(filePath);

      // Thumbnail
      const thumbPath = path.join(env.artifactsDir, `editor_thumb_${storedName.replace(ext, ".jpg")}`);
      const thumbResult = await extractThumbnail(filePath, thumbPath);
      const thumbnailUrl = thumbResult ? `/api/editor/thumbnail?file=${encodeURIComponent(path.basename(thumbResult))}` : null;

      // Registra no banco como vídeo do editor
      const { createVideo } = await import("@/lib/repo");
      const video = createVideo({
        originalName: file.name,
        storedName,
        path: filePath,
        hash,
        bytes: buffer.length,
        mime: file.type || null,
      });

      results.push({
        name: file.name,
        videoId: video.id,
        width: mediaInfo.width,
        height: mediaInfo.height,
        durationSeconds: mediaInfo.durationSeconds,
        thumbnailUrl,
        error: null,
      });
    } catch (err) {
      results.push({
        name: file.name,
        videoId: null,
        width: null,
        height: null,
        durationSeconds: null,
        thumbnailUrl: null,
        error: err instanceof Error ? err.message : "Erro desconhecido",
      });
    }
  }

  return NextResponse.json({ imported: results });
}