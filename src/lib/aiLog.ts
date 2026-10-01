import { db, newId, nowIso } from "./db";

export interface AiLogEntry {
  /** "ghostcli" | "gemini". Registros antigos, de antes do Gemini, ficam nulos. */
  provider?: string | null;
  videoId?: string | null;
  jobId?: string | null;
  operation: string;
  model?: string | null;
  /** "cache": a chamada NÃO foi feita — o resultado salvo foi reaproveitado. */
  status: "ok" | "error" | "cache";
  httpStatus?: number | null;
  durationMs?: number | null;
  attempt?: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  promptVersion?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
}

/**
 * Registro de uso. Guarda operacao, modelo, status e duracao — nunca o
 * conteudo enviado, nunca a transcricao, nunca a credencial.
 */
export function logAiRequest(entry: AiLogEntry): void {
  try {
    db()
      .prepare(
        `INSERT INTO ai_request_logs
         (id, provider, video_id, job_id, operation, model, status, http_status, duration_ms, attempt,
          error_code, error_message, prompt_version, prompt_tokens, completion_tokens, created_at)
         VALUES (@id, @provider, @videoId, @jobId, @operation, @model, @status, @httpStatus, @durationMs, @attempt,
                 @errorCode, @errorMessage, @promptVersion, @promptTokens, @completionTokens, @createdAt)`,
      )
      .run({
        id: newId("log"),
        provider: entry.provider ?? null,
        videoId: entry.videoId ?? null,
        jobId: entry.jobId ?? null,
        operation: entry.operation,
        model: entry.model ?? null,
        status: entry.status,
        httpStatus: entry.httpStatus ?? null,
        durationMs: entry.durationMs ?? null,
        attempt: entry.attempt ?? 1,
        errorCode: entry.errorCode ?? null,
        errorMessage: entry.errorMessage ? entry.errorMessage.slice(0, 500) : null,
        promptVersion: entry.promptVersion ?? null,
        promptTokens: entry.promptTokens ?? null,
        completionTokens: entry.completionTokens ?? null,
        createdAt: nowIso(),
      });
  } catch {
    // Log nunca derruba o processamento.
  }
}
