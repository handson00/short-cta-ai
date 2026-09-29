"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { EditorTemplateConfig, EditorTextStyle } from "@/lib/types";
import { FULL_FRAME, type NormalizedRect } from "@/lib/editor/crop";
import { cropRegionTransform, croppedAspect, logoRect, placeVideoInSlot } from "@/lib/editor/template";
import { textOpacityAt, type TextLayout } from "@/lib/editor/textLayout";
import { drawTextLayer, ensureTextFont } from "./textCanvas";

/**
 * Desenha a composicao final: fundo, video recortado no slot, overlay, logo e
 * texto.
 *
 * E o mesmo componente usado no editor de template e na aba de preview, de
 * proposito. Duas telas desenhando a mesma composicao por caminhos diferentes
 * e a forma mais facil de uma mentir sobre o resultado (spec §86). O texto sai
 * de `drawTextLayer`, a mesma funcao que gera a camada da exportacao.
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
  text,
  onTextLayout,
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
  /** Texto deste vídeo; só aparece se o template tiver a camada de texto ligada. */
  text?: string | null;
  /** Avisa quem mostra a composição se o texto coube na caixa. */
  onTextLayout?: (layout: TextLayout | null) => void;
  /** Camada de edição desenhada por cima (o retângulo arrastável). */
  children?: ReactNode;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scale = displayHeight / Math.max(1, config.canvasHeight);
  const displayWidth = config.canvasWidth * scale;

  const effectiveCrop = crop ?? FULL_FRAME;
  const placement = placeVideoInSlot(
    croppedAspect(effectiveCrop, videoWidth, videoHeight),
    config,
  );
  const cropTransform = cropRegionTransform(placement, effectiveCrop);
  const logo = logoRect(config);
  const showText = Boolean(config.text?.enabled && text?.trim());

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
                ref={videoRef}
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

      {showText && config.text && (
        <TextLayerCanvas
          text={text!}
          style={config.text}
          scale={scale}
          videoRef={mediaKind === "video" ? videoRef : null}
          onLayout={onTextLayout}
        />
      )}

      {children}
    </div>
  );
}

/**
 * A camada de texto na resolução real da caixa, reduzida por CSS — os mesmos
 * pixels que irão para a exportação. Com vídeo tocando, a opacidade segue o
 * tempo dele pela mesma regra dos filtros `fade` do FFmpeg.
 */
function TextLayerCanvas({
  text,
  style,
  scale,
  videoRef,
  onLayout,
}: {
  text: string;
  style: EditorTextStyle;
  scale: number;
  videoRef: RefObject<HTMLVideoElement | null> | null;
  onLayout?: (layout: TextLayout | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [opacity, setOpacity] = useState(1);
  const styleKey = JSON.stringify(style);

  useEffect(() => {
    let cancelled = false;
    ensureTextFont(style)
      .catch(() => {
        // Fonte que não carrega cai na reserva do navegador; o desenho segue.
      })
      .then(() => {
        if (cancelled || !canvasRef.current) return;
        onLayout?.(drawTextLayer(canvasRef.current, text, style));
      });
    return () => {
      cancelled = true;
    };
    // styleKey cobre o objeto de estilo inteiro sem redesenhar a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, styleKey]);

  const timed = style.start > 0 || style.end !== null || style.fadeIn > 0 || style.fadeOut > 0;
  useEffect(() => {
    if (!timed || !videoRef) {
      setOpacity(1);
      return;
    }
    let frame = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v && Number.isFinite(v.duration)) setOpacity(textOpacityAt(v.currentTime, style, v.duration));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timed, videoRef, styleKey]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute"
      style={{
        left: style.x * scale,
        top: style.y * scale,
        width: style.width * scale,
        height: style.height * scale,
        opacity,
      }}
    />
  );
}
