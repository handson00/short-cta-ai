// Background service worker: proxy de fetch e captura em lote

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.tipo === 'fetchIngest') {
    (async () => {
      try {
        const res = await fetch(msg.url, {
          method: msg.method || 'POST',
          headers: msg.headers || {},
          body: msg.body || undefined,
        });
        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch { /* ignora */ }
        sendResponse({ ok: res.ok, status: res.status, body: json ?? text });
      } catch (e) {
        sendResponse({ ok: false, status: 0, error: String(e.message || e) });
      }
    })();
    return true;
  }

  if (msg?.tipo === 'capturarEmLote') {
    (async () => {
      try {
        const resultado = await executarCapturaEmLote(msg.videos, msg.config);
        sendResponse(resultado);
      } catch (e) {
        sendResponse({ ok: false, erro: String(e.message || e) });
      }
    })();
    return true;
  }
});

async function executarCapturaEmLote(videos, config) {
  let sucesso = 0;
  let falhas = 0;

  for (const video of videos) {
    let tabId = null;
    try {
      // Abre a aba do vídeo
      const tab = await chrome.tabs.create({ url: video.originalUrl, active: false });
      tabId = tab.id;

      // Aguarda a página carregar completamente
      await aguardarCarregamento(tabId);

      // Injeta o content script se necessário
      await garantirScript(tabId);

      // Coleta os comentários
      const resposta = await chrome.tabs.sendMessage(tabId, {
        tipo: 'coletar',
        opcoes: {
          limite: config.limite,
          incluirRespostas: config.incluirRespostas,
          maxRespostas: config.maxRespostas,
        },
      });

      if (!resposta?.ok) {
        throw new Error(resposta?.erro || 'Falha na captura');
      }

      // Envia para o app via ingest API
      const dados = resposta.dados;
      const comments = [];
      for (const c of dados.comentarios || []) {
        const texto = (c.texto || '').trim();
        if (texto) {
          comments.push({
            externalId: c.id || null,
            parentExternalId: null,
            author: c.autor || c.autorNome || null,
            text: texto,
            likeCount: typeof c.curtidas === 'number' ? c.curtidas : null,
            publishedLabel: c.data || null,
          });
        }
        // Respostas
        for (const r of c.respostas || []) {
          const textoResp = (r.texto || '').trim();
          if (textoResp) {
            comments.push({
              externalId: r.id || null,
              parentExternalId: c.id || null,
              author: r.autor || r.autorNome || null,
              text: textoResp,
              likeCount: typeof r.curtidas === 'number' ? r.curtidas : null,
              publishedLabel: r.data || null,
            });
          }
        }
      }

      // Envia em chunks de 200
      const baseUrl = `${config.url.replace(/\/+$/, '')}/api/comments/ingest`;
      const hashtags = dados.hashtags || { doVideo: [], nosComentarios: [], todas: [] };
      const CHUNK = 200;

      for (let i = 0; i < comments.length; i += CHUNK) {
        const fatia = comments.slice(i, i + CHUNK);
        const payload = {
          postUrl: video.originalUrl,
          comments: fatia,
          hashtags: i === 0 ? hashtags : { doVideo: [], nosComentarios: [], todas: [] },
          // Do segundo pedaço em diante soma aos já gravados em vez de substituir.
          append: i > 0,
        };

        const resIngest = await fetch(baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.token}`,
          },
          body: JSON.stringify(payload),
        });

        if (!resIngest.ok) {
          const errBody = await resIngest.json().catch(() => null);
          throw new Error(errBody?.error || `HTTP ${resIngest.status}`);
        }
      }

      sucesso++;
    } catch (e) {
      falhas++;
      console.error(`Erro capturando ${video.originalUrl}:`, e);
    } finally {
      // Fecha a aba após captura (sucesso ou falha)
      if (tabId != null) {
        try { await chrome.tabs.remove(tabId); } catch { /* já fechada */ }
      }
    }
  }

  return { ok: true, sucesso, falhas, total: videos.length };
}

function aguardarCarregamento(tabId) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(), 30000); // Timeout de 30s
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        // Aguarda mais 2s para o DOM renderizar
        setTimeout(resolve, 2000);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function garantirScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { tipo: 'ping' });
  } catch (e) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await new Promise((r) => setTimeout(r, 500));
  }
}

// ------------------------- Fila de Captura Automática -------------------------
// Polling periódico consulta /api/extension/pending-captures e processa itens
// usando a mesma lógica de executarCapturaEmLote já existente.

const POLL_ALARM = 'capture-queue';
let isPolling = false;

async function pollCaptureQueue() {
  if (isPolling) return;
  // As mesmas chaves que o popup grava em "Enviar para Short CTA AI". Antes o
  // polling lia 'ingestToken'/'apiBase', que nada gravava: o token vinha sempre
  // vazio e a fila automatica nunca processou um pedido.
  const data = await chrome.storage.local.get(['shortCtaToken', 'shortCtaUrl']);
  const token = (data.shortCtaToken || '').trim();
  const apiBase = (data.shortCtaUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '');
  if (!token) {
    console.warn('[capture-queue] Sem token salvo no popup; a fila automatica fica parada.');
    return;
  }

  isPolling = true;
  try {
    const res = await fetch(`${apiBase}/api/extension/pending-captures?limit=5`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const { items } = await res.json();
    if (!Array.isArray(items) || items.length === 0) return;

    for (const item of items) {
      let tabId = null;
      try {
        const tab = await chrome.tabs.create({ url: item.url, active: false });
        tabId = tab.id;
        await aguardarCarregamento(tabId);
        await garantirScript(tabId);

        const resposta = await chrome.tabs.sendMessage(tabId, {
          tipo: 'coletar',
          opcoes: { limite: 500, incluirRespostas: true, maxRespostas: 50 },
        });

        if (!resposta?.ok) throw new Error(resposta?.erro || 'Falha na captura');

        // Monta comentários no formato esperado pelo ingest
        const comments = [];
        const dados = resposta.dados;
        for (const c of dados.comentarios || []) {
          const texto = (c.texto || '').trim();
          if (texto) {
            comments.push({
              externalId: c.id || null,
              parentExternalId: null,
              author: c.autor || c.autorNome || null,
              text: texto,
              likeCount: typeof c.curtidas === 'number' ? c.curtidas : null,
              publishedLabel: c.data || null,
            });
          }
          for (const r of c.respostas || []) {
            const textoResp = (r.texto || '').trim();
            if (textoResp) {
              comments.push({
                externalId: r.id || null,
                parentExternalId: c.id || null,
                author: r.autor || r.autorNome || null,
                text: textoResp,
                likeCount: typeof r.curtidas === 'number' ? r.curtidas : null,
                publishedLabel: r.data || null,
              });
            }
          }
        }

        const hashtags = dados.hashtags || { doVideo: [], nosComentarios: [], todas: [] };
        const CHUNK = 200;
        for (let i = 0; i < comments.length; i += CHUNK) {
          const fatia = comments.slice(i, i + CHUNK);
          const payload = {
            postUrl: item.url,
            comments: fatia,
            hashtags: i === 0 ? hashtags : { doVideo: [], nosComentarios: [], todas: [] },
            // Do segundo pedaço em diante soma aos já gravados em vez de substituir.
            append: i > 0,
          };
          const resIngest = await fetch(`${apiBase}/api/comments/ingest`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
          });
          if (!resIngest.ok) {
            const errBody = await resIngest.json().catch(() => null);
            throw new Error(errBody?.error || `HTTP ${resIngest.status}`);
          }
        }

        // Marca como concluído na fila
        await fetch(`${apiBase}/api/extension/pending-captures`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ id: item.id, status: 'done' }),
        });
      } catch (e) {
        console.error(`[capture-queue] Erro processando ${item.url}:`, e);
        // Marca como erro na fila
        try {
          await fetch(`${apiBase}/api/extension/pending-captures`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ id: item.id, status: 'error' }),
          });
        } catch { /* ignora falha ao reportar erro */ }
      } finally {
        if (tabId != null) {
          try { await chrome.tabs.remove(tabId); } catch { /* já fechada */ }
        }
        // Delay entre capturas para evitar rate-limit do TikTok
        await new Promise((r) => setTimeout(r, 8000));
      }
    }
  } catch (e) {
    console.error('[capture-queue] Erro no polling:', e);
  } finally {
    isPolling = false;
  }
}

// chrome.alarms, e nao setInterval: no Manifest V3 o service worker e
// encerrado depois de ~30 s ocioso e o timer morre junto. O alarme acorda o
// worker. 0.5 min e o menor periodo que o Chrome aceita.
chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) pollCaptureQueue();
});
// Primeira verificação após 5s (dá tempo do service worker inicializar)
setTimeout(pollCaptureQueue, 5000);