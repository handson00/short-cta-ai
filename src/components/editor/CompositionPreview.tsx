"use client";

import type { ReactNode } from "react";
import type { EditorTemplateConfig } from "@/lib/types";
import { FULL_FRAME, type NormalizedRect } from "@/lib/editor/crop";
import { cropRegionTransform, croppedAspect, logoRect, placeVideoInSlot } from "@/lib/editor/template";

/**
 * Desenha a composicao final: fundo, video recortado no slot, overlay e logo.
 *
 * E o mesmo componente usado no editor de template e na aba de preview, de
 * proposito. Duas telas desenhando a mesma composicao por caminhos diferentes
 * e a forma mais facil de uma mentir sobre o resultado (spec §86).
 */
export default function CompositionPreview({
  config,
  crop,
  mediaSrc,
  mediaKind,
  posterSrc,
  videoWidth,
  videoHeight,
  displayHeight,
  children,
}: {
  config: EditorTemplateConfig;
  crop: NormalizedRect | null;
  mediaSrc: string | null;
  mediaKind: "video" | "image";
  posterSrc?: string;
  videoWidth: number;
  videoHeight: number;
  displayHeight: number;
  /** Camada de edição desenhada por cima (o retângulo arrastável). */
  children?: ReactNode;
}) {
  const scale = displayHeight / Math.max(1, config.canvasHeight);
  const displayWidth = config.canvasWidth * scale;

  const effectiveCrop = crop ?? FULL_FRAME;
  const placement = placeVideoInSlot(
    croppedAspect(effectiveCrop, videoWidth, videoHeight),
    config,
  );
  const cropTransform = cropRegionTransform(placement, effectiveCrop);
  const logo = logoRect(config);

  const asset = (name?: string) =>
    name ? `/api/editor/template-asset?file=${encodeURIComponent(name)}` : null;

  return (
    <div
      className="relative mx-auto shrink-0 overflow-hidden rounded-lg border border-ink-700"
      style={{
        width: displayWidth,
        height: displayHeight,
        backgroundColor: config.backgroundColor ?? "#0a0b0f",
      }}
    >
      {asset(config.background) && (
        <img
          src={asset(config.background)!}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}

      {/* Caixa do slot: recorta o que estoura em FILL. */}
      <div
        className="absolute overflow-hidden"
        style={{
          left: config.videoX * scale,
          top: config.videoY * scale,
          width: config.videoWidth * scale,
          height: config.videoHeight * scale,
        }}
      >
        {mediaSrc ? (
          // Caixa do encaixe: dentro dela a mídia inteira é ampliada e
          // deslocada, de modo que só a região do recorte apareça.
          <div
            className="absolute overflow-hidden"
            style={{
              left: (placement.x - config.videoX) * scale,
              top: (placement.y - config.videoY) * scale,
              width: placement.width * scale,
              height: placement.height * scale,
            }}
          >
            {mediaKind === "video" ? (
              <video
                src={mediaSrc}
                poster={posterSrc}
                controls={false}
                autoPlay
                loop
                muted
                playsInline
                className="absolute max-w-none"
                style={{
                  width: cropTransform.width * scale,
                  height: cropTransform.height * scale,
                  left: cropTransform.left * scale,
                  top: cropTransform.top * scale,
                }}
              />
            ) : (
              <img
                src={mediaSrc}
                alt=""
                className="absolute max-w-none"
                style={{
                  width: cropTransform.width * scale,
                  height: cropTransform.height * scale,
                  left: cropTransform.left * scale,
                  top: cropTransform.top * scale,
                }}
              />
            )}
          </div>
        ) : (
          <div className="grid h-full place-items-center bg-black/40 text-[10px] text-ink-500">
            selecione um vídeo
          </div>
        )}
      </div>

      {asset(config.overlay) && (
        <img
          src={asset(config.overlay)!}
          alt=""
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        />
      )}

      {asset(config.logo) && (
        // object-contain: a logo cabe na caixa sem deformar, igual ao
        // `force_original_aspect_ratio=decrease` que a exportação usa.
        <img
          src={asset(config.logo)!}
          alt=""
          className="pointer-events-none absolute object-contain"
          style={{
            left: logo.x * scale,
            top: logo.y * scale,
            width: logo.width * scale,
            height: logo.height * scale,
          }}
        />
      )}

      {children}
    </div>
  );
}
