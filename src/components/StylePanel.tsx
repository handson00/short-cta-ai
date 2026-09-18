"use client";

import { useCallback, useEffect, useState } from "react";
import type { VideoSummary } from "@/lib/viewTypes";
import CopyButton from "./CopyButton";

interface StyleExample {
  id: string;
  text: string;
  note: string | null;
  createdAt: string;
}

export default function StylePanel() {
  const [examples, setExamples] = useState<StyleExample[]>([]);
  const [max, setMax] = useState(20);
  const [videos, setVideos] = useState<VideoSummary[]>([]);
  const [draft, setDraft] = useState("");

  const load = useCallback(async () => {
    const [styleRes, videoRes] = await Promise.all([
      fetch("/api/style", { cache: "no-store" }),
      fetch("/api/videos", { cache: "no-store" }),
    ]);
    if (styleRes.ok) {
      const data = (await styleRes.json()) as { examples: StyleExample[]; max: number };
      setExamples(data.examples);
      setMax(data.max);
    }
    if (videoRes.ok) {
      const data = (await videoRes.json()) as { videos: VideoSummary[] };
      setVideos(data.videos);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(text: string) {
    if (!text.trim()) return;
    await fetch("/api/style", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    setDraft("");
    void load();
  }

  const chosen = videos.filter((v) => v.chosenText || v.favorite);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-lg font-semibold">Meu estilo</h1>
        <p className="hint mt-1">
          Os exemplos abaixo entram no contexto enviado ao modelo como referência de tom. Isso não treina modelo
          nenhum: é curadoria, com limite de {max} exemplos para o contexto não inchar.
        </p>
      </header>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-medium">
          Exemplos escolhidos ({examples.length}/{max})
        </h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className="field"
            placeholder="Escreva um CTA que represente seu estilo"
            maxLength={200}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void add(draft);
            }}
          />
          <button className="btn-primary shrink-0" disabled={!draft.trim()} onClick={() => void add(draft)}>
            Adicionar
          </button>
        </div>

        {examples.length === 0 ? (
          <p className="hint">Nenhum exemplo ainda. Escolher um CTA em um vídeo também o guarda aqui.</p>
        ) : (
          <ul className="space-y-1.5">
            {examples.map((example) => (
              <li key={example.id} className="flex items-center gap-2 rounded-lg bg-ink-900/60 p-2 text-sm">
                <span className="flex-1">{example.text}</span>
                <CopyButton text={example.text} compact />
                <button
                  className="btn-quiet px-2 py-1 text-xs"
                  onClick={async () => {
                    await fetch(`/api/style?id=${example.id}`, { method: "DELETE" });
                    void load();
                  }}
                >
                  Remover
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-medium">CTAs escolhidos e favoritos</h2>
        {chosen.length === 0 ? (
          <p className="hint">Nada escolhido ainda.</p>
        ) : (
          <ul className="space-y-2">
            {chosen.map((video) => (
              <li key={video.id} className="rounded-lg bg-ink-900/60 p-3">
                <p className="text-xs text-ink-500">{video.name}</p>
                <p className="mt-0.5 text-sm">{video.chosenText ?? video.recommendedCta?.text ?? "—"}</p>
                <div className="mt-2 flex gap-2">
                  {(video.chosenText ?? video.recommendedCta?.text) && (
                    <>
                      <CopyButton text={video.chosenText ?? video.recommendedCta!.text} compact />
                      <button
                        className="btn-quiet px-2 py-1 text-xs"
                        onClick={() => void add(video.chosenText ?? video.recommendedCta!.text)}
                      >
                        Usar como exemplo
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
