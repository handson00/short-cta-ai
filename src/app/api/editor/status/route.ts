import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { ffmpegAvailable } from "@/lib/media/ffmpeg";
import { run } from "@/lib/media/run";
import { env } from "@/lib/env";
import type { EditorSystemStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

async function detectEncoder(name: string): Promise<boolean> {
  try {
    // Teste real: tenta inicializar o encoder com um pipe nulo.
    // Se o encoder existe mas não funciona (ex: GPU ausente), falha aqui.
    await run(
      env.ffmpegPath,
      ["-f", "lavfi", "-i", "nullsrc=s=64x64:d=0.1", "-c:v", name, "-f", "null", "-"],
      { timeoutMs: 5_000 },
    );
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { ffmpeg, ffprobe } = await ffmpegAvailable();

  let nvenc = false;
  let qsv = false;
  let amf = false;
  let libx264 = false;

  if (ffmpeg) {
    [nvenc, qsv, amf, libx264] = await Promise.all([
      detectEncoder("h264_nvenc"),
      detectEncoder("h264_qsv"),
      detectEncoder("h264_amf"),
      detectEncoder("libx264"),
    ]);
  }

  const status: EditorSystemStatus = { ffmpeg, ffprobe, nvenc, qsv, amf, libx264 };
  return NextResponse.json(status);
}