"use client";

import { useCallback, useEffect, useState } from "react";
import type { AppSettings } from "@/lib/settings";

interface CredentialStatus {
  source: "env" | "database" | "none";
  mask: string | null;
  updatedAt: string | null;
  canStoreInDatabase: boolean;
}

interface StatusPayload {
  warnings: string[];
  credential: CredentialStatus;
  settings: AppSettings;
  models: { suggestions: string[]; note: string };
  providers: {
    transcription: { name: string; available: boolean; detail: string };
    vision: { name: string; available: boolean; detail: string };
    search: { name: string; available: boolean; detail: string };
    media: { ffmpeg: boolean; ffprobe: boolean };
  };
  worker: { running: boolean; active: number };
}

interface TestResult {
  ok: boolean;
  model: string;
  message: string;
  durationMs: number | null;
  errorCode: string | null;
}

export default function SettingsForm() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [test, setTest] = useState<TestResult | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/status", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as StatusPayload;
    setStatus(data);
    setSettings(data.settings);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!settings || !status) return <p className="hint">Carregando configurações…</p>;

  function patch(update: (draft: AppSettings) => AppSettings) {
    setSettings((current) => (current ? update(structuredClone(current)) : current));
    setSaved(false);
  }

  async function save() {
    setBusy("save");
    setError(null);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(settings),
    });
    setBusy(null);
    if (!res.ok) {
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Falha ao salvar.");
      return;
    }
    const data = (await res.json()) as { settings: AppSettings };
    setSettings(data.settings);
    setSaved(true);
    void load();
  }

  async function saveKey() {
    setBusy("key");
    setError(null);
    const res = await fetch("/api/settings/credential", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey }),
    });
    setBusy(null);
    if (!res.ok) {
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Falha ao salvar a chave.");
      return;
    }
    setApiKey("");
    void load();
  }

  async function runTest() {
    setBusy("test");
    setTest(null);
    const res = await fetch("/api/settings/test-connection", { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as Partial<TestResult> & { error?: string };
    setBusy(null);
    setTest({
      ok: Boolean(data.ok),
      model: data.model ?? settings!.ghostcli.analysisModel,
      message: data.message ?? data.error ?? "Sem resposta.",
      durationMs: data.durationMs ?? null,
      errorCode: data.errorCode ?? null,
    });
  }

  const connectionLabel =
    status.credential.source === "env"
      ? "Credencial vinda de variável de ambiente"
      : status.credential.source === "database"
        ? "Credencial salva neste servidor"
        : "Nenhuma credencial configurada";

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-lg font-semibold">Configurações → IA → GhostCLI</h1>
        <p className="hint mt-1">
          Todas as chamadas partem do servidor. A chave nunca é devolvida para o navegador, nem em respostas da API
          interna.
        </p>
      </header>

      {status.warnings.length > 0 && (
        <section className="card border-amber-500/30 bg-amber-500/5 p-4 text-xs text-amber-200">
          <ul className="list-disc space-y-1 pl-4">
            {status.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="card space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`chip ${status.credential.source === "none" ? "border-red-500/40 text-red-300" : "border-emerald-500/40 text-emerald-300"}`}
          >
            {connectionLabel}
          </span>
          {status.credential.mask && <span className="chip font-mono">{status.credential.mask}</span>}
        </div>

        {status.credential.source !== "env" && (
          <div>
            <label className="label" htmlFor="apikey">
              Chave da API
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="apikey"
                type="password"
                className="field font-mono"
                placeholder="gcli_…"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <button className="btn-primary shrink-0" disabled={!apiKey || busy === "key"} onClick={() => void saveKey()}>
                {status.credential.source === "database" ? "Substituir" : "Salvar"}
              </button>
              {status.credential.source === "database" && (
                <button
                  className="btn-ghost shrink-0"
                  onClick={async () => {
                    await fetch("/api/settings/credential", { method: "DELETE" });
                    void load();
                  }}
                >
                  Remover
                </button>
              )}
            </div>
            <p className="hint mt-1">
              {status.credential.canStoreInDatabase
                ? "Guardada criptografada em repouso. Depois de salva só é possível substituir, nunca ler."
                : "SECRETS_MASTER_KEY não configurada: use a variável de ambiente GHOSTCLI_API_KEY."}
            </p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="analysisModel">
              Modelo para análise
            </label>
            <input
              id="analysisModel"
              className="field"
              list="model-suggestions"
              value={settings.ghostcli.analysisModel}
              onChange={(e) => patch((d) => ({ ...d, ghostcli: { ...d.ghostcli, analysisModel: e.target.value } }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="generationModel">
              Modelo para geração
            </label>
            <input
              id="generationModel"
              className="field"
              list="model-suggestions"
              value={settings.ghostcli.generationModel}
              onChange={(e) => patch((d) => ({ ...d, ghostcli: { ...d.ghostcli, generationModel: e.target.value } }))}
            />
          </div>
        </div>
        <datalist id="model-suggestions">
          {status.models.suggestions.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <p className="hint">{status.models.note}</p>

        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-ghost" disabled={busy === "test"} onClick={() => void runTest()}>
            {busy === "test" ? "Testando…" : "Testar conexão"}
          </button>
          {test && (
            <span className={`text-xs ${test.ok ? "text-emerald-300" : "text-red-300"}`}>
              {test.ok ? `OK · ${test.model} · ${test.durationMs}ms` : `${test.message}${test.errorCode ? ` [${test.errorCode}]` : ""}`}
            </span>
          )}
        </div>

        <details className="rounded-xl border border-ink-800 p-3">
          <summary className="cursor-pointer text-sm text-ink-300">Avançado</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label">Base URL</label>
              <input
                className="field font-mono"
                value={settings.ghostcli.baseUrl}
                onChange={(e) => patch((d) => ({ ...d, ghostcli: { ...d.ghostcli, baseUrl: e.target.value } }))}
              />
            </div>
            <div>
              <label className="label">Cabeçalho de autenticação</label>
              <select
                className="field"
                value={settings.ghostcli.authHeader}
                onChange={(e) =>
                  patch((d) => ({
                    ...d,
                    ghostcli: { ...d.ghostcli, authHeader: e.target.value as "authorization" | "x-api-key" },
                  }))
                }
              >
                <option value="authorization">Authorization: Bearer</option>
                <option value="x-api-key">x-api-key</option>
              </select>
            </div>
            <div>
              <label className="label">Timeout (ms)</label>
              <input
                type="number"
                className="field"
                value={settings.ghostcli.timeoutMs}
                onChange={(e) =>
                  patch((d) => ({ ...d, ghostcli: { ...d.ghostcli, timeoutMs: Number(e.target.value) } }))
                }
              />
            </div>
            <div>
              <label className="label">Tentativas extras</label>
              <input
                type="number"
                className="field"
                value={settings.ghostcli.maxRetries}
                onChange={(e) =>
                  patch((d) => ({ ...d, ghostcli: { ...d.ghostcli, maxRetries: Number(e.target.value) } }))
                }
              />
              <p className="hint mt-1">Só vale para falhas transitórias; 401/402/403 nunca são repetidos.</p>
            </div>
          </div>
        </details>
      </section>

      <section className="card space-y-4 p-4">
        <h2 className="text-sm font-medium">Geração</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label">Quantidade de CTAs</label>
            <input
              type="number"
              min={3}
              max={24}
              className="field"
              value={settings.generation.ctaCount}
              onChange={(e) =>
                patch((d) => ({ ...d, generation: { ...d.generation, ctaCount: Number(e.target.value) } }))
              }
            />
          </div>
          <div>
            <label className="label">Idioma</label>
            <input
              className="field"
              value={settings.generation.language}
              onChange={(e) =>
                patch((d) => ({ ...d, generation: { ...d.generation, language: e.target.value } }))
              }
            />
          </div>
          <div>
            <label className="label">Criatividade ({settings.generation.creativity.toFixed(2)})</label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              className="w-full"
              value={settings.generation.creativity}
              onChange={(e) =>
                patch((d) => ({ ...d, generation: { ...d.generation, creativity: Number(e.target.value) } }))
              }
            />
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["externalSearch", "Pesquisa externa para identificar a obra"],
              ["identifyWork", "Tentar identificar filme ou série"],
              ["analyzeExistingCta", "Analisar o CTA já presente no vídeo"],
              ["useExistingCtaAsReference", "Usar o CTA existente como referência"],
              ["spoilerPrevention", "Prevenção de spoilers"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 rounded-lg bg-ink-900/60 px-3 py-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[#7c6cff]"
                checked={settings.toggles[key]}
                onChange={(e) => patch((d) => ({ ...d, toggles: { ...d.toggles, [key]: e.target.checked } }))}
              />
              {label}
            </label>
          ))}
        </div>
        {settings.toggles.externalSearch && !status.providers.search.available && (
          <p className="text-xs text-amber-300">
            Nenhum provedor de pesquisa configurado (SEARCH_PROVIDER); a opção não terá efeito.
          </p>
        )}
      </section>

      <section className="card space-y-4 p-4">
        <h2 className="text-sm font-medium">Fila e limites</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <label className="label">Concorrência</label>
            <input
              type="number"
              min={1}
              max={8}
              className="field"
              value={settings.queue.concurrency}
              onChange={(e) => patch((d) => ({ ...d, queue: { concurrency: Number(e.target.value) } }))}
            />
          </div>
          <div>
            <label className="label">Tamanho máx. (MB)</label>
            <input
              type="number"
              className="field"
              value={settings.limits.maxFileSizeMb}
              onChange={(e) =>
                patch((d) => ({ ...d, limits: { ...d.limits, maxFileSizeMb: Number(e.target.value) } }))
              }
            />
          </div>
          <div>
            <label className="label">Duração máx. (s)</label>
            <input
              type="number"
              className="field"
              value={settings.limits.maxDurationSeconds}
              onChange={(e) =>
                patch((d) => ({ ...d, limits: { ...d.limits, maxDurationSeconds: Number(e.target.value) } }))
              }
            />
          </div>
          <div>
            <label className="label">Frames por vídeo</label>
            <input
              type="number"
              className="field"
              value={settings.limits.maxFramesPerVideo}
              onChange={(e) =>
                patch((d) => ({ ...d, limits: { ...d.limits, maxFramesPerVideo: Number(e.target.value) } }))
              }
            />
          </div>
        </div>
        <p className="hint">
          Os valores iniciais são conservadores. Meça na sua máquina antes de subir a concorrência: FFmpeg, OCR e
          transcrição competem pela mesma CPU.
        </p>
      </section>

      <section className="card space-y-4 p-4">
        <h2 className="text-sm font-medium">Retenção</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ["videoDays", "Vídeos (dias)"],
              ["transcriptDays", "Transcrições (dias)"],
              ["resultDays", "Resultados (dias)"],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <label className="label">{label}</label>
              <input
                type="number"
                className="field"
                value={settings.retention[key]}
                onChange={(e) => patch((d) => ({ ...d, retention: { ...d.retention, [key]: Number(e.target.value) } }))}
              />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-ghost"
            onClick={async () => {
              setBusy("retention");
              await fetch("/api/maintenance/retention", { method: "POST" });
              setBusy(null);
            }}
            disabled={busy === "retention"}
          >
            Aplicar retenção agora
          </button>
          <span className="hint">0 desativa a limpeza daquele item.</span>
        </div>
      </section>

      <section className="card space-y-2 p-4 text-sm">
        <h2 className="text-sm font-medium">Provedores locais</h2>
        <ProviderRow label="Transcrição" {...status.providers.transcription} />
        <ProviderRow label="Visão / OCR" {...status.providers.vision} />
        <ProviderRow label="Pesquisa" {...status.providers.search} />
        <ProviderRow
          label="FFmpeg"
          name={status.providers.media.ffmpeg && status.providers.media.ffprobe ? "ffmpeg + ffprobe" : "faltando"}
          available={status.providers.media.ffmpeg && status.providers.media.ffprobe}
          detail={status.providers.media.ffmpeg ? "" : "Instale o FFmpeg para processar vídeos."}
        />
        <p className="hint">
          Worker {status.worker.running ? "ativo" : "parado"} · {status.worker.active} job(s) em execução neste processo.
        </p>
      </section>

      <div className="sticky bottom-4 flex items-center gap-3">
        <button className="btn-primary" disabled={busy === "save"} onClick={() => void save()}>
          {busy === "save" ? "Salvando…" : "Salvar configurações"}
        </button>
        {saved && <span className="text-xs text-emerald-300">Salvo.</span>}
        {error && <span className="text-xs text-red-300">{error}</span>}
      </div>
    </div>
  );
}

function ProviderRow({
  label,
  name,
  available,
  detail,
}: {
  label: string;
  name: string;
  available: boolean;
  detail: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="w-28 text-ink-400">{label}</span>
      <span className={`chip ${available ? "border-emerald-500/40 text-emerald-300" : "border-ink-600 text-ink-400"}`}>
        {name}
      </span>
      {detail && <span className="text-ink-500">{detail}</span>}
    </div>
  );
}
