"use client";

import { useRef } from "react";
import { resizeRect, type CropDirection, type NormalizedRect } from "@/lib/editor/crop";

const HANDLES: Array<{ dir: CropDirection; className: string; cursor: string }> = [
  { dir: "nw", className: "left-0 top-0 -translate-x-1/2 -translate-y-1/2", cursor: "nwse-resize" },
  { dir: "n", className: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2", cursor: "ns-resize" },
  { dir: "ne", className: "right-0 top-0 translate-x-1/2 -translate-y-1/2", cursor: "nesw-resize" },
  { dir: "e", className: "right-0 top-1/2 translate-x-1/2 -translate-y-1/2", cursor: "ew-resize" },
  { dir: "se", className: "right-0 bottom-0 translate-x-1/2 translate-y-1/2", cursor: "nwse-resize" },
  { dir: "s", className: "left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2", cursor: "ns-resize" },
  { dir: "sw", className: "left-0 bottom-0 -translate-x-1/2 translate-y-1/2", cursor: "nesw-resize" },
  { dir: "w", className: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2", cursor: "ew-resize" },
];

/**
 * Retangulo de recorte sobre o video, em coordenadas normalizadas (0..1).
 *
 * Trabalha em fracao, nao em pixel, porque o mesmo recorte precisa valer para
 * o preview reduzido e para o arquivo em 1080x1920 (spec §24).
 */
export default function CropOverlay({
  rect,
  onChange,
  minSize,
  mask = true,
}: {
  rect: NormalizedRect;
  onChange: (r: NormalizedRect) => void;
  /** Menor lado permitido, em fração. A logo precisa de bem menos que o recorte. */
  minSize?: number;
  /** Escurecer o que fica de fora. Faz sentido no recorte; no template, atrapalha. */
  mask?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  function startDrag(event: React.PointerEvent, dir: CropDirection) {
    event.preventDefault();
    event.stopPropagation();

    const box = rootRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return;

    const startRect = rect;
    const startX = event.clientX;
    const startY = event.clientY;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);

    function onMove(e: PointerEvent) {
      onChange(
        resizeRect(
          startRect,
          dir,
          (e.clientX - startX) / box!.width,
          (e.clientY - startY) / box!.height,
          minSize,
        ),
      );
    }

    function onUp(e: PointerEvent) {
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
    }

    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  }

  const pct = (v: number) => `${(v * 100).toFixed(4)}%`;

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0 touch-none">
      <div
        className="pointer-events-auto absolute cursor-move border-2 border-accent"
        style={{
          left: pct(rect.x),
          top: pct(rect.y),
          width: pct(rect.width),
          height: pct(rect.height),
          // Escurece tudo que ficara de fora, sem precisar de quatro divs de mascara.
          boxShadow: mask ? "0 0 0 9999px rgba(0,0,0,0.55)" : undefined,
        }}
        onPointerDown={(e) => startDrag(e, "move")}
      >
        <div className="absolute inset-0 border border-white/20" />
        {HANDLES.map((h) => (
          <div
            key={h.dir}
            role="presentation"
            onPointerDown={(e) => startDrag(e, h.dir)}
            style={{ cursor: h.cursor }}
            className={`absolute h-3 w-3 rounded-sm border border-ink-950 bg-accent ${h.className}`}
          />
        ))}
      </div>
    </div>
  );
}
