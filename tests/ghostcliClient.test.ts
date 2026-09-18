import { afterEach, describe, expect, it, vi } from "vitest";
import { chatCompletion, type ClientConfig } from "../src/lib/providers/ai/client";
import { AiError } from "../src/lib/providers/ai/errors";

const CONFIG: ClientConfig = {
  baseUrl: "https://ghostcli.dev/v1",
  apiKey: "gcli_chave_secreta_de_teste",
  authHeader: "authorization",
  timeoutMs: 5_000,
  maxRetries: 2,
};

const REQUEST = {
  model: "claude-sonnet-5",
  messages: [{ role: "user" as const, content: "oi" }],
  temperature: 0.7,
};

function ok(content = '{"a":1}') {
  return new Response(
    JSON.stringify({
      model: "claude-sonnet-5",
      choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function err(status: number, message: string, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ error: { message } }), { status, headers });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chatCompletion", () => {
  it("envia Bearer por padrão e o endpoint correto", async () => {
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal("fetch", fetchMock);

    await chatCompletion(CONFIG, REQUEST);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://ghostcli.dev/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${CONFIG.apiKey}`);
  });

  it("usa x-api-key quando configurado assim", async () => {
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal("fetch", fetchMock);

    await chatCompletion({ ...CONFIG, authHeader: "x-api-key" }, REQUEST);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe(CONFIG.apiKey);
    expect(headers.authorization).toBeUndefined();
  });

  it("repete um 429 respeitando o tempo indicado", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(err(429, "slow down", { "retry-after": "0" }))
      .mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", fetchMock);

    const response = await chatCompletion(CONFIG, REQUEST);
    expect(response.attempts).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("não repete falha de autenticação", async () => {
    const fetchMock = vi.fn(async () => err(401, "invalid api key"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(chatCompletion(CONFIG, REQUEST)).rejects.toMatchObject({ code: "auth_error" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("não repete 403, que costuma ser IP de saída não autorizado", async () => {
    const fetchMock = vi.fn(async () => err(403, "ip not allowed"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(chatCompletion(CONFIG, REQUEST)).rejects.toMatchObject({ code: "forbidden" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("repete 5xx até o limite e então desiste", async () => {
    const fetchMock = vi.fn(async () => err(503, "temporariamente indisponivel"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(chatCompletion({ ...CONFIG, maxRetries: 1 }, REQUEST)).rejects.toMatchObject({
      code: "server_error",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reenvia sem parâmetro de amostragem quando o modelo não o aceita", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(err(400, "temperature is not supported for this model"))
      .mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", fetchMock);

    await chatCompletion(CONFIG, REQUEST);

    const bodies = fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
    expect(bodies[0].temperature).toBe(0.7);
    expect(bodies[1].temperature).toBeUndefined();
  });

  it("classifica timeout de rede", async () => {
    vi.stubGlobal("fetch", async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    });

    await expect(chatCompletion({ ...CONFIG, maxRetries: 0 }, REQUEST)).rejects.toMatchObject({ code: "timeout" });
  });

  it("devolve as chamadas de ferramenta pedidas pelo modelo", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(
        JSON.stringify({
          model: "claude-sonnet-5",
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  { id: "call_1", type: "function", function: { name: "search_movie", arguments: '{"query":"x"}' } },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const response = await chatCompletion(CONFIG, REQUEST);
    expect(response.message.tool_calls?.[0].function.name).toBe("search_movie");
  });

  it("nunca coloca a credencial na mensagem de erro", async () => {
    vi.stubGlobal("fetch", async () => err(401, `key ${CONFIG.apiKey} rejected`));

    const error = await chatCompletion({ ...CONFIG, maxRetries: 0 }, REQUEST).catch((e: AiError) => e);
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).message).not.toContain(CONFIG.apiKey);
  });
});
