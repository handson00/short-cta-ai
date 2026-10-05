"use strict";
/**
 * Ponte entre a página do Short CTA AI (localhost:3000) e o Agendador IG.
 *
 * A página não fala com a extensão direto: ela não sabe o id da extensão, e o
 * id de uma extensão carregada sem compactação muda com a pasta. Este script
 * roda dentro da página (content script) e repassa as mensagens.
 *
 * Só escuta a própria janela e a própria origem, e só os dois tipos abaixo.
 * Quem decide o que fazer é o background, que confere de novo a origem.
 */
(() => {
  if (window.__agendadorPonteCarregada) return;
  window.__agendadorPonteCarregada = true;

  const DA_PAGINA = "short-cta-ai→agendador";
  const DA_EXTENSAO = "agendador→short-cta-ai";
  const versao = chrome.runtime.getManifest().version;

  const responder = (msg) => window.postMessage({ canal: DA_EXTENSAO, ...msg }, location.origin);

  // A página pode ter carregado antes ou depois deste script: avisa ao chegar
  // e responde a cada "ping".
  responder({ tipo: "pronto", versao });

  window.addEventListener("message", (ev) => {
    if (ev.source !== window || ev.origin !== location.origin) return;
    const msg = ev.data;
    if (!msg || msg.canal !== DA_PAGINA) return;

    if (msg.tipo === "ping") {
      responder({ tipo: "pronto", versao });
      return;
    }

    const tipos = { enviar: "ag:receber-do-sistema", "abrir-painel": "open-dashboard" };
    const tipoInterno = tipos[msg.tipo];
    if (!tipoInterno || typeof msg.id !== "string") return;

    let pendente;
    try {
      pendente = chrome.runtime.sendMessage({ type: tipoInterno, post: msg.post, videoUrl: msg.videoUrl });
    } catch {
      // Extensão recarregada depois que esta página abriu: o canal antigo morreu.
      responder({ tipo: "resposta", id: msg.id, ok: false, message: "O Agendador IG foi atualizado. Recarregue esta página (F5)." });
      return;
    }
    pendente
      .then((r) => responder({ tipo: "resposta", id: msg.id, ...(r ?? { ok: false, message: "O Agendador IG não respondeu." }) }))
      .catch((e) =>
        responder({
          tipo: "resposta",
          id: msg.id,
          ok: false,
          message: /context invalidated/i.test(String(e))
            ? "O Agendador IG foi atualizado. Recarregue esta página (F5)."
            : `Falha ao falar com o Agendador IG: ${e?.message ?? e}`,
        }),
      );
  });
})();
