"use client";

import { formatDateBR, PLATFORM_LABEL } from "@/lib/source";
import { formatDuration } from "@/lib/format";
import { aspectRatioStyle } from "@/lib/aspect";
import { JobStatus } from "@/lib/types";
import StatusBadge from "./StatusBadge";

export default function VideoCard({
  video,
  onClick,
  selected = false,
  onToggleSelect,
}: {
  video: {
    id: string;
    name: string;
    hasThumbnail: boolean;
    status: JobStatus;
    durationSeconds: number | null;
    aspectRatio: string | null;
    bytes: number;
    source: {
      username: string | null;
      videoDate: string | null;
      platform: string | null;
      originalUrl: string | null;
      identified: boolean;
    };
    createdAt: string;
  };
  onClick?: () => void;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const plataforma = video.source.platform ? (PLATFORM_LABEL[video.source.platform] ?? video.source.platform) : null;

  return (
    <article
      className={`card group relative overflow-hidden cursor-pointer transition flex flex-col ${
        selected ? "border-accent ring-1 ring-accent" : "hover:border-accent/50"
      }`}
      onClick={onClick}
    >
      <div
        className="relative w-full shrink-0 overflow-hidden bg-ink-850"
        style={aspectRatioStyle(video.aspectRatio)}
      >
        {video.hasThumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/videos/${video.id}/thumb`}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="grid h-full place-items-center text-[10px] text-ink-500">sem prévia</div>
        )}

        {/* Seleção para exclusão em lote. Fica sempre visível depois de marcada,
            para não se perder de vista ao rolar uma grade grande. */}
        {onToggleSelect && (
          <label
            className={`absolute left-1 top-1 flex h-6 w-6 items-center justify-center rounded-md bg-black/70 transition
                        ${selected ? "opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100"}`}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect(video.id)}
              className="h-3.5 w-3.5 accent-[#7c6cff]"
              aria-label={`Selecionar ${video.name}`}
            />
          </label>
        )}

        {/* Link para o post original. Só aparece quando a origem foi
            identificada pelo nome do arquivo — link inventado dá 404 e você
            só descobre clicando. */}
        {video.source.originalUrl && (
          <a
            href={video.source.originalUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            title={plataforma ? `Abrir no ${plataforma}` : "Abrir o post original"}
            aria-label={plataforma ? `Abrir no ${plataforma}` : "Abrir o post original"}
            className="absolute right-1 top-1 rounded-md bg-black/75 px-1.5 py-0.5 text-[11px] leading-none text-white/90
                       opacity-100 transition hover:bg-black focus-visible:outline focus-visible:outline-1
                       focus-visible:outline-accent sm:opacity-0 sm:group-hover:opacity-100"
          >
            ↗
          </a>
        )}

        {video.durationSeconds && (
          <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 text-[10px] text-white/90">
            {formatDuration(video.durationSeconds)}
          </span>
        )}
      </div>

      <div className="p-2 space-y-1">
        <div className="flex items-center gap-1.5">
          <StatusBadge status={video.status} />
          <h3 className="truncate text-xs font-medium" title={video.name}>
            {video.name}
          </h3>
        </div>

        {video.source.username && (
          <div className="flex items-center gap-1 text-[10px] text-ink-400">
            <span>@{video.source.username}</span>
            {video.source.videoDate && <span>· {formatDateBR(video.source.videoDate)}</span>}
          </div>
        )}
      </div>
    </article>
  );
}
