import { describe, expect, it } from "vitest";
import { AiError, classifyHttpStatus, friendlyMessage, parseRetryAfter } from "../src/lib/providers/ai/errors";

describe("classifyHttpStatus", () => {
  it("separa os casos citados na documentação", () => {
    expect(classifyHttpStatus(401)).toBe("auth_error");
    expect(classifyHttpStatus(402)).toBe("payment_required");
    expect(classifyHttpStatus(403)).toBe("forbidden");
    expect(classifyHttpStatus(429)).toBe("rate_limited");
    expect(classifyHttpStatus(500)).toBe("server_error");
    expect(classifyHttpStatus(503)).toBe("server_error");
    expect(classifyHttpStatus(400)).toBe("invalid_request");
  });
});

describe("retentativas", () => {
  it("só repete falhas transitórias", () => {
    expect(new AiError("rate_limited", "x").retryable).toBe(true);
    expect(new AiError("server_error", "x").retryable).toBe(true);
    expect(new AiError("timeout", "x").retryable).toBe(true);
    expect(new AiError("network_error", "x").retryable).toBe(true);
  });

  it("nunca repete autenticação ou autorização", () => {
    expect(new AiError("auth_error", "x").retryable).toBe(false);
    expect(new AiError("forbidden", "x").retryable).toBe(false);
    expect(new AiError("payment_required", "x").retryable).toBe(false);
    expect(new AiError("invalid_request", "x").retryable).toBe(false);
  });
});

describe("parseRetryAfter", () => {
  it("lê segundos", () => {
    expect(parseRetryAfter(new Headers({ "retry-after": "3" }))).toBe(3000);
  });

  it("lê data futura", () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    const ms = parseRetryAfter(new Headers({ "retry-after": future })) ?? 0;
    expect(ms).toBeGreaterThan(1000);
  });

  it("usa cabeçalho de limite quando não há retry-after", () => {
    expect(parseRetryAfter(new Headers({ "x-ratelimit-reset-requests": "12s" }))).toBe(12_000);
  });

  it("devolve indefinido sem pistas", () => {
    expect(parseRetryAfter(new Headers())).toBeUndefined();
  });
});

describe("friendlyMessage", () => {
  it("explica o 403 citando IP de saída, que é o caso difícil de hospedagem", () => {
    expect(friendlyMessage("forbidden")).toMatch(/IP de saída/);
  });

  it("nunca ecoa credencial", () => {
    for (const code of ["auth_error", "forbidden", "payment_required"] as const) {
      expect(friendlyMessage(code)).not.toMatch(/gcli_/);
    }
  });
});
