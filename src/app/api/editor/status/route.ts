import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { ffmpegAvailable } from "@/lib/media/ffmpeg";
import { encoderWorks } from "@/lib/editor/encoder";
import type { EditorSystemStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { ffmpeg, ffprobe } = await ffmpegAvailable();

  // Mesmo teste real de inicialização que a exportação usa (§52), com o mesmo
  // cache: a tela mostra exatamente o que a fila vai encontrar.
  const [nvenc, qsv, amf, libx264] = ffmpeg
    ? await Promise.all([
        encoderWorks("h264_nvenc"),
        encoderWorks("h264_qsv"),
        encoderWorks("h264_amf"),
        encoderWorks("libx264"),
      ])
    : [false, false, false, false];

  const status: EditorSystemStatus = { ffmpeg, ffprobe, nvenc, qsv, amf, libx264 };
  return NextResponse.json(status);
}
