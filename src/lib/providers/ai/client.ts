import { AiError, classifyHttpError, friendlyMessage, parseRetryAfter, parseRetryDelayFromBody } from "./errors";

export interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  tools?: ToolDefinition[];
  jsonMode?: boolean;
  maxTokens?: number;
  /**
   * Quanto o modelo "pensa" antes de responder (Gemini: minimal/low/medium/
   * high). Opcional como a temperatura: se o modelo recusar, sai na tentativa
   * sem parâmetros opcionais.
   */
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
}

export interface ChatResponse {
  message: ChatMessage;
  finishReason: string | null;
  model: string;
  httpStatus: number;
  durationMs: number;
  attempts: number;
  usage: { promptTokens: number | null; completionTokens: number | null };
}

export interface ClientConfig {
  baseUrl: string;
  apiKey: string;
  authHeader: "authorization" | "x-api-key";
  timeoutMs: number;
  maxRetries: number;
}

interface RawChoice {
  message?: { role?: string; content?: string | null; tool_calls?: ChatToolCall[] };
  finish_reason?: string | null;
}

interface RawResponse {
  model?: string;
  choices?: RawChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; type?: string; code?: string };
}

const PARAM_HINTS = ["temperature", "top_p", "response_format", "reasoning", "unsupported", "not supported"];

/**
 * Cliente da interface Chat Completions — a do GhostCLI e a compatível do
 * Google Gemini. Os dois falam o mesmo formato; muda endereço, chave e modelo.
 *
 * Nem todo modelo aceita os mesmos parametros de amostragem ou modo JSON
 * nativo; quando o servico recusa a requisicao por causa de um parametro,
 * tentamos uma vez sem ele antes de desistir. Falhas de autenticacao e de
 * autorizacao nunca sao repetidas automaticamente.
 */
export async function chatCompletion(config: ClientConfig, request: ChatRequest): Promise<ChatResponse> {
  const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const started = Date.now();

  let attempt = 0;
  let allowParams = true;
  let lastError: AiError | null = null;

  while (attempt <= config.maxRetries) {
    attempt += 1;
    try {
      return await singleCall(url, config, request, allowParams, attempt, started);
    } catch (err) {
      const aiErr = err instanceof AiError ? err : new AiError("unknown", (err as Error).message);

      if (aiErr.code === "invalid_request" && allowParams && mentionsParameter(aiErr.details)) {
        // Uma tentativa sem parametros opcionais, sem gastar o orcamento de retry.
        allowParams = false;
        attempt -= 1;
        continue;
      }

      lastError = aiErr;
      if (!aiErr.retryable || attempt > config.maxRetries) break;

      const wait = aiErr.retryAfterMs ?? Math.min(15_000, 500 * 2 ** (attempt - 1) + Math.random() * 300);
      await sleep(wait);
    }
  }

  throw lastError ?? new AiError("unknown", friendlyMessage("unknown"));
}

function mentionsParameter(details: string[]): boolean {
  const joined = details.join(" ").toLowerCase();
  return PARAM_HINTS.some((hint) => joined.includes(hint));
}

async function singleCall(
  url: string,
  config: ClientConfig,
  request: ChatRequest,
  allowParams: boolean,
  attempt: number,
  started: number,
): Promise<ChatResponse> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (config.authHeader === "x-api-key") headers["x-api-key"] = config.apiKey;
  else headers.authorization = `Bearer ${config.apiKey}`;

  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages,
  };
  if (request.tools?.length) body.tools = request.tools;
  if (request.maxTokens) body.max_tokens = request.maxTokens;
  if (allowParams) {
    if (typeof request.temperature === "number") body.temperature = request.temperature;
    if (request.jsonMode) body.response_format = { type: "json_object" };
    if (request.reasoningEffort) body.reasoning_effort = request.reasoningEffort;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const aborted = (err as Error).name === "AbortError";
    const code = aborted ? "timeout" : "network_error";
    throw new AiError(code, friendlyMessage(code), undefined, [(err as Error).message]);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();

  if (!res.ok) {
    const code = classifyHttpError(res.status, text);
    const detail = safeErrorDetail(text);
    throw new AiError(
      code,
      friendlyMessage(code, res.status),
      res.status,
      detail ? [detail] : [],
      code === "rate_limited" ? (parseRetryAfter(res.headers) ?? parseRetryDelayFromBody(text)) : undefined,
    );
  }

  let parsed: RawResponse;
  try {
    parsed = JSON.parse(text) as RawResponse;
  } catch {
    throw new AiError("invalid_output", "Resposta do serviço não é JSON válido.", res.status);
  }

  const choice = parsed.choices?.[0];
  if (!choice?.message) {
    throw new AiError("invalid_output", "Resposta do serviço veio sem mensagem.", res.status);
  }

  return {
    message: {
      role: "assistant",
      content: choice.message.content ?? null,
      tool_calls: choice.message.tool_calls,
    },
    finishReason: choice.finish_reason ?? null,
    model: parsed.model ?? request.model,
    httpStatus: res.status,
    durationMs: Date.now() - started,
    attempts: attempt,
    usage: {
      promptTokens: parsed.usage?.prompt_tokens ?? null,
      completionTokens: parsed.usage?.completion_tokens ?? null,
    },
  };
}

/** Extrai a mensagem de erro do corpo sem devolver cabecalhos nem credenciais. */
function safeErrorDetail(text: string): string | null {
  try {
    // O Google às vezes devolve o erro dentro de uma lista: [{ "error": {...} }].
    const raw = JSON.parse(text) as unknown;
    const parsed = (Array.isArray(raw) ? raw[0] : raw) as { error?: { message?: string } } | undefined;
    const message = parsed?.error?.message;
    if (typeof message === "string") return message.slice(0, 400);
  } catch {
    // corpo nao-JSON
  }
  return text ? text.slice(0, 200) : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
