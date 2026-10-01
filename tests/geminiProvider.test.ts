import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { chatCompletion, type ClientConfig } from "../src/lib/providers/ai/client";
import { AiError, classifyHttpError, parseRetryDelayFromBody } from "../src/lib/providers/ai/errors";
import { mainModelOptions, recommendedModel, toModelOptions } from "../src/lib/providers/ai/geminiModels";

/**
 * Google Gemini como segundo provedor de IA.
 *
 * O `npm test` carrega o `.env.local`: as chaves reais são zeradas e o banco
 * aponta para uma pasta temporária ANTES de importar qualquer módulo que toque
 * o banco — nada aqui pode encostar em data/short-cta-ai.db.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shortcta-gemini-"));

let settings: typeof import("../src/lib/settings");
let ai: typeof import("../src/lib/providers/ai");
let db: typeof import("../src/lib/db");

beforeAll(async () => {
  process.env.DATA_DIR = tmpDir;
  process.env.DATABASE_PATH = path.join(tmpDir, "teste.db");
  process.env.GEMINI_API_KEY = "";
  process.env.GHOSTCLI_API_KEY = "";
  process.env.SECRETS_MASTER_KEY = "chave-mestra-so-para-teste";
  vi.resetModules();
  settings = await import("../src/lib/settings");
  ai = await import("../src/lib/providers/ai");
  db = await import("../src/lib/db");
  db.db();
});

afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Windows pode segurar o arquivo do banco; a pasta é temporária.
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ------------------------------- Erros -------------------------------------

describe("classificação de erro do Google", () => {
  it("chave inválida (400) vira erro de credencial, não 'confira o modelo'", () => {
    const body = JSON.stringify([{ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } }]);
    expect(classifyHttpError(400, body)).toBe("auth_error");
  });

  it("429 com cota do dia vira quota_exhausted e não é repetido", () => {
    const body = '{"error":{"code":429,"details":[{"violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}]}}';
    const code = classifyHttpError(429, body);
    expect(code).toBe("quota_exhausted");
    expect(new AiError(code, "x").retryable).toBe(false);
  });

  it("429 por minuto continua sendo espera e nova tentativa", () => {
    const body = '{"error":{"code":429,"details":[{"violations":[{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}]}]}}';
    expect(classifyHttpError(429, body)).toBe("rate_limited");
  });

  it("lê a espera sugerida no corpo (retryDelay)", () => {
    expect(parseRetryDelayFromBody('{"retryDelay": "34s"}')).toBe(34_000);
    expect(parseRetryDelayFromBody("{}")).toBeUndefined();
  });
});

describe("cliente contra o formato de erro do Google", () => {
  const CONFIG: ClientConfig = {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKey: "AIza_teste",
    authHeader: "authorization",
    timeoutMs: 5_000,
    maxRetries: 2,
  };
  const REQUEST = { model: "gemini-3.8-flash", messages: [{ role: "user" as const, content: "oi" }] };

  it("cota do dia esgotada: uma chamada só, com o motivo do Google", async () => {
    const body = JSON.stringify([
      { error: { code: 429, message: "You exceeded your current quota.", details: [{ violations: [{ quotaId: "PerDay-FreeTier" }] }] } },
    ]);
    const fetchMock = vi.fn(async () => new Response(body, { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    const err = (await chatCompletion(CONFIG, REQUEST).catch((e) => e)) as AiError;
    expect(err.code).toBe("quota_exhausted");
    expect(err.details[0]).toContain("You exceeded your current quota");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("limite por minuto: espera o retryDelay e tenta de novo", async () => {
    const limited = JSON.stringify({ error: { code: 429, message: "rate", details: [{ retryDelay: "0.01s" }] } });
    const success = JSON.stringify({
      model: "gemini-3.8-flash",
      choices: [{ message: { role: "assistant", content: "{}" }, finish_reason: "stop" }],
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(limited, { status: 429 }))
      .mockResolvedValueOnce(new Response(success, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await chatCompletion(CONFIG, REQUEST);
    expect(res.attempts).toBe(2);
  });
});

// ------------------------------ Modelos ------------------------------------

describe("lista de modelos da conta", () => {
  it("fica só com modelos de texto, sem o prefixo models/, gratuitos primeiro", () => {
    const options = toModelOptions([
      { name: "models/gemini-3.1-pro-preview", displayName: "Gemini 3.1 Pro", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3.8-flash", displayName: "Gemini 3.8 Flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-2.5-flash-image", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-embedding-2-preview", supportedGenerationMethods: ["embedContent"] },
      { name: "models/gemini-2.5-flash-preview-tts", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent", "countTokens"] },
      { name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] },
    ]);
    expect(options.map((o) => o.id)).toEqual(["gemini-3.8-flash", "gemini-2.5-flash", "gemini-3.1-pro-preview"]);
    expect(options.find((o) => o.id === "gemini-3.1-pro-preview")?.freeTier).toBe(false);
    expect(options.find((o) => o.id === "gemini-3.8-flash")?.freeTier).toBe(true);
  });

  it("a tela oferece só três: básico, médio e avançado, todos gratuitos", () => {
    const main = mainModelOptions(null);
    expect(main.map((m) => [m.tier, m.id])).toEqual([
      ["Básico", "gemini-3.5-flash-lite"],
      ["Médio", "gemini-3.8-flash"],
      ["Avançado", "gemini-2.5-pro"],
    ]);
    expect(main.every((m) => m.freeTier)).toBe(true);
    // Sem conferir a conta, não afirma disponibilidade nenhuma.
    expect(main.every((m) => m.available === null)).toBe(true);
  });

  it("modelo que a conta não oferece aparece como indisponível, não some", () => {
    const account = toModelOptions([
      { name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-2.5-pro", supportedGenerationMethods: ["generateContent"] },
    ]);
    const main = mainModelOptions(account);
    expect(main).toHaveLength(3);
    expect(main.find((m) => m.id === "gemini-3.5-flash-lite")?.available).toBe(false);
    expect(main.find((m) => m.id === "gemini-3.8-flash")?.available).toBe(true);
  });

  it("o recomendado nas duas etapas é o Básico, e é o padrão", () => {
    expect(recommendedModel("analysis")).toBe("gemini-3.5-flash-lite");
    expect(recommendedModel("generation")).toBe("gemini-3.5-flash-lite");
    expect(settings.DEFAULT_SETTINGS.gemini.analysisModel).toBe(recommendedModel("analysis"));
    expect(settings.DEFAULT_SETTINGS.gemini.generationModel).toBe(recommendedModel("generation"));
    // Só um recomendado por etapa: a tela marca um, não vários.
    const main = mainModelOptions(null);
    expect(main.filter((m) => m.recommendedFor.includes("generation"))).toHaveLength(1);
  });
});

// --------------------------- Configuração ----------------------------------

describe("configuração do provedor", () => {
  it("o padrão continua sendo o GhostCLI", () => {
    expect(settings.getSettings().ai.provider).toBe("ghostcli");
    expect(settings.resolveAiProfile(settings.getSettings()).baseUrl).toContain("ghostcli");
  });

  it("perfil do Gemini aponta para o endpoint compatível do Google", () => {
    const profile = settings.resolveAiProfile(settings.getSettings(), "gemini");
    expect(profile.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta/openai");
    expect(profile.authHeader).toBe("authorization");
    expect(profile.analysisModel).toBe("gemini-3.5-flash-lite");
  });

  it("recusa provedor desconhecido e limpa o prefixo models/ do ID", () => {
    const saved = settings.saveSettings({ ai: { provider: "openai" }, gemini: { analysisModel: "models/gemini-2.5-flash" } });
    expect(saved.ai.provider).toBe("ghostcli");
    expect(saved.gemini.analysisModel).toBe("gemini-2.5-flash");
  });

  it("cada provedor guarda a sua chave; trocar uma não apaga a outra", () => {
    settings.saveApiKey("gcli_chave_ghost", "ghostcli");
    settings.saveApiKey("AIza_chave_gemini", "gemini");
    expect(settings.getApiKey("ghostcli")).toBe("gcli_chave_ghost");
    expect(settings.getApiKey("gemini")).toBe("AIza_chave_gemini");
    expect(settings.credentialStatus("gemini").mask).not.toContain("chave_gemini");

    settings.clearApiKey("gemini");
    expect(settings.getApiKey("gemini")).toBeNull();
    expect(settings.getApiKey("ghostcli")).toBe("gcli_chave_ghost");
  });

  it("sem chave do provedor ativo, não cai para o outro", () => {
    settings.saveSettings({ ai: { provider: "gemini" } });
    settings.clearApiKey("gemini");
    expect(() => ai.aiProvider()).toThrow(/Google Gemini/);
    settings.saveSettings({ ai: { provider: "ghostcli" } });
  });
});

describe("modelo reserva do Gemini (sobrecarga, lentidão, cota)", () => {
  const KIT = JSON.stringify({
    model: "x",
    choices: [
      {
        message: {
          role: "assistant",
          content: JSON.stringify({ description: "Uma legenda de teste com palavras suficientes.", hashtags: ["#filme"] }),
        },
        finish_reason: "stop",
      },
    ],
  });
  const overloaded = () =>
    new Response(JSON.stringify({ error: { code: 503, message: "This model is currently experiencing high demand." } }), {
      status: 503,
    });

  function useGemini(generationModel = "gemini-3.8-flash") {
    settings.saveApiKey("AIza_chave_gemini", "gemini");
    settings.saveSettings({ ai: { provider: "gemini" }, gemini: { generationModel } });
  }

  function bodies(fetchMock: ReturnType<typeof vi.fn>) {
    return fetchMock.mock.calls.map((c) => JSON.parse(String((c as unknown as [string, RequestInit])[1].body)));
  }

  it("503 no modelo escolhido: uma tentativa só, e o reserva responde", async () => {
    useGemini();
    const fetchMock = vi.fn().mockResolvedValueOnce(overloaded()).mockResolvedValueOnce(new Response(KIT, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const kit = await ai.aiProvider().generatePublishKit(null, null, null);
    expect(kit.hashtags).toEqual(["#filme"]);
    expect(bodies(fetchMock).map((b) => b.model)).toEqual(["gemini-3.8-flash", "gemini-3.5-flash-lite"]);

    // As duas chamadas ficam no registro: a que falhou e a que atendeu.
    const logs = db
      .db()
      .prepare("SELECT model, status FROM ai_request_logs WHERE operation = 'publish_kit' ORDER BY rowid DESC LIMIT 2")
      .all();
    expect(logs).toEqual([
      { model: "x", status: "ok" },
      { model: "gemini-3.8-flash", status: "error" },
    ]);
    settings.saveSettings({ ai: { provider: "ghostcli" } });
  });

  it("com o Básico escolhido, o reserva é o Médio: um cobre o outro", async () => {
    useGemini("gemini-3.5-flash-lite");
    const fetchMock = vi.fn().mockResolvedValueOnce(overloaded()).mockResolvedValueOnce(new Response(KIT, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await ai.aiProvider().generatePublishKit(null, null, null);
    expect(bodies(fetchMock).map((b) => b.model)).toEqual(["gemini-3.5-flash-lite", "gemini-3.8-flash"]);
    settings.saveSettings({ ai: { provider: "ghostcli" } });
  });

  it("chave recusada não tenta o reserva: o problema não é o modelo", async () => {
    useGemini();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: "bad" } }), { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(ai.aiProvider().generatePublishKit(null, null, null)).rejects.toMatchObject({ code: "auth_error" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    settings.saveSettings({ ai: { provider: "ghostcli" } });
  });

  it("pede raciocínio baixo ao Gemini; ao GhostCLI, nada muda", async () => {
    useGemini();
    let fetchMock = vi.fn(async () => new Response(KIT, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await ai.aiProvider().generatePublishKit(null, null, null);
    expect(bodies(fetchMock)[0].reasoning_effort).toBe("low");

    settings.saveSettings({ ai: { provider: "ghostcli" } });
    settings.saveApiKey("gcli_chave_ghost", "ghostcli");
    fetchMock = vi.fn(async () => new Response(KIT, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await ai.aiProvider().generatePublishKit(null, null, null);
    expect(bodies(fetchMock)[0].reasoning_effort).toBeUndefined();
  });

  it("GhostCLI (pago) não tem reserva: 503 é repetido no mesmo modelo, nunca trocado", async () => {
    settings.saveSettings({ ai: { provider: "ghostcli" }, ghostcli: { maxRetries: 1, generationModel: "claude-sonnet-5" } });
    settings.saveApiKey("gcli_chave_ghost", "ghostcli");
    const fetchMock = vi.fn(async () => overloaded());
    vi.stubGlobal("fetch", fetchMock);

    await expect(ai.aiProvider().generatePublishKit(null, null, null)).rejects.toMatchObject({ code: "server_error" });
    expect(new Set(bodies(fetchMock).map((b) => b.model))).toEqual(new Set(["claude-sonnet-5"]));
  });
});

describe("chamada de ponta a ponta pelo provedor", () => {
  it("testa o Gemini no endpoint do Google, com a chave dele, e registra o provedor", async () => {
    settings.saveApiKey("AIza_chave_gemini", "gemini");
    settings.saveSettings({ gemini: { analysisModel: "gemini-3.5-flash-lite" } });

    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            model: "gemini-3.5-flash-lite",
            choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    // O provedor ativo continua sendo o GhostCLI: dá para testar o Gemini antes de trocar.
    const result = await ai.testProviderConnection("gemini");
    expect(result?.ok).toBe(true);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer AIza_chave_gemini");
    expect(JSON.parse(String(init.body)).model).toBe("gemini-3.5-flash-lite");

    const row = db
      .db()
      .prepare("SELECT provider, model FROM ai_request_logs WHERE operation = 'test_connection' ORDER BY created_at DESC LIMIT 1")
      .get() as { provider: string; model: string };
    expect(row).toEqual({ provider: "gemini", model: "gemini-3.5-flash-lite" });
  });
});
