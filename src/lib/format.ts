export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds)) return "—";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

export function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

export const CONFIDENCE_LABEL: Record<string, string> = {
  high: "confiança alta",
  medium: "confiança média",
  low: "confiança baixa",
};

export const TEXT_KIND_LABEL: Record<string, string> = {
  possible_hook: "possível gancho",
  possible_subtitle: "possível legenda",
  possible_watermark: "possível marca d'água",
  possible_handle: "possível perfil",
  unknown: "não classificado",
};

export const REGION_LABEL: Record<string, string> = {
  top: "terço superior",
  middle: "centro",
  bottom: "terço inferior",
};
