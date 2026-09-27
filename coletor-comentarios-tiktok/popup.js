const $ = (id) => document.getElementById(id);
let dados = null;
let coletando = false;

const LIMITE_MAX = 5000;

function lerLimite() {
  const n = parseInt($('limite').value, 10);
  return Math.max(1, Math.min(LIMITE_MAX, isNaN(n) ? 100 : n));
}

function marcarPreset() {
  const atual = lerLimite();
  document.querySelectorAll('#presets button').forEach((b) => {
    b.classList.toggle('ativo', Number(b.dataset.valor) === atual);
  });
}

document.querySelectorAll('#presets button').forEach((b) => {
  b.addEventListener('click', () => {
    $('limite').value = b.dataset.valor;
    marcarPreset();
  });
});
$('limite').addEventListener('input', marcarPreset);

const status = (txt, classe = '') => {
  const el = $('status');
  el.textContent = txt;
  el.className = 'status ' + classe;
};

async function abaAtiva() {
  const [aba] = await chrome.tabs.query({ active: true, currentWindow: true });
  return aba;
}

// Garante que o content script esteja carregado (aba aberta antes da instalacao, por exemplo)
async function garantirScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { tipo: 'ping' });
  } catch (e) {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await new Promise((r) => setTimeout(r, 300));
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.tipo !== 'progresso') return;
  const mapa = {
    abrindo: 'Abrindo o painel de comentarios...',
    coletando: `Coletando... ${msg.atual}/${msg.alvo} comentarios`,
    respostas: `Buscando respostas... ${msg.atual}/${msg.alvo}`
  };
  status(mapa[msg.fase] || msg.fase);
});

async function iniciar() {
  const aba = await abaAtiva();
  const url = aba?.url || '';
  const valido = /^https:\/\/www\.tiktok\.com\/@[^/]+\/video\/\d+/.test(url);
  $('alvo').textContent = valido ? url.replace(/^https:\/\/www\.tiktok\.com/, '') : 'Abra a pagina de um video do TikTok.';
  $('capturar').disabled = !valido;

  const salvo = await chrome.storage.local.get(['ultimaCaptura', 'limite', 'respostas', 'maxRespostas', 'autoCaptura']);
  if (salvo.limite) $('limite').value = salvo.limite;
  if (salvo.maxRespostas) $('maxRespostas').value = salvo.maxRespostas;
  if (salvo.respostas === false) $('respostas').checked = false;
  if (salvo.autoCaptura === false) $('autoCaptura').checked = false;
  alternarRespostas();
  marcarPreset();
  if (salvo.ultimaCaptura && salvo.ultimaCaptura.video?.url === url.split('?')[0]) {
    dados = salvo.ultimaCaptura;
    mostrar(dados);
    status('Captura anterior desta pagina carregada.', 'ok');
  }
}

function mostrar(d) {
  $('nComentarios').textContent = d.totais.comentarios;
  $('nRespostas').textContent = d.totais.respostas;
  $('nHashtags').textContent = d.hashtags.todas.length;
  const tags = $('tags');
  tags.innerHTML = '';
  d.hashtags.doVideo.forEach((t) => {
    const el = document.createElement('span');
    el.className = 'tag';
    el.textContent = t;
    tags.appendChild(el);
  });
  d.hashtags.nosComentarios.slice(0, 20).forEach((h) => {
    if (d.hashtags.doVideo.includes(h.tag)) return;
    const el = document.createElement('span');
    el.className = 'tag';
    el.innerHTML = `${h.tag}<em>${h.vezes}</em>`;
    tags.appendChild(el);
  });
  $('resultado').classList.remove('oculto');
}

function paraCsv(d) {
  const linhas = [['nivel', 'posicao', 'id', 'autor', 'nome', 'texto', 'data', 'curtidas', 'respostas', 'hashtags', 'respondendo_a']];
  d.comentarios.forEach((c) => {
    linhas.push(['1', c.posicao, c.id || '', c.autor, c.autorNome, c.texto, c.data, c.curtidas, c.respostasTotal ?? (c.respostas || []).length, c.hashtags.join(' '), '']);
    (c.respostas || []).forEach((r) => {
      linhas.push(['2', c.posicao, r.id || '', r.autor, r.autorNome, r.texto, r.data, r.curtidas, '', r.hashtags.join(' '), c.autor]);
    });
  });
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return '﻿' + linhas.map((l) => l.map(esc).join(',')).join('\r\n');
}

