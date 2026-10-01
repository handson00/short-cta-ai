"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { EditorTemplateConfig, EditorTextStyle } from "@/lib/types";
import { FULL_FRAME, type NormalizedRect } from "@/lib/editor/crop";
import { cropRegionTransform, croppedAspect, logoRect, placeVideoInSlot } from "@/lib/editor/template";
import { textOpacityAt, type TextLayout } from "@/lib/editor/textLayout";
import { drawTextLayer, ensureTextFont } from "./textCanvas";
import {
  DEFAULT_EFFECTS,
  outputDuration,
  outputTimeAt,
  previewColorFilter,
  zoomRect,
  type EditorEffects,
} from "@/lib/editor/effects";

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
  effects,
  children,
}: {
  config: EditorTemplateConfig;
  crop: NormalizedRect | null;
  /** Efeitos do vídeo: mesma geometria da exportação (zoom, espelho), cor aproximada. */
  effects?: EditorEffects | null;
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
  // Começa mudo porque o navegador bloqueia autoplay com som; o botão liga.
  const [muted, setMuted] = useState(true);
  const audioMode = config.audio?.mode ?? "original";
  const scale = displayHeight / Math.max(1, config.canvasHeight);
  const displayWidth = config.canvasWidth * scale;

  const fx = effects ?? DEFAULT_EFFECTS;
  // Zoom como recorte menor em volta do centro — a mesma conta do filterGraph.
  const effectiveCrop = zoomRect(crop ?? FULL_FRAME, fx.zoom);

  // Mesmo motivo do feed de Exportações: `muted` é atributo no React e só vale
  // na criação do elemento; sem aplicar na propriedade, o botão de som não liga.
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.muted = muted || audioMode === "mute" || audioMode === "replace";
  }, [muted, audioMode, mediaSrc]);

  // Velocidade e corte de início/fim no vídeo que toca: a origem é tocada só
  // no trecho que entra na exportação, na velocidade dela.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || mediaKind !== "video") return;
    v.playbackRate = fx.speed;
    const onTime = () => {
      if (!Number.isFinite(v.duration)) return;
      const end = v.duration - fx.trimEnd;
      if (v.currentTime < fx.trimStart - 0.05 || v.currentTime >= end) v.currentTime = fx.trimStart;
    };
    const onRate = () => {
      // O navegador volta a velocidade para 1 ao trocar de mídia.
      if (v.playbackRate !== fx.speed) v.playbackRate = fx.speed;
    };
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onRate);
    onTime();
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onRate);
    };
  }, [mediaKind, mediaSrc, fx.speed, fx.trimStart, fx.trimEnd]);
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
          // Espelho nesta caixa, que contém exatamente a região recortada: é o
          // `hflip` depois do crop da exportação. Espelhar o <video> inteiro
          // mostraria outra região quando o recorte não é centralizado.
          <div
            className="absolute overflow-hidden"
            style={{
              left: (placement.x - config.videoX) * scale,
              top: (placement.y - config.videoY) * scale,
              width: placement.width * scale,
              height: placement.height * scale,
              transform: fx.mirror ? "scaleX(-1)" : undefined,
              filter: previewColorFilter(fx),
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
                muted={muted || audioMode === "mute" || audioMode === "replace"}
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
          effects={fx}
        />
      )}

      {children}

      {mediaKind === "video" && mediaSrc && (
        <button
          type="button"
          onClick={() => {
            setMuted((m) => !m);
            // Clique do usuário: agora o navegador deixa tocar com som.
            void videoRef.current?.play().catch(() => {});
          }}
          disabled={audioMode === "mute" || audioMode === "replace"}
          title={
            audioMode === "mute"
              ? "O template está com o áudio mudo"
              : audioMode === "replace"
                ? "O template troca o áudio pela música; a música só existe no arquivo exportado"
                : muted
                  ? "Ligar o som"
                  : "Desligar o som"
          }
          className="absolute bottom-2 right-2 z-10 rounded-full bg-black/70 px-2.5 py-1 text-sm text-white transition hover:bg-black/90 disabled:opacity-50"
        >
          {muted || audioMode === "mute" || audioMode === "replace" ? "🔇" : "🔊"}
        </button>
      )}
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
  effects,
}: {
  text: string;
  style: EditorTextStyle;
  scale: number;
  videoRef: RefObject<HTMLVideoElement | null> | null;
  onLayout?: (layout: TextLayout | null) => void;
  /** O texto é temporizado no tempo do vídeo exportado (cortado e acelerado). */
  effects: EditorEffects;
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
      if (v && Number.isFinite(v.duration)) {
        setOpacity(textOpacityAt(outputTimeAt(v.currentTime, effects), style, outputDuration(v.duration, effects)));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timed, videoRef, styleKey, effects.trimStart, effects.trimEnd, effects.speed]);

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
