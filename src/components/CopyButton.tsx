"use client";

import { useState } from "react";

export default function CopyButton({
  text,
  compact = false,
  label,
}: {
  text: string;
  compact?: boolean;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Navegadores sem permissao de area de transferencia: seleciona via fallback.
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button className={compact ? "btn-quiet px-2 py-1 text-xs" : "btn-ghost"} onClick={() => void copy()}>
      {copied ? "Link copiado!" : label ?? "Copiar"}
    </button>
  );
}
