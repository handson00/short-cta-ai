"use strict";
// Regras de horário do painel (ponte-horarios.js), usadas por receberDoSistema.
importScripts("ponte-horarios.js");
(() => {
  // src/background/background.ts
  var DASHBOARD_PATH = "dashboard.html";
  async function openDashboard() {
    const url = chrome.runtime.getURL(DASHBOARD_PATH);
    try {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: [chrome.runtime.ContextType.TAB],
        documentUrls: [url]
      });
      const existing = contexts.find((c) => c.tabId !== void 0 && c.tabId >= 0);
      if (existing && existing.tabId !== void 0) {
        await chrome.tabs.update(existing.tabId, { active: true });
        if (existing.windowId !== void 0 && existing.windowId >= 0) {
          await chrome.windows.update(existing.windowId, { focused: true });
        }
        return;
      }
    } catch {
    }
    await chrome.tabs.create({ url });
  }
  chrome.action.onClicked.addListener(() => {
    void openDashboard();
  });
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "open-dashboard") {
      openDashboard().then(() => sendResponse({ ok: true }));
      return true;
    }
    return false;
  });
})();

// ---------------------------------------------------------------------------
// Recebimento de posts do Short CTA AI (0.5.0)
//
// A página de Exportações do sistema manda, pela ponte (ponte-short-cta.js),
// o post montado e um link assinado do vídeo. Aqui o vídeo é baixado e o post
// entra no painel como RASCUNHO, no próximo horário livre da grade — o mesmo
// que importar o arquivo à mão. Nada é programado no Instagram por aqui: quem
// programa continua sendo o painel, quando o usuário manda.
//
// O painel (dashboard) é compilado e não sabe que alguém de fora mexe no
// estado: ele lê os posts ao abrir e depois só grava. Por isso, depois de
// gravar, as abas do painel são recarregadas — e, se alguma delas gravou por
// cima no meio do caminho, o post é reposto uma vez.
// ---------------------------------------------------------------------------
(() => {
  const H = self.AgendadorHorarios;
  const ORIGENS_DO_SISTEMA = ["http://localhost:3000", "http://127.0.0.1:3000"];
  const ROTA_DO_VIDEO = "/api/agendador/video";
  const BANCO = "agendador-ig";
  const VIDEOS = "videos";

  function abrirBanco() {
    return new Promise((ok, falha) => {
      const req = indexedDB.open(BANCO, 1);
      // Mesmo esquema do painel: uma store de chave livre (id do post → vídeo).
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(VIDEOS)) req.result.createObjectStore(VIDEOS);
      };
      req.onsuccess = () => ok(req.result);
      req.onerror = () => falha(req.error);
    });
  }

  async function naStore(modo, fn) {
    const db = await abrirBanco();
    try {
      return await new Promise((ok, falha) => {
        const tx = db.transaction(VIDEOS, modo);
        const req = fn(tx.objectStore(VIDEOS));
        tx.oncomplete = () => ok(req.result);
        tx.onerror = () => falha(tx.error);
        tx.onabort = () => falha(tx.error);
      });
    } finally {
      db.close();
    }
  }

  const guardarVideo = (id, blob) => naStore("readwrite", (s) => s.put(blob, id));
  const apagarVideo = (id) => naStore("readwrite", (s) => s.delete(id));

  async function lerEstado() {
    const salvo = (await chrome.storage.local.get(H.CHAVE_ESTADO))[H.CHAVE_ESTADO];
    return H.estadoNormalizado(salvo, new Date());
  }

  const gravarEstado = (estado) => chrome.storage.local.set({ [H.CHAVE_ESTADO]: estado });

  async function abasDoPainel() {
    const url = chrome.runtime.getURL("dashboard.html");
    try {
      const ctxs = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.TAB], documentUrls: [url] });
      return ctxs.map((c) => c.tabId).filter((id) => id !== undefined && id >= 0);
    } catch {
      return [];
    }
  }

  const doSistema = (p) => p.origem && p.origem.exportJobId;
  const erro = (message, extra = {}) => ({ ok: false, message, ...extra });
  const texto = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  const numero = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const motivo = (e) => (e && e.message ? e.message : String(e));

  function descreverHorario(p) {
    return p.date && p.time ? `${p.date.split("-").reverse().join("/")} às ${p.time}` : "sem horário";
  }

  async function receberDoSistema(msg) {
    const post = msg.post;
    if (!post || typeof post.exportJobId !== "string" || typeof post.size !== "number") {
      return erro("Pedido do sistema incompleto.");
    }

    // O link tem de ser do próprio sistema, na rota do vídeo: a extensão não
    // baixa de endereço que a página escolher.
    let link;
    try {
      link = new URL(msg.videoUrl);
    } catch {
      return erro("Link do vídeo inválido.");
    }
    if (!ORIGENS_DO_SISTEMA.includes(link.origin) || link.pathname !== ROTA_DO_VIDEO) {
      return erro("Link do vídeo fora do sistema; recusado.");
    }

    let estado = await lerEstado();
    // Recarregar o painel no meio de um envio ao Instagram interromperia o
    // envio (o vídeo sai do painel para a aba do Instagram em pedaços).
    if (estado.posts.some((p) => p.status === "agendando")) {
      return erro("O Agendador está programando posts no Instagram agora. Espere terminar e envie de novo.");
    }
    const repetido = estado.posts.find((p) => doSistema(p) === post.exportJobId && p.status !== "cancelado");
    if (repetido) {
      return erro(
        `Este vídeo já está no Agendador (${repetido.status}, ${descreverHorario(repetido)}). Para mandar de novo, apague o post de lá.`,
        { code: "duplicado", postId: repetido.id, date: repetido.date, time: repetido.time },
      );
    }

    let resposta;
    try {
      resposta = await fetch(link.href, { cache: "no-store", credentials: "omit" });
    } catch (e) {
      return erro(`Não consegui baixar o vídeo do sistema: ${motivo(e)}`);
    }
    if (!resposta.ok) {
      let detalhe = `HTTP ${resposta.status}`;
      try {
        detalhe = (await resposta.json()).error || detalhe;
      } catch {
        // corpo sem JSON: fica o código HTTP
      }
      return erro(`O sistema não entregou o vídeo: ${detalhe}`);
    }
    const blob = await resposta.blob();
    if (blob.size !== post.size) {
      return erro(`O vídeo chegou incompleto (${blob.size} de ${post.size} bytes). Nada foi adicionado; envie de novo.`);
    }

    const id = crypto.randomUUID();
    await guardarVideo(id, blob.type ? blob : new Blob([blob], { type: "video/mp4" }));

    let novo;
    try {
      // Relê agora: o download levou tempo, e o painel pode ter gravado nesse meio.
      estado = await lerEstado();
      const [vaga] = H.proximosLivres(1, estado.settings, estado.posts, new Date());
      novo = {
        id,
        fileName: texto(post.fileName, 255) || "video.mp4",
        size: blob.size,
        mime: "video/mp4",
        duration: numero(post.duration),
        width: numero(post.width),
        height: numero(post.height),
        thumb: texto(post.thumb, 200000).startsWith("data:image/") ? post.thumb : "",
        caption: texto(post.caption, 5000),
        hashtags: texto(post.hashtags, 2000),
        date: vaga ? vaga.date : "",
        time: vaga ? vaga.time : "",
        status: "rascunho",
        createdAt: Date.now(),
        // Campo extra: o painel preserva (ele atualiza posts com `{...post, ...}`)
        // e é o que impede o mesmo vídeo de entrar duas vezes.
        origem: { app: "short-cta-ai", exportJobId: post.exportJobId, videoId: texto(post.videoId, 120) },
      };
      await gravarEstado({ ...estado, posts: [...estado.posts, novo] });
    } catch (e) {
      await apagarVideo(id).catch(() => undefined);
      return erro(`Não consegui gravar o post no Agendador: ${motivo(e)}`);
    }

    const abas = await abasDoPainel();
    await Promise.all(abas.map((t) => chrome.tabs.reload(t).catch(() => undefined)));
    if (abas.length > 0) {
      // Uma aba do painel pode ter gravado o estado antigo por cima antes de
      // recarregar. Confere e repõe uma vez.
      await new Promise((r) => setTimeout(r, 1500));
      const depois = await lerEstado();
      if (!depois.posts.some((p) => p.id === id)) {
        await gravarEstado({ ...depois, posts: [...depois.posts, novo] });
        await Promise.all(abas.map((t) => chrome.tabs.reload(t).catch(() => undefined)));
      }
    }

    return { ok: true, postId: id, date: novo.date, time: novo.time, painelAberto: abas.length > 0 };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== "ag:receber-do-sistema") return false;
    // Só a ponte, rodando numa página do sistema, pode pedir isto.
    let origem = sender.origin || "";
    if (!origem && sender.url) {
      try {
        origem = new URL(sender.url).origin;
      } catch {
        origem = "";
      }
    }
    if (sender.id !== chrome.runtime.id || !ORIGENS_DO_SISTEMA.includes(origem)) {
      sendResponse(erro("Origem não autorizada."));
      return false;
    }
    receberDoSistema(msg)
      .then(sendResponse)
      .catch((e) => sendResponse(erro(`Falha inesperada no Agendador: ${motivo(e)}`)));
    return true;
  });
})();
