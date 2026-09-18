/**
 * Servidor de mentira compatível com POST /v1/chat/completions.
 *
 * Serve para rodar a esteira inteira sem credencial: útil em testes de
 * integração e para ver a interface funcionando antes de contratar a API.
 * NÃO é um modelo: as respostas são fixas e derivadas das evidências recebidas.
 *
 *   node scripts/mock-ghostcli.mjs 8787
 *   GHOSTCLI_BASE_URL=http://127.0.0.1:8787/v1 GHOSTCLI_API_KEY=gcli_mock npm run dev
 */
import http from "node:http";

const port = Number(process.argv[2] ?? 8787);

function firstHook(userMessage) {
  const match = userMessage.match(/possible_hook[^\]]*\]\s*(.+)/);
  return match ? match[1].trim().slice(0, 120) : null;
}

function analysisPayload(userMessage) {
  const hook = firstHook(userMessage);
  return {
    sceneSummary: "Um personagem precisa tomar uma decisão sob pressão imediata.",
    analysisLimitations: ["Descrição visual indisponível; somente OCR executado."],
    conflict: "A decisão contraria a ordem recebida.",
    curiosity: "O motivo da decisão só aparece depois.",
    withhold: "o motivo real da decisão",
    speculation: ["Nomes de personagens não podem ser afirmados a partir das evidências."],
    existingCta: hook
      ? {
          text: hook,
          confidence: "medium",
          firstSeenAtSeconds: 0.5,
          strength: "Cria contraste sem explicar a decisão.",
          possibleImprovement: "Tornar a frase mais curta.",
        }
      : null,
    work: {
      title: null,
      originalTitle: null,
      year: null,
      mediaType: null,
      confidence: "low",
      evidence: [],
      sources: [],
      status: "not_identified_safely",
    },
  };
}

function generationPayload(systemPrompt) {
  const count = Number(systemPrompt.match(/Gere exatamente (\d+) sugest/)?.[1] ?? 10);
  const pool = [
    ["Parecia uma decisão cruel… até entenderem o motivo", "curiosidade"],
    ["Ele tinha segundos para escolher o lado certo", "suspense"],
    ["A ordem era clara, a consciência dele não", "conflito"],
    ["Ninguém no time esperava aquela escolha", "reviravolta"],
    ["A escolha que ele carregaria para sempre", "emocional"],
    ["Dez segundos para decidir", "ultracurto"],
    ["O que ele fez contrariou todo mundo na sala", "conflito"],
    ["A resposta dele calou a sala inteira", "reviravolta"],
    ["Uma ordem, duas vidas, nenhum tempo", "suspense"],
    ["Ele sabia o preço antes de falar", "curiosidade"],
    ["Ninguém entendeu na hora", "ultracurto"],
    ["O silêncio depois disse mais que a ordem", "emocional"],
  ];
  const suggestions = pool.slice(0, count).map(([text, style]) => ({ text, style }));
  return {
    recommendedCta: {
      text: suggestions[0].text,
      reason: "Apresenta o conflito sem revelar como a cena termina.",
    },
    suggestions,
  };
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
    res.writeHead(404).end(JSON.stringify({ error: { message: "rota desconhecida" } }));
    return;
  }

  const auth = req.headers.authorization ?? req.headers["x-api-key"];
  if (!auth) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "credencial ausente" } }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    let parsed = {};
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400).end(JSON.stringify({ error: { message: "json invalido" } }));
      return;
    }

    const messages = parsed.messages ?? [];
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const user = messages.filter((m) => m.role === "user").pop()?.content ?? "";
    const wantsCtas = system.includes("recommendedCta");
    const payload = wantsCtas ? generationPayload(system) : analysisPayload(user);

    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "mock",
        model: parsed.model ?? "mock-model",
        choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(payload) }, finish_reason: "stop" }],
        usage: { prompt_tokens: 512, completion_tokens: 256 },
      }),
    );
  });
});

server.listen(port, "127.0.0.1", () => {
  console.info(`[mock-ghostcli] ouvindo em http://127.0.0.1:${port}/v1`);
});
