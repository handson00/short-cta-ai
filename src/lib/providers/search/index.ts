import { env } from "../../env";
import type { SearchEvidence, SearchProvider } from "../../types";

/** Sem pesquisa configurada a identificacao da obra simplesmente nao acontece. */
class NoSearchProvider implements SearchProvider {
  readonly name = "none";
  readonly available = false;
  async searchWork(): Promise<SearchEvidence[]> {
    return [];
  }
}

/**
 * Provedor generico: o usuario aponta um endpoint que devolve
 * [{ title, snippet, url, source }]. A chave do provedor fica no servidor e
 * o modelo nunca a ve — ele so pode pedir uma busca pela ferramenta interna.
 */
class HttpSearchProvider implements SearchProvider {
  readonly name = "http";
  private calls: number[] = [];
  private readonly windowMs = 60_000;
  private readonly maxPerWindow = 12;

  get available(): boolean {
    return Boolean(env.searchHttpEndpoint);
  }

  private allow(): boolean {
    const now = Date.now();
    this.calls = this.calls.filter((t) => now - t < this.windowMs);
    if (this.calls.length >= this.maxPerWindow) return false;
    this.calls.push(now);
    return true;
  }

  async searchWork(query: string): Promise<SearchEvidence[]> {
    if (!this.available) return [];
    if (!this.allow()) throw new Error("Limite de pesquisas por minuto atingido.");

    const url = new URL(env.searchHttpEndpoint);
    url.searchParams.set("q", query.slice(0, 300));

    const headers: Record<string, string> = { accept: "application/json" };
    if (env.searchHttpApiKey) headers.authorization = `Bearer ${env.searchHttpApiKey}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      if (!res.ok) throw new Error(`Pesquisa devolveu HTTP ${res.status}`);
      const data: unknown = await res.json();
      const list = Array.isArray(data) ? data : ((data as { results?: unknown[] })?.results ?? []);
      return (list as Record<string, unknown>[])
        .slice(0, 8)
        .map((item) => ({
          title: String(item.title ?? "").slice(0, 200),
          snippet: String(item.snippet ?? item.description ?? "").slice(0, 600),
          url: item.url ? String(item.url) : null,
          source: String(item.source ?? new URL(env.searchHttpEndpoint).hostname),
        }))
        .filter((e) => e.title || e.snippet);
    } finally {
      clearTimeout(timer);
    }
  }
}

let cached: SearchProvider | null = null;

export function searchProvider(): SearchProvider {
  if (cached) return cached;
  cached = env.searchProvider === "http" ? new HttpSearchProvider() : new NoSearchProvider();
  return cached;
}

export function searchStatus(): { name: string; available: boolean; detail: string } {
  const p = searchProvider();
  return {
    name: p.name,
    available: p.available,
    detail: p.available ? "Endpoint de pesquisa configurado" : "Pesquisa externa desativada",
  };
}