async function copiar(texto, rotulo) {
  try {
    await navigator.clipboard.writeText(texto);
    status(`${rotulo} copiado para a area de transferencia.`, 'ok');
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = texto;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    status(`${rotulo} copiado.`, 'ok');
  }
}

$('capturar').addEventListener('click', async () => {
  const aba = await abaAtiva();
  const limite = lerLimite();
  const incluirRespostas = $('respostas').checked;
  const maxRespostas = Math.max(1, Math.min(200, parseInt($('maxRespostas').value, 10) || 20));
  const autoCaptura = $('autoCaptura').checked;
  await chrome.storage.local.set({ limite, respostas: incluirRespostas, maxRespostas, autoCaptura });

  coletando = true;
  $('capturar').disabled = true;
  $('parar').classList.remove('oculto');
  status('Iniciando...');
  try {
    await garantirScript(aba.id);
    const resposta = await chrome.tabs.sendMessage(aba.id, { tipo: 'coletar', opcoes: { limite, incluirRespostas, maxRespostas } });
    if (!resposta?.ok) throw new Error(resposta?.erro || 'Falha na captura.');
    dados = resposta.dados;
    await chrome.storage.local.set({ ultimaCaptura: dados });
    mostrar(dados);
    const via = dados.fonte === 'api' ? '' : ' (modo leitura da tela)';
    status(`Pronto: ${dados.totais.comentarios} comentarios e ${dados.totais.respostas} respostas${via}.`, 'ok');
  } catch (e) {
    status(String(e.message || e), 'erro');
  } finally {
    coletando = false;
    $('capturar').disabled = false;
    $('parar').classList.add('oculto');
  }
});

$('parar').addEventListener('click', async () => {
  if (!coletando) return;
  const aba = await abaAtiva();
  $('parar').disabled = true;
  status('Parando... aguarde a requisicao em andamento.');
  try { await chrome.tabs.sendMessage(aba.id, { tipo: 'cancelar' }); } catch (e) { /* ignora */ }
  $('parar').disabled = false;
});

function alternarRespostas() {
  $('linhaMaxResp').style.display = $('respostas').checked ? 'flex' : 'none';
}
$('respostas').addEventListener('change', alternarRespostas);

// ---------- Envio para Short CTA AI ----------

async function carregarConfigShortCta() {
  const salvo = await chrome.storage.local.get(['shortCtaUrl', 'shortCtaToken']);
  if (salvo.shortCtaUrl) $('shortCtaUrl').value = salvo.shortCtaUrl;
  else $('shortCtaUrl').value = 'http://127.0.0.1:3000';
  if (salvo.shortCtaToken) $('shortCtaToken').value = salvo.shortCtaToken;
}

