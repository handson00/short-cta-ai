import { describe, expect, it } from "vitest";
import { containerArgs, SOCIAL_PRESET, videoEncoderArgs } from "../src/lib/editor/exportPreset";

/**
 * O arquivo exportado é matéria-prima da recompressão do Reels e do TikTok.
 * Estes testes travam o contrato de compatibilidade: se um deles quebrar, o
 * vídeo pode ser recusado pela plataforma, sair com cor lavada ou dessincronizar.
 */

const ENCODERS = ["libx264", "h264_nvenc", "h264_qsv", "h264_amf"];

function valueAfter(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

describe("encoder de vídeo", () => {
  it.each(ENCODERS)("%s sai em H.264 High, nível 4.1", (enc) => {
    const args = videoEncoderArgs(enc);
    expect(valueAfter(args, "-profile:v")).toBe("high");
    expect(valueAfter(args, "-level:v")).toBe("41");
  });

  it.each(ENCODERS)("%s tem teto de bitrate, para não gerar pico que a plataforma corta", (enc) => {
    const args = videoEncoderArgs(enc);
    expect(valueAfter(args, "-maxrate")).toBe(SOCIAL_PRESET.maxBitrate);
    expect(valueAfter(args, "-bufsize")).toBe(SOCIAL_PRESET.bufferSize);
  });

  it.each(ENCODERS)("%s tem keyframe a cada 2 segundos", (enc) => {
    expect(valueAfter(videoEncoderArgs(enc, 30), "-g")).toBe("60");
  });

  it("o GOP acompanha o frame rate", () => {
    expect(valueAfter(videoEncoderArgs("libx264", 60), "-g")).toBe("120");
  });

  it("encoder de GPU não recebe -crf, que ele não entende", () => {
    for (const enc of ["h264_nvenc", "h264_qsv", "h264_amf"]) {
      expect(videoEncoderArgs(enc)).not.toContain("-crf");
    }
  });

  it("encoder desconhecido cai no libx264, em vez de montar um comando inválido", () => {
    expect(valueAfter(videoEncoderArgs("inexistente"), "-c:v")).toBe("libx264");
  });
});

describe("container e áudio", () => {
  it("frame rate constante: VFR dessincroniza o áudio depois da recompressão", () => {
    const args = containerArgs(true);
    expect(valueAfter(args, "-fps_mode")).toBe("cfr");
    expect(valueAfter(args, "-r")).toBe("30");
  });

  it("marca a cor como BT.709, senão alguns celulares mostram lavado", () => {
    const args = containerArgs(true);
    expect(valueAfter(args, "-colorspace")).toBe("bt709");
    expect(valueAfter(args, "-color_primaries")).toBe("bt709");
    expect(valueAfter(args, "-color_trc")).toBe("bt709");
  });

  it("áudio AAC estéreo a 48 kHz", () => {
    const args = containerArgs(true);
    expect(valueAfter(args, "-c:a")).toBe("aac");
    expect(valueAfter(args, "-ar")).toBe("48000");
    expect(valueAfter(args, "-ac")).toBe("2");
  });

  it("sem trilha de áudio, não inventa uma", () => {
    const args = containerArgs(false);
    expect(args).toContain("-an");
    expect(args).not.toContain("-c:a");
  });

  it("MP4 com faststart e formato explícito (o temporário termina em .processing)", () => {
    const args = containerArgs(true);
    expect(valueAfter(args, "-movflags")).toBe("+faststart");
    expect(valueAfter(args, "-f")).toBe("mp4");
  });
});
