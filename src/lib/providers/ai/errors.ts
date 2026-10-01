export type AiErrorCode =
  | "not_configured"
  | "auth_error"
  | "payment_required"
  | "forbidden"
  | "rate_limited"
  /** Cota do período (dia) esgotada: tentar de novo agora só gasta tentativa. */
  | "quota_exhausted"
  | "invalid_request"
  | "server_error"
  | "timeout"
  | "network_error"
  | "invalid_output"
  | "unknown";

const RETRYABLE: AiErrorCode[] = ["rate_limited", "server_error", "timeout", "network_error"];

export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly httpStatus?: number,
    readonly details: string[] = [],
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "AiError";
  }

  get retryable(): boolean {
    return RETRYABLE.includes(this.code);
  }
}

/** Mensagens que o usuario ve. Nada aqui contem a chave nem cabecalhos. */
export function friendlyMessage(code: AiErrorCode, httpStatus?: number): string {
  switch (code) {
    case "not_configured":
      return "Nenhuma credencial do provedor de IA está configurada. Salve a chave em Configurações.";
    case "auth_error":
      return "Credencial recusada (401). Verifique se a chave está correta e ainda ativa.";
    case "payment_required":
      return "A conta precisa de créditos ou de um plano ativo (402).";
    case "forbidden":
      return "Acesso negado (403). A chave pode não ter acesso de API liberado, ou o IP de saída deste servidor não está autorizado.";
    case "rate_limited":
      return "Limite de requisições atingido (429). As tentativas seguintes respeitam a espera indicada pelo serviço.";
    case "quota_exhausted":
      return "Cota do plano gratuito esgotada para este modelo (429). O Google a renova sozinho; até lá, escolha outro modelo em Configurações ou tente mais tarde.";
    case "invalid_request":
      return `O serviço recusou a requisição${httpStatus ? ` (${httpStatus})` : ""}. Confira o ID do modelo configurado.`;
    case "server_error":
      return `O serviço respondeu com falha temporária${httpStatus ? ` (${httpStatus})` : ""}.`;
    case "timeout":
      return "O serviço não respondeu dentro do tempo limite configurado.";
    case "network_error":
      return "Não foi possível alcançar o serviço pela rede.";
    case "invalid_output":
      return "O modelo respondeu fora do contrato de saída esperado.";
    default:
      return "Falha não classificada ao falar com o serviço de IA.";
  }
}

/**
 * Mensagem para quem vai DEPURAR o problema (usuario nas Configuracoes, log
 * de uso) — a friendlyMessage() sozinha so diz a categoria do erro (403,
 * 401...); o detalhe (o corpo que o servico devolveu, ja sem cabecalhos nem
 * credencial - ver safeErrorDetail() no client) e o que de fato diferencia
 * "chave sem escopo de API" de "IP fora da lista liberada", e ficava sendo
 * descartado antes de chegar a interface.
 */
export function detailedMessage(err: AiError): string {
  if (err.details.length === 0) return err.message;
  return `${err.message} Resposta do serviço: ${err.details.join(" | ")}`;
}

/**
 * Classifica pelo status E pelo corpo da resposta.
 *
 * O status sozinho engana com o Google:
 * - chave inválida chega como 400 ("API key not valid"), não 401 — pelo status
 *   a tela diria "confira o ID do modelo" e mandaria o usuário para o lugar errado;
 * - 429 serve tanto para "espere alguns segundos" quanto para "a cota do dia
 *   acabou". A cota do dia vem marcada com um quotaId terminado em "PerDay";
 *   repetir a chamada nesse caso só queima as tentativas do job.
 */
export function classifyHttpError(status: number, body: string): AiErrorCode {
  if (status === 400 && /API[ _]?key not valid|API_KEY_INVALID/i.test(body)) return "auth_error";
  if (status === 429 && /PerDay/i.test(body)) return "quota_exhausted";
  return classifyHttpStatus(status);
}

/** Espera sugerida no corpo do Google (`"retryDelay": "34s"`), em ms. */
export function parseRetryDelayFromBody(body: string): number | undefined {
  const match = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (!match) return undefined;
  return Math.min(Number(match[1]) * 1000, 120_000);
}

export function classifyHttpStatus(status: number): AiErrorCode {
  if (status === 401) return "auth_error";
  if (status === 402) return "payment_required";
  if (status === 403) return "forbidden";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  if (status >= 400) return "invalid_request";
  return "unknown";
}

/** Le Retry-After (segundos ou data) e cabecalhos usuais de limite. */
export function parseRetryAfter(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(raw);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  const reset = headers.get("x-ratelimit-reset-requests") ?? headers.get("x-ratelimit-reset");
  if (reset) {
    const seconds = Number(reset.replace(/[^\d.]/g, ""));
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 120_000);
  }
  return undefined;
}
