/**
 * Preset de saida para Reels e TikTok.
 *
 * As duas plataformas recomprimem tudo que recebem. O arquivo que sai daqui
 * nao e o que o espectador ve: e a materia-prima da recompressao delas. Por
 * isso o preset mira qualidade alta e compatibilidade maxima, nao tamanho
 * minimo — cada perda que entra aqui se soma a perda da plataforma.
 *
 * Os valores sao escolha de engenharia sobre o que as plataformas publicam
 * (H.264, AAC, 9:16, 30 fps). Revise se as recomendacoes delas mudarem.
 */

export const SOCIAL_PRESET = {
  width: 1080,
  height: 1920,
  fps: 30,
  /** GOP de 2 s: keyframe regular ajuda o corte e o seek na recompressão. */
  gopSeconds: 2,
  /** Alvo ~10 Mbps: acima de ~12 não sobra ganho visível depois da recompressão. */
  videoBitrate: "10M",
  maxBitrate: "12M",
  bufferSize: "24M",
  audioBitrate: "192k",
  audioSampleRate: 48000,
} as const;

/**
 * Argumentos do encoder.
 *
 * Cada encoder tem seu proprio controle de qualidade — NVENC/QSV/AMF nao
 * entendem `-crf` — mas todos terminam no mesmo contrato: H.264 High,
 * nivel 4.1, taxa limitada por maxrate.
 */
export function videoEncoderArgs(encoder: string, fps: number = SOCIAL_PRESET.fps): string[] {
  const p = SOCIAL_PRESET;
  const gop = String(Math.round(fps * p.gopSeconds));

  // Todo player de celular decodifica High@4.1 em 1080p30. "41" e nao "4.1":
  // o QSV usa a opcao generica do FFmpeg, que e inteira, e "4.1" saia como
  // nivel 4.0 (conferido no ffprobe). Os outros encoders aceitam "41" tambem.
  const profile = ["-profile:v", "high", "-level:v", "41"];
  const rate = ["-maxrate", p.maxBitrate, "-bufsize", p.bufferSize];

  switch (encoder) {
    case "h264_nvenc":
      return ["-c:v", "h264_nvenc", "-preset", "p5", "-tune", "hq", "-rc", "vbr", "-cq", "19",
        "-b:v", p.videoBitrate, ...rate, ...profile, "-g", gop];
    case "h264_qsv":
      return ["-c:v", "h264_qsv", "-preset", "medium", "-look_ahead", "1",
        "-b:v", p.videoBitrate, ...rate, ...profile, "-g", gop];
    case "h264_amf":
      return ["-c:v", "h264_amf", "-quality", "quality", "-rc", "vbr_peak",
        "-b:v", p.videoBitrate, ...rate, ...profile, "-g", gop];
    default:
      // CRF 18 é visualmente transparente; o maxrate impede que uma cena
      // muito movimentada gere um pico que a plataforma cortaria.
      return ["-c:v", "libx264", "-preset", "medium", "-crf", "18",
        ...rate, ...profile, "-g", gop, "-keyint_min", gop];
  }
}

/** Argumentos comuns a qualquer encoder: frame rate, cor, áudio e container. */
export function containerArgs(hasAudio: boolean, fps: number = SOCIAL_PRESET.fps): string[] {
  const p = SOCIAL_PRESET;
  return [
    // Taxa constante: VFR vindo de gravação de celular dessincroniza áudio
    // depois da recompressão da plataforma.
    "-r", String(fps), "-fps_mode", "cfr",
    // Sem as tags BT.709 alguns celulares interpretam a cor como BT.601 e o
    // vídeo sai lavado. Estas flags sozinhas não bastam no QSV — quem garante
    // é o `setparams` no filter graph; aqui ficam para o container.
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    ...(hasAudio
      ? ["-c:a", "aac", "-b:a", p.audioBitrate, "-ar", String(p.audioSampleRate), "-ac", "2"]
      : ["-an"]),
    // moov no início: o upload começa a processar antes de o arquivo terminar
    // de chegar, e o preview no celular abre na hora.
    "-movflags", "+faststart",
    "-f", "mp4",
  ];
}
