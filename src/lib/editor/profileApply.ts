import { getVideo, type VideoRecord } from "../repo";
import { getSourceProfile, getVideoCrop, saveVideoCrops } from "../editorRepo";
import type { SourceProfile } from "../types";
import {
  aspectCompatible,
  aspectLabel,
  aspectOf,
  DIVERGENCE_IOU,
  originKeyOf,
  rectIoU,
  type ProfileVideo,
} from "./profile";

/** O que a regra do perfil precisa de um vídeo do acervo. */
export function profileVideoOf(video: VideoRecord): ProfileVideo {
  return {
    platform: video.platform,
    username: video.tiktokUsername,
    sourceFolder: video.sourceFolder,
    width: video.width,
    height: video.height,
  };
}

export interface ApplyProfileResult {
  applied: string[];
  /** Não receberam o perfil, cada um com o motivo. */
  skipped: Array<{ videoId: string; reason: string }>;
  /** Receberam, mas a detecção automática que tinham apontava outra moldura. */
  divergent: Array<{ videoId: string; iou: number }>;
  /** Receberam, mas são de outra página — o usuário os escolheu mesmo assim. */
  otherPage: string[];
}

/**
 * Aplica o recorte de um perfil a vários vídeos (spec §104: "aplicar
 * selecionados"), numa transação.
 *
 * - **Proporção diferente não recebe.** O recorte é normalizado: num vídeo de
 *   outra proporção o mesmo retângulo aponta para outra região e cortaria o
 *   filme. Pular e dizer por quê é melhor que gravar um recorte errado.
 * - **Recorte manual só é trocado com `replaceManual`.** É trabalho do usuário;
 *   um lote não o apaga por baixo. Automático e de outro perfil são trocados —
 *   pela §90, perfil conhecido vem antes do Smart Crop.
 * - **Divergência é relatada, não bloqueia.** Se a detecção automática já
 *   gravada no vídeo discorda do perfil, o perfil vence (é para isso que ele
 *   existe: moldura animada engana a detecção), mas a tela diz quais revisar.
 */
export function applySourceProfile(
  profileId: string,
  videoIds: string[],
  opts: { replaceManual?: boolean } = {},
): ApplyProfileResult | null {
  const profile = getSourceProfile(profileId);
  if (!profile) return null;

  const result: ApplyProfileResult = { applied: [], skipped: [], divergent: [], otherPage: [] };
  const rect = { x: profile.cropX, y: profile.cropY, width: profile.cropW, height: profile.cropH };

  for (const videoId of [...new Set(videoIds)]) {
    const video = getVideo(videoId);
    if (!video) {
      result.skipped.push({ videoId, reason: "Vídeo não encontrado." });
      continue;
    }
    const reason = incompatibility(profile, video);
    if (reason) {
      result.skipped.push({ videoId, reason });
      continue;
    }

    const current = getVideoCrop(videoId);
    if (current?.source === "manual" && !opts.replaceManual) {
      result.skipped.push({ videoId, reason: "Já tem recorte manual; mantido." });
      continue;
    }
    if (current?.source === "auto") {
      const iou = rectIoU(current, rect);
      if (iou < DIVERGENCE_IOU) result.divergent.push({ videoId, iou: Math.round(iou * 100) / 100 });
    }
    if (profile.originKey && originKeyOf(profileVideoOf(video)) !== profile.originKey) {
      result.otherPage.push(videoId);
    }
    result.applied.push(videoId);
  }

  if (result.applied.length > 0) {
    saveVideoCrops(result.applied, {
      ...rect,
      normalized: true,
      source: "profile",
      profileId: profile.id,
    });
  }
  return result;
}

function incompatibility(profile: SourceProfile, video: VideoRecord): string | null {
  const aspect = aspectOf(video.width, video.height);
  if (aspect === null) return "Resolução do vídeo desconhecida; rode a análise antes.";
  // Perfil sem proporção gravada (criado fora da tela) não tem como ser
  // conferido: melhor recusar do que presumir.
  if (!aspectCompatible(profile.aspect, aspect)) {
    return `O perfil foi desenhado em ${aspectLabel(profile.aspect)}; este vídeo é ${aspectLabel(aspect)}.`;
  }
  return null;
}