function transformarParaIngest(d) {
  // O endpoint espera: { postUrl, comments: [...], hashtags?: {...} }
  // Filtra comentários com texto vazio para evitar erro de validação Zod (min 1 char)
  const comments = [];
  for (const c of d.comentarios || []) {
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
  return {
    postUrl: d.video?.url || location.href,
    comments,
    hashtags: d.hashtags || undefined,
  };
}

$('enviarShortCta').addEventListener('click', async () => {
  if (!dados) { status('Capture os comentarios primeiro.', 'erro'); return; }
  const url = ($('shortCtaUrl').value || '').replace(/\/+$/, '');
  const token = ($('shortCtaToken').value || '').trim();
  if (!url) { status('Informe a URL do Short CTA AI.', 'erro'); return; }
  if (!token) { status('Informe o token de ingestao (COMMENTS_INGEST_TOKEN).', 'erro'); return; }

  await chrome.storage.local.set({ shortCtaUrl: url, shortCtaToken: token });

  const payload = transformarParaIngest(dados);
   status(`Enviando ${payload.comments.length} comentarios...`);
   $('enviarShortCta').disabled = true;

   try {
   const baseUrl = `${url}/api/comments/ingest`;
   const CHUNK = 200;
   let totalGravados = 0;

   for (let i = 0; i < payload.comments.length; i += CHUNK) {
   const fatia = payload.comments.slice(i, i + CHUNK);
   const chunkPayload = { ...payload, comments: fatia };

   // Usa o background script como proxy para evitar bloqueios de CORS do content script/popup
   const response = await chrome.runtime.sendMessage({
   tipo: 'fetchIngest',
   url: baseUrl,
   method: 'POST',
   headers: {
   'Content-Type': 'application/json',
   'Authorization': `Bearer ${token}`,
   },
   body: JSON.stringify(chunkPayload),
   });

   if (!response || !response.ok) {
   const problemas = response?.body?.problemas;
   let msg = response?.body?.error || `HTTP ${response?.status || 0}`;
   if (Array.isArray(problemas) && problemas.length) {
   msg += ': ' + problemas.map(p => `${p.caminho}: ${p.mensagem}`).join('; ');
   }
   throw new Error(msg);
   }

   totalGravados += response.body?.gravados ?? fatia.length;
   }

   status(`Enviado com sucesso: ${totalGravados} comentarios gravados.`, 'ok');
   } catch (e) {
   status(`Falha ao enviar: ${e.message || e}`, 'erro');
   } finally {
   $('enviarShortCta').disabled = false;
   }
});

$('salvarTestarToken').addEventListener('click', async () => {
  const url = ($('shortCtaUrl').value || '').replace(/\/+$/, '');
  const token = ($('shortCtaToken').value || '').trim();
  if (!url) { status('Informe a URL do Short CTA AI.', 'erro'); return; }
  if (!token) { status('Informe o token de ingestão.', 'erro'); return; }

  await chrome.storage.local.set({ shortCtaUrl: url, shortCtaToken: token });
  status('Testando conexão...');
  $('salvarTestarToken').disabled = true;

  try {
    const res = await fetch(`${url}/api/comments/ingest/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = body?.error || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    status(`Token válido! Conexão OK com ${url}.`, 'ok');
  } catch (e) {
    status(`Falha: ${e.message || e}`, 'erro');
  } finally {
    $('salvarTestarToken').disabled = false;
  }
});

carregarConfigShortCta();

$('copiarJson').addEventListener('click', () => dados && copiar(JSON.stringify(dados, null, 2), 'JSON'));
$('copiarCsv').addEventListener('click', () => dados && copiar(paraCsv(dados), 'CSV'));
$('baixar').addEventListener('click', () => {
  if (!dados) return;
  const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const nome = `comentarios-${dados.video.autor || 'tiktok'}-${dados.video.id || Date.now()}.json`;
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  status('Arquivo JSON baixado.', 'ok');
});

// Captura em lote: abre cada vídeo, coleta comentários e envia automaticamente
$('capturarTodos').addEventListener('click', async () => {
  const url = ($('shortCtaUrl').value || '').replace(/\/+$/, '');
  const token = ($('shortCtaToken').value || '').trim();
  if (!url) { status('Informe a URL do Short CTA AI.', 'erro'); return; }
  if (!token) { status('Informe o token de ingestão.', 'erro'); return; }

  await chrome.storage.local.set({ shortCtaUrl: url, shortCtaToken: token });
  $('capturarTodos').disabled = true;
  status('Buscando lista de vídeos...');

  try {
    // Busca a lista de vídeos do app
    const resLista = await fetch(`${url}/api/extension/videos-pending-comments`);
    if (!resLista.ok) throw new Error(`Falha ao buscar vídeos: HTTP ${resLista.status}`);
    const { videos } = await resLista.json();

    if (!videos || videos.length === 0) {
      status('Nenhum vídeo do TikTok encontrado para capturar.', 'ok');
      return;
    }

    status(`Encontrados ${videos.length} vídeos. Iniciando captura em lote...`);

    // Delega a captura em lote ao background script
    const resposta = await chrome.runtime.sendMessage({
      tipo: 'capturarEmLote',
      videos,
      config: {
        url,
        token,
        limite: lerLimite(),
        incluirRespostas: $('respostas').checked,
        maxRespostas: Math.max(1, Math.min(200, parseInt($('maxRespostas').value, 10) || 20)),
      },
    });

    if (!resposta?.ok) {
      throw new Error(resposta?.erro || 'Falha na captura em lote.');
    }

    status(`Concluído: ${resposta.sucesso}/${videos.length} vídeos capturados com sucesso.`, 'ok');
  } catch (e) {
    status(`Erro na captura em lote: ${e.message || e}`, 'erro');
  } finally {
    $('capturarTodos').disabled = false;
  }
});

iniciar();
