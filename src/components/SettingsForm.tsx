"use client";

import { useCallback, useEffect, useState } from "react";
import type { AppSettings } from "@/lib/settings";

interface CredentialStatus {
  source: "env" | "database" | "none";
  mask: string | null;
  updatedAt: string | null;
  canStoreInDatabase: boolean;
}

type ProviderId = AppSettings["ai"]["provider"];

/** Um dos três modelos principais do Gemini (básico, médio, avançado). */
interface ModelOption {
  id: string;
  tier: string;
  displayName: string;
  hint: string;
  /** Etapas em que este é o sugerido: faz o trabalho gastando menos cota. */
  recommendedFor: Array<"analysis" | "generation">;
  freeTier: boolean;
  /** Conferido na conta; nulo quando não deu para conferir (motivo à parte). */
  available: boolean | null;
}

interface StatusPayload {
  warnings: string[];
  credential: CredentialStatus;
  credentials: Record<ProviderId, CredentialStatus>;
  settings: AppSettings;
  models: { suggestions: string[]; note: string };
  providers: {
    transcription: { name: string; available: boolean; detail: string };
    vision: { name: string; available: boolean; detail: string };
    search: { name: string; available: boolean; detail: string };
    media: { ffmpeg: boolean; ffprobe: boolean };
  };
  worker: { running: boolean; active: number };
  /** Pasta que de fato recebe os MP4 exportados (a configurada, ou a padrão). */
  outputDirInUse: string;
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
  /** Provedor como está SALVO — o rascunho em `settings` pode ainda não estar. */
  const [savedProvider, setSavedProvider] = useState<ProviderId | null>(null);
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
    setSavedProvider(data.settings.ai.provider);
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
      body: JSON.stringify({ apiKey, provider: "ghostcli" }),
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
    const res = await fetch("/api/settings/test-connection", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "ghostcli" }),
    });
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

  const ghostCredential = status.credentials.ghostcli;
  const connectionLabel = credentialLabel(ghostCredential);
  const provider = settings.ai.provider;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-lg font-semibold">Configurações → IA</h1>
        <p className="hint mt-1">
          Todas as chamadas partem do servidor. A chave nunca é devolvida para o navegador, nem em respostas da API
          interna.
        </p>
      </header>

      {status.warnings.length > 0 && (
        <section className="card border-amber-500/30 bg-amber-500/5 p-4 text-xs text-amber-200">
          <ul className="list-disc space-y-1 pl-4">
            {status.warnings.map((w: any) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-medium">Provedor de IA</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["ghostcli", "GhostCLI", "Pago por chamada. Modelos Claude e outros.", status.credentials.ghostcli],
              ["gemini", "Google Gemini", "Modelos com plano gratuito, dentro da cota da sua conta.", status.credentials.gemini],
            ] as const
          ).map(([id, label, desc, cred]) => (
            <label
              key={id}
              className={`flex cursor-pointer gap-3 rounded-xl border p-3 text-sm transition ${
                provider === id ? "border-accent bg-accent/10" : "border-ink-800 hover:border-ink-600"
              }`}
            >
              <input
                type="radio"
                name="ai-provider"
                className="mt-1 h-4 w-4 accent-[#7c6cff]"
                checked={provider === id}
                onChange={() => patch((d) => ({ ...d, ai: { provider: id } }))}
              />
              <span>
                <span className="font-medium">{label}</span>
                {savedProvider === id && <span className="chip ml-2 border-emerald-500/40 text-emerald-300">em uso</span>}
                <span className="mt-0.5 block text-xs text-ink-400">{desc}</span>
                <span className={`mt-1 block text-xs ${cred.source === "none" ? "text-red-300" : "text-ink-500"}`}>
                  {credentialLabel(cred)}
                </span>
              </span>
            </label>
          ))}
        </div>
        {provider !== savedProvider && (
          <p className="text-xs text-amber-300">
            Troca ainda não salva: clique em &quot;Salvar configurações&quot; no fim da página. Até lá, a análise continua
            usando o {savedProvider === "gemini" ? "Google Gemini" : "GhostCLI"}.
          </p>
        )}
        <p className="hint">
          Se o provedor escolhido falhar ou ficar sem cota, o sistema mostra o erro e para — nunca passa para o outro
          sozinho.
        </p>
      </section>

      {provider === "gemini" && (
        <GeminiSection
          settings={settings}
          savedAnalysisModel={status.settings.gemini.analysisModel}
          credential={status.credentials.gemini}
          patch={patch}
          onCredentialChanged={() => void load()}
        />
      )}

      {provider === "ghostcli" && (
      <section className="card space-y-4 p-4">
        <h2 className="text-sm font-medium">GhostCLI</h2>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`chip ${ghostCredential.source === "none" ? "border-red-500/40 text-red-300" : "border-emerald-500/40 text-emerald-300"}`}
          >
            {connectionLabel}
          </span>
          {ghostCredential.mask && <span className="chip font-mono">{ghostCredential.mask}</span>}
        </div>

        {ghostCredential.source !== "env" && (
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
                {ghostCredential.source === "database" ? "Substituir" : "Salvar"}
              </button>
              {ghostCredential.source === "database" && (
                <button
                  className="btn-ghost shrink-0"
                  onClick={async () => {
                    await fetch("/api/settings/credential?provider=ghostcli", { method: "DELETE" });
                    void load();
                  }}
                >
                  Remover
                </button>
              )}
            </div>
            <p className="hint mt-1">
              {ghostCredential.canStoreInDatabase
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
          {status.models.suggestions.map((m: any) => (
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
      )}

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
              ["aiOnImport", "Gerar CTAs automaticamente ao importar (gasta chamadas pagas em todo vídeo importado)"],
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
            <label className="label">Transcrevendo em paralelo</label>
            <input
              type="number"
              min={1}
              max={8}
              className="field"
              value={settings.queue.concurrency}
              onChange={(e) => patch((d) => ({ ...d, queue: { ...d.queue, concurrency: Number(e.target.value) } }))}
            />
            <p className="hint mt-1">Pesa na CPU: os vídeos dividem os mesmos núcleos.</p>
          </div>
          <div>
            <label className="label">Gerando CTAs em paralelo</label>
            <input
              type="number"
              min={1}
              max={8}
              className="field"
              value={settings.queue.aiConcurrency}
              onChange={(e) => patch((d) => ({ ...d, queue: { ...d.queue, aiConcurrency: Number(e.target.value) } }))}
            />
            <p className="hint mt-1">
              {provider === "gemini"
                ? "Com o Google Gemini fica em 1, qualquer que seja o valor: o plano gratuito tem limite baixo por minuto."
                : "Só espera a IA responder; não disputa a CPU com a transcrição."}
            </p>
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

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-medium">Pasta dos vídeos exportados</h2>
        <div>
          <label className="label" htmlFor="outputDir">
            Caminho completo no seu computador
          </label>
          <input
            id="outputDir"
            className="field font-mono"
            placeholder={status.outputDirInUse}
            value={settings.paths.outputDir}
            onChange={(e) => patch((d) => ({ ...d, paths: { ...d.paths, outputDir: e.target.value } }))}
          />
          <p className="hint mt-1">
            Ex.: <span className="font-mono">E:\Videos\Prontos</span>. A pasta é criada se não existir e é testada ao
            salvar — caminho sem permissão de escrita não é aceito. Vazio = a padrão do projeto.
          </p>
          <p className="hint mt-1">
            Gravando agora em: <span className="font-mono text-ink-300">{status.outputDirInUse}</span>
          </p>
          <p className="hint mt-1">
            Só vale para os vídeos exportados depois da mudança; os que já saíram ficam onde estão.
          </p>
        </div>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="text-sm font-medium">Legenda em japonês</h2>
        <label className="flex items-center gap-2 rounded-lg bg-ink-900/60 px-3 py-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[#7c6cff]"
            checked={settings.publish.japaneseCaption}
            onChange={(e) =>
              patch((d) => ({ ...d, publish: { ...d.publish, japaneseCaption: e.target.checked } }))
            }
          />
          Gerar também uma legenda em japonês na página de Exportações
        </label>
        <div>
          <label className="label" htmlFor="jpHashtag">
            Hashtag que abre a legenda
          </label>
          <input
            id="jpHashtag"
            className="field font-mono"
            value={settings.publish.japaneseHashtag}
            onChange={(e) =>
              patch((d) => ({ ...d, publish: { ...d.publish, japaneseHashtag: e.target.value } }))
            }
          />
          <p className="hint mt-1">
            Ela sempre entra na primeira linha, mesmo que o modelo esqueça. Campo vazio volta para a padrão.
          </p>
        </div>
        <p className="hint">
          Ligado, cada &ldquo;gerar&rdquo; na página de Exportações faz <strong>2 chamadas</strong> à IA por vídeo (as
          hashtags e a legenda) em vez de 1.
        </p>
        <p className="hint">
          A hashtag padrão é de anime japonês. Num corte que não é anime, ela classifica o vídeo como outra coisa — a
          plataforma usa hashtag para classificar o conteúdo, e hashtag fora do assunto pode reduzir o alcance em vez
          de aumentar. É uma escolha sua; o sistema só não promete resultado.
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

      <section className="card space-y-4 p-4">
        <h2 className="text-sm font-medium">Integração com extensão de comentários</h2>
        <p className="hint">
          Token usado pela extensão do navegador para enviar comentários capturados. A extensão não tem sessão do app,
          então este token é a única credencial aceita pelo endpoint de ingestão.
        </p>

        <IngestTokenManager busy={busy} setBusy={setBusy} setError={setError} />
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

function credentialLabel(cred: CredentialStatus): string {
  if (cred.source === "env") return `Chave vinda de variável de ambiente${cred.mask ? ` (${cred.mask})` : ""}`;
  if (cred.source === "database") return `Chave salva neste servidor${cred.mask ? ` (${cred.mask})` : ""}`;
  return "Nenhuma chave configurada";
}

/**
 * Google Gemini: chave, lista de modelos da conta e teste de conexão.
 *
 * A lista vem da conta pela rota `/api/settings/models`. Quando ela falha, o
 * motivo aparece em vermelho junto com a lista de reserva — uma chave errada
 * não pode parecer "conta sem modelos".
 */
function GeminiSection({
  settings,
  savedAnalysisModel,
  credential,
  patch,
  onCredentialChanged,
}: {
  settings: AppSettings;
  /** Modelo de análise como está SALVO: o teste de conexão usa o salvo, não o rascunho. */
  savedAnalysisModel: string;
  credential: CredentialStatus;
  patch: (update: (draft: AppSettings) => AppSettings) => void;
  onCredentialChanged: () => void;
}) {
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);

  const loadModels = useCallback(async () => {
    setBusy("models");
    try {
      const res = await fetch("/api/settings/models?provider=gemini", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as {
        models?: ModelOption[];
        note?: string;
        error?: string | null;
      };
      if (!res.ok) {
        setListError(data.error ?? `Falha ao carregar a lista (HTTP ${res.status}).`);
        return;
      }
      setModels(data.models ?? []);
      setNote(data.note ?? null);
      setListError(data.error ?? null);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Falha ao carregar a lista.");
    } finally {
      setBusy(null);
    }
  }, []);

  // Recarrega quando a chave muda: a lista é a da conta daquela chave.
  useEffect(() => {
    void loadModels();
  }, [loadModels, credential.source, credential.mask]);

  async function saveKey() {
    setBusy("key");
    setKeyError(null);
    const res = await fetch("/api/settings/credential", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: keyInput, provider: "gemini" }),
    });
    setBusy(null);
    if (!res.ok) {
      setKeyError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Falha ao salvar a chave.");
      return;
    }
    setKeyInput("");
    setTest(null);
    onCredentialChanged();
  }

  async function removeKey() {
    setBusy("key");
    await fetch("/api/settings/credential?provider=gemini", { method: "DELETE" });
    setBusy(null);
    setTest(null);
    onCredentialChanged();
  }

  async function runTest() {
    setBusy("test");
    setTest(null);
    const res = await fetch("/api/settings/test-connection", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "gemini" }),
    });
    const data = (await res.json().catch(() => ({}))) as Partial<TestResult> & { error?: string };
    setBusy(null);
    setTest({
      ok: Boolean(data.ok),
      model: data.model ?? savedAnalysisModel,
      message: data.message ?? data.error ?? "Sem resposta.",
      durationMs: data.durationMs ?? null,
      errorCode: data.errorCode ?? null,
    });
  }

  /**
   * O modelo salvo sempre aparece, mesmo fora dos três principais (escolhido
   * antes da lista encurtar): sumir com ele faria o select mostrar outro
   * modelo sem o usuário ter trocado.
   */
  function optionsWith(current: string): ModelOption[] {
    if (!current || models.some((m) => m.id === current)) return models;
    return [
      ...models,
      { id: current, tier: "Atual", displayName: current, hint: "fora dos principais", recommendedFor: [], freeTier: false, available: null },
    ];
  }

  function optionLabel(m: ModelOption, task: "analysis" | "generation"): string {
    const parts = [`${m.recommendedFor.includes(task) ? "★ Recomendado · " : ""}${m.tier} — ${m.displayName}`];
    if (m.hint) parts.push(m.hint);
    if (m.freeTier) parts.push("gratuito");
    if (m.available === false) parts.push("NÃO disponível na sua conta");
    return parts.join(" · ");
  }

  const modelSelect = (key: "analysisModel" | "generationModel", label: string, id: string) => {
    const task = key === "analysisModel" ? "analysis" : "generation";
    const recommended = models.find((m) => m.recommendedFor.includes(task));
    return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="field"
        value={settings.gemini[key]}
        onChange={(e) => patch((d) => ({ ...d, gemini: { ...d.gemini, [key]: e.target.value } }))}
      >
        {optionsWith(settings.gemini[key]).map((m) => (
          <option key={m.id} value={m.id}>
            {optionLabel(m, task)}
          </option>
        ))}
      </select>
      {recommended && settings.gemini[key] !== recommended.id && (
        <p className="mt-1 text-[11px] text-amber-300">
          Recomendado para esta etapa: {recommended.tier} ({recommended.id}).{" "}
          <button
            type="button"
            className="text-accent underline hover:text-accent/80"
            onClick={() => patch((d) => ({ ...d, gemini: { ...d.gemini, [key]: recommended.id } }))}
          >
            Usar o recomendado
          </button>
        </p>
      )}
    </div>
    );
  };

  const hasKey = credential.source !== "none";

  return (
    <section className="card space-y-4 p-4">
      <h2 className="text-sm font-medium">Google Gemini</h2>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
        No plano gratuito, o Google pode usar o que é enviado (transcrições, texto lido na tela, comentários) para
        melhorar os produtos dele, com revisão humana. O plano gratuito também tem cota por minuto e por dia; quando
        ela acaba, o vídeo mostra o erro de cota e pode ser tentado de novo depois.
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`chip ${hasKey ? "border-emerald-500/40 text-emerald-300" : "border-red-500/40 text-red-300"}`}
        >
          {credentialLabel(credential)}
        </span>
      </div>

      {credential.source !== "env" && (
        <div>
          <label className="label" htmlFor="gemini-key">
            Chave da API do Gemini
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="gemini-key"
              type="password"
              className="field font-mono"
              placeholder="AIza…"
              autoComplete="off"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
            />
            <button
              className="btn-primary shrink-0"
              disabled={!keyInput.trim() || busy === "key"}
              onClick={() => void saveKey()}
            >
              {credential.source === "database" ? "Substituir" : "Salvar chave"}
            </button>
            {credential.source === "database" && (
              <button className="btn-ghost shrink-0" disabled={busy === "key"} onClick={() => void removeKey()}>
                Remover
              </button>
            )}
          </div>
          <p className="hint mt-1">
            {credential.canStoreInDatabase
              ? "Crie em aistudio.google.com/apikey (chave nova já sai do tipo auth; chave padrão sem restrição é recusada pelo Google). Guardada criptografada; depois de salva só dá para substituir, nunca ler."
              : "SECRETS_MASTER_KEY não configurada: use a variável de ambiente GEMINI_API_KEY no .env.local."}
          </p>
          {keyError && <p className="mt-1 text-xs text-red-300">{keyError}</p>}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {modelSelect("analysisModel", "Modelo para análise", "gemini-analysis")}
        {modelSelect("generationModel", "Modelo para geração", "gemini-generation")}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button className="btn-ghost" disabled={busy === "models"} onClick={() => void loadModels()}>
          {busy === "models" ? "Conferindo…" : "Conferir na minha conta"}
        </button>
        {models.some((m) => m.available === false) && (
          <span className="text-amber-300">Algum modelo não está disponível para a sua chave: escolha outro nível.</span>
        )}
      </div>
      {listError && <p className="text-xs text-red-300">{listError}</p>}
      {note && <p className="hint">{note}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-ghost" disabled={!hasKey || busy === "test"} onClick={() => void runTest()}>
          {busy === "test" ? "Testando…" : "Testar conexão"}
        </button>
        {test && (
          <span className={`text-xs ${test.ok ? "text-emerald-300" : "text-red-300"}`}>
            {test.ok ? `OK · ${test.model} · ${test.durationMs}ms` : `${test.message}${test.errorCode ? ` [${test.errorCode}]` : ""}`}
          </span>
        )}
      </div>
      {settings.gemini.analysisModel !== savedAnalysisModel && (
        <p className="text-xs text-amber-300">
          O teste usa o modelo de análise salvo ({savedAnalysisModel}). Salve as configurações para testar o novo.
        </p>
      )}

      <details className="rounded-xl border border-ink-800 p-3">
        <summary className="cursor-pointer text-sm text-ink-300">Avançado</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Timeout (ms)</label>
            <input
              type="number"
              className="field"
              value={settings.gemini.timeoutMs}
              onChange={(e) => patch((d) => ({ ...d, gemini: { ...d.gemini, timeoutMs: Number(e.target.value) } }))}
            />
          </div>
          <div>
            <label className="label">Tentativas extras</label>
            <input
              type="number"
              className="field"
              value={settings.gemini.maxRetries}
              onChange={(e) => patch((d) => ({ ...d, gemini: { ...d.gemini, maxRetries: Number(e.target.value) } }))}
            />
            <p className="hint mt-1">Limite por minuto espera e tenta de novo; cota do dia esgotada nunca é repetida.</p>
          </div>
        </div>
      </details>
    </section>
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

function IngestTokenManager({
  busy,
  setBusy,
  setError,
}: {
  busy: string | null;
  setBusy: (v: string | null) => void;
  setError: (v: string | null) => void;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings/comments-token", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { token?: string | null };
        if (!cancelled && data.token) setToken(data.token);
      } catch {
        /* ignora — campo fica vazio */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function gerar() {
    setBusy("genIngestToken");
    setError(null);
    setCopied(false);
    try {
      const res = await fetch("/api/settings/comments-token", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Falha ao gerar token.");
      }
      const data = (await res.json()) as { token?: string };
      if (data.token) setToken(data.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function copiar() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* fallback não necessário em contexto local */
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="text"
          readOnly
          className="field font-mono text-xs"
          value={token ?? ""}
          placeholder={token ? "" : "Nenhum token configurado"}
        />
        <button
          className="btn-ghost shrink-0"
          disabled={!token || copied}
          onClick={() => void copiar()}
        >
          {copied ? "Copiado!" : "Copiar"}
        </button>
        <button
          className="btn-primary shrink-0"
          disabled={busy === "genIngestToken"}
          onClick={() => void gerar()}
        >
          {busy === "genIngestToken" ? "Gerando…" : token ? "Gerar novo token" : "Gerar token"}
        </button>
      </div>
      <p className="hint">
        O token é gravado no .env.local. Após gerar um novo token, reinicie o servidor para que ele passe a ser aceito pelo endpoint de ingestão.
      </p>
    </div>
  );
}
