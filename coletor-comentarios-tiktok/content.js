// Coletor de Comentarios TikTok - content script
// A lista de comentarios do TikTok e virtualizada: o DOM mantem apenas uma
// janela de ~20 itens por vez. Por isso a coleta e incremental - rola um passo,
// expande as respostas visiveis, colhe o que esta na tela e deduplica.

(() => {
  if (window.__tkColetorComentarios) return;
  window.__tkColetorComentarios = true;

  const SEL = {
    thread: '[class*="DivCommentObjectWrapper"]',
    item: '[class*="DivCommentItemWrapper"]',
    replyBox: '[class*="DivReplyContainer"]',
    viewReplies: '[class*="DivViewRepliesContainer"]',
    list: '[class*="DivCommentListContainer"]',
    scroller: '[class*="DivCommentMain"]',
    sub: '[class*="DivCommentSubContentWrapper"]',
    like: '[class*="DivLikeContainer"]',
    commentIcon: '[data-e2e="comment-icon"]'
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (sel, root = document) => root.querySelector(sel);
  const qa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  let cancelado = false;

  function progresso(fase, atual, alvo, extra = {}) {
    try {
      chrome.runtime.sendMessage({ tipo: 'progresso', fase, atual, alvo, ...extra });
    } catch (e) { /* popup fechado */ }
  }

  // ---------- texto e numeros ----------

  function textoDe(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('img').forEach((img) => {
      img.replaceWith(document.createTextNode(img.getAttribute('alt') || ''));
    });
    return clone.textContent.replace(/[ \t]+/g, ' ').trim();
  }

  function numeroDe(txt) {
    if (txt === null || txt === undefined) return 0;
    const t = String(txt).trim().toLowerCase().replace(/ /g, ' ');
    const m = t.match(/([\d.,]+)\s*(k|m|b|mil|mi|bi)?/);
    if (!m) return 0;
    let n = parseFloat(m[1].replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
    if (isNaN(n)) return 0;
    const suf = m[2];
    if (suf === 'k' || suf === 'mil') n *= 1e3;
    else if (suf === 'm' || suf === 'mi') n *= 1e6;
    else if (suf === 'b' || suf === 'bi') n *= 1e9;
    return Math.round(n);
  }

  const RE_HASHTAG = /#[\p{L}\p{N}_]+/gu;
  const hashtagsDe = (txt) => [...new Set((txt.match(RE_HASHTAG) || []).map((h) => h.toLowerCase()))];

  // ---------- metadados do video ----------

  function metaDoVideo() {
    const base = {
      id: (location.pathname.match(/\/video\/(\d+)/) || [])[1] || null,
      url: location.origin + location.pathname,
      autor: (location.pathname.match(/\/@([^/]+)/) || [])[1] || null,
      autorNome: null,
      descricao: '',
      publicadoEm: null,
      duracaoSegundos: null,
      musica: null,
      estatisticas: {},
      hashtags: []
    };
    try {
      const raw = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
      const dados = JSON.parse(raw.textContent);
      const it = dados.__DEFAULT_SCOPE__['webapp.video-detail'].itemInfo.itemStruct;
      base.id = it.id || base.id;
      base.autor = it.author?.uniqueId || base.autor;
      base.autorNome = it.author?.nickname || null;
      base.descricao = it.desc || '';
      base.publicadoEm = it.createTime ? new Date(it.createTime * 1000).toISOString() : null;
      base.duracaoSegundos = it.video?.duration ?? null;
      base.musica = it.music ? [it.music.title, it.music.authorName].filter(Boolean).join(' - ') : null;
      const s = it.statsV2 || it.stats || {};
      base.estatisticas = {
        visualizacoes: numeroDe(s.playCount),
        curtidas: numeroDe(s.diggCount),
        comentarios: numeroDe(s.commentCount),
        compartilhamentos: numeroDe(s.shareCount),
        salvos: numeroDe(s.collectCount)
      };
      base.hashtags = [...new Set((it.textExtra || [])
        .map((t) => t.hashtagName)
        .filter(Boolean)
        .map((t) => '#' + t.toLowerCase()))];
    } catch (e) {
      base.descricao = textoDe(q('[data-e2e="video-desc"]'));
      base.estatisticas = {
        curtidas: numeroDe(textoDe(q('[data-e2e="like-count"]'))),
        comentarios: numeroDe(textoDe(q('[data-e2e="comment-count"]'))),
        salvos: numeroDe(textoDe(q('[data-e2e="favorite-count"]'))),
        compartilhamentos: numeroDe(textoDe(q('[data-e2e="share-count"]')))
      };
    }
    if (!base.hashtags.length) {
      base.hashtags = [...new Set(qa('a[href*="/tag/"]')
        .map((a) => textoDe(a).toLowerCase())
        .filter((t) => t.startsWith('#')))];
    }
    if (!base.hashtags.length) base.hashtags = hashtagsDe(base.descricao);
    return base;
  }

  // ---------- painel ----------

  function scroller() {
    const direto = q(SEL.scroller);
    if (direto) return direto;
    let n = q(SEL.list);
    while (n && n !== document.body) {
      const s = getComputedStyle(n);
      if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && n.scrollHeight > n.clientHeight + 40) return n;
      n = n.parentElement;
    }
    return null;
  }

  async function abrirPainel() {
    if (qa(SEL.thread).length) return true;
    const icone = q(SEL.commentIcon);
    if (icone) {
      icone.click();
      for (let i = 0; i < 12; i++) {
        await sleep(600);
        if (qa(SEL.thread).length) return true;
      }
    }
    return qa(SEL.thread).length > 0;
  }

  // ---------- leitura de um comentario ----------

  function lerItem(wrap, nivel) {
    const userSel = `[data-e2e="comment-username-${nivel}"]`;
    const textSel = `[data-e2e="comment-level-${nivel}"]`;
    const link = q('a[href^="/@"]', wrap);
    const perfil = link
      ? decodeURIComponent((link.getAttribute('href') || '').split('?')[0]).replace(/^\//, '')
      : '';
    const sub = q(SEL.sub, wrap);
    const curtidasTxt = textoDe(q(`${SEL.like} span`, wrap));
    const texto = textoDe(q(textSel, wrap));
    return {
      nivel,
      autor: perfil,
      autorNome: textoDe(q(`${userSel} p`, wrap) || q(userSel, wrap)),
      perfilUrl: perfil ? 'https://www.tiktok.com/' + perfil : null,
      texto,
      data: sub ? textoDe(sub.querySelector('span')) : '',
      curtidas: numeroDe(curtidasTxt),
      hashtags: hashtagsDe(texto)
    };
  }

  const chaveDe = (c) => `${c.autor}|${c.data}|${c.texto.slice(0, 60)}`;

  // ---------- expansao de respostas ----------

  async function expandirThread(thread, maxRespostas) {
    let rodadas = 0;
    while (!cancelado && rodadas < 30) {
      const caixa = q(SEL.replyBox, thread);
      const jaTem = caixa ? qa(SEL.item, caixa).length : 0;
      if (jaTem >= maxRespostas) break;
      const botao = qa(SEL.viewReplies, thread).find((b) => {
        const t = textoDe(b).toLowerCase();
        return t && !/ocultar|hide|esconder/.test(t);
      });
      if (!botao) break;
      botao.click();
      rodadas++;
      // espera ate as respostas aparecerem (no maximo 1,6s), sem travar em sleep fixo
      for (let i = 0; i < 16; i++) {
        await sleep(100);
        const cx = q(SEL.replyBox, thread);
        if (cx && qa(SEL.item, cx).length > jaTem) break;
      }
    }
  }

  async function expandirVisiveis(maxRespostas) {
    for (const t of qa(SEL.thread)) {
      if (cancelado) return;
      if (t.dataset.tkExpandido === '1') continue;
      await expandirThread(t, maxRespostas);
      t.dataset.tkExpandido = '1';
    }
  }

  function colher(mapa, maxRespostas) {
    for (const t of qa(SEL.thread)) {
      const caixa = q(SEL.replyBox, t);
      const principal = qa(SEL.item, t).find((w) => !caixa || !caixa.contains(w));
      if (!principal) continue;
      const item = lerItem(principal, 1);
      if (!item.texto && !item.autor) continue;
      item.respostas = caixa ? qa(SEL.item, caixa).map((w) => lerItem(w, 2)).slice(0, maxRespostas) : [];
      const k = chaveDe(item);
      const anterior = mapa.get(k);
      if (!anterior || item.respostas.length > anterior.respostas.length) {
        item.posicao = anterior ? anterior.posicao : mapa.size + 1;
        mapa.set(k, item);
      }
    }
  }


  // ---------- modo API (rapido e completo) ----------
  // Usa os mesmos endpoints internos que a propria pagina chama, com os cookies
  // da sessao aberta. Nada e enviado para fora: tudo fica no navegador.

  const API = 'https://www.tiktok.com/api/comment/list/';
  const API_REPLY = 'https://www.tiktok.com/api/comment/list/reply/';

  async function pedir(url) {
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (!j || (!j.comments && j.status_code)) throw new Error('resposta inesperada da API');
    return j;
  }

  function normalizar(c, nivel) {
    const u = c.user || {};
    const perfil = u.unique_id ? '@' + u.unique_id : '';
    const texto = c.text || '';
    return {
      nivel,
      id: c.cid || null,
      autor: perfil,
      autorNome: u.nickname || '',
      perfilUrl: perfil ? 'https://www.tiktok.com/' + perfil : null,
      texto,
      data: c.create_time ? new Date(c.create_time * 1000).toISOString().slice(0, 10) : '',
      dataHora: c.create_time ? new Date(c.create_time * 1000).toISOString() : '',
      curtidas: c.digg_count || 0,
      respostasTotal: c.reply_comment_total || 0,
      fixado: !!c.stick_position,
      hashtags: hashtagsDe(texto)
    };
  }

  async function respostasDe(videoId, cid, maxRespostas) {
    const out = [];
    let cursor = 0;
    while (out.length < maxRespostas) {
      const url = `${API_REPLY}?aid=1988&app_language=pt-BR&region=BR&item_id=${videoId}`
        + `&comment_id=${cid}&count=${Math.min(50, maxRespostas - out.length)}&cursor=${cursor}`;
      let j;
      try { j = await pedir(url); } catch (e) { break; }
      const lote = j.comments || [];
      if (!lote.length) break;
      out.push(...lote.map((r) => normalizar(r, 2)));
      cursor = j.cursor ?? cursor + lote.length;
      if (!j.has_more) break;
      await sleep(200);
    }
    return out.slice(0, maxRespostas);
  }

  async function coletarViaApi(videoId, limite, maxRespostas) {
    const brutos = [];
    let cursor = 0;
    while (brutos.length < limite && !cancelado) {
      const url = `${API}?aid=1988&app_language=pt-BR&region=BR&aweme_id=${videoId}`
        + `&count=${Math.min(50, limite - brutos.length)}&cursor=${cursor}`;
      const j = await pedir(url);
      const lote = j.comments || [];
      if (!lote.length) break;
      brutos.push(...lote);
      cursor = j.cursor ?? cursor + lote.length;
      progresso('coletando', Math.min(brutos.length, limite), limite);
      if (!j.has_more) break;
      await sleep(250);
    }

    const comentarios = brutos.slice(0, limite).map((c) => normalizar(c, 1));
    comentarios.forEach((c) => { c.respostas = []; });

    if (maxRespostas > 0) {
      const comResposta = comentarios.filter((c) => c.respostasTotal > 0);
      let feitos = 0;
      let proximo = 0;
      const trabalhador = async () => {
        while (proximo < comResposta.length && !cancelado) {
          const alvo = comResposta[proximo++];
          alvo.respostas = await respostasDe(videoId, alvo.id, maxRespostas);
          progresso('respostas', ++feitos, comResposta.length);
          await sleep(120);
        }
      };
      // 3 buscas em paralelo: rapido sem martelar o servidor
      await Promise.all([trabalhador(), trabalhador(), trabalhador()]);
    }
    return comentarios;
  }

  // ---------- loop principal ----------

  async function coletarViaDom(limite, teto) {
    progresso('abrindo', 0, limite);
    if (!(await abrirPainel())) {
      throw new Error('Nao encontrei o painel de comentarios. Abra os comentarios e tente de novo.');
    }

    const box = scroller();
    const mapa = new Map();
    let paradas = 0;

    if (box) { box.scrollTop = 0; await sleep(1000); }

    for (let ciclo = 0; ciclo < 500 && !cancelado; ciclo++) {
      if (teto > 0) await expandirVisiveis(teto);
      const antesN = mapa.size;
      colher(mapa, teto);
      progresso('coletando', Math.min(mapa.size, limite), limite);
      if (mapa.size >= limite) break;
      if (!box) break;

      const antesTopo = box.scrollTop;
      box.scrollTop = Math.min(box.scrollTop + Math.floor(box.clientHeight * 0.7), box.scrollHeight);
      box.dispatchEvent(new WheelEvent('wheel', { deltaY: 600, bubbles: true }));
      await sleep(850);

      if (box.scrollTop === antesTopo && mapa.size === antesN) {
        // provavelmente no fim da lista: sacode a rolagem para acionar o carregamento
        box.scrollTop = Math.max(0, antesTopo - 400);
        await sleep(450);
        box.scrollTop = box.scrollHeight;
        await sleep(1400);
        paradas++;
        if (paradas >= 5) break; // acabaram os comentarios
      } else {
        paradas = 0;
      }
    }

    return [...mapa.values()].slice(0, limite);
  }

  async function coletar({ limite = 100, incluirRespostas = true, maxRespostas = 20 } = {}) {
    cancelado = false;
    const videoId = (location.pathname.match(/\/video\/(\d+)/) || [])[1];
    if (!videoId) throw new Error('Abra a pagina de um video do TikTok (.../@perfil/video/123...).');
    const teto = incluirRespostas ? Math.max(0, maxRespostas) : 0;

    let bruto;
    let fonte = 'api';
    try {
      bruto = await coletarViaApi(videoId, limite, teto);
      if (!bruto.length) throw new Error('API sem resultados');
    } catch (e) {
      fonte = 'dom';
      bruto = await coletarViaDom(limite, teto);
    }
    if (!bruto.length) throw new Error('Nenhum comentario encontrado neste video.');

    const comentarios = bruto.map((c, i) => ({ posicao: i + 1, ...c, respostas: c.respostas || [] }));
    const video = metaDoVideo();
    const totalRespostas = comentarios.reduce((s, c) => s + c.respostas.length, 0);

    const contagem = new Map();
    const somar = (tags) => tags.forEach((h) => contagem.set(h, (contagem.get(h) || 0) + 1));
    comentarios.forEach((c) => { somar(c.hashtags); c.respostas.forEach((r) => somar(r.hashtags)); });
    const nosComentarios = [...contagem.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([tag, vezes]) => ({ tag, vezes }));

    return {
      capturadoEm: new Date().toISOString(),
      fonte,
      video,
      parametros: { limite, incluirRespostas, maxRespostas: teto },
      totais: {
        comentarios: comentarios.length,
        respostas: totalRespostas,
        geral: comentarios.length + totalRespostas,
        comentariosNoVideo: video.estatisticas?.comentarios ?? null
      },
      hashtags: {
        doVideo: video.hashtags,
        nosComentarios,
        todas: [...new Set([...video.hashtags, ...nosComentarios.map((h) => h.tag)])]
      },
      comentarios
    };
  }

  // ---------- Captura automática ao abrir a página do vídeo ----------
  let autoEnviado = false;
  function mostrarStatusAuto(texto, tipo = 'ok') {
    let el = document.getElementById('__tkColetorAutoStatus');
    if (!el) {
      el = document.createElement('div');
      el.id = '__tkColetorAutoStatus';
      el.style.cssText = 'position:fixed;top:12px;right:12px;z-index:99999;padding:10px 16px;border-radius:8px;font:600 13px/1.3 system-ui,sans-serif;color:#fff;background:#10b981;box-shadow:0 4px 12px rgba(0,0,0,.3);transition:opacity .3s;pointer-events:none;';
      document.body.appendChild(el);
    }
    el.textContent = texto;
    el.style.background = tipo === 'erro' ? '#ef4444' : tipo === 'enviando' ? '#f59e0b' : '#10b981';
    el.style.opacity = '1';
    if (tipo === 'ok') setTimeout(() => { el.style.opacity = '0'; }, 4000);
  }

  async function tentarEnvioAutomatico() {
    if (autoEnviado) return;
    const videoId = (location.pathname.match(/\/video\/(\d+)/) || [])[1];
    if (!videoId) return;

    const config = await chrome.storage.local.get(['shortCtaUrl', 'shortCtaToken', 'autoCaptura']);
    const url = config.shortCtaUrl || 'http://127.0.0.1:3000';
    if (!url || !config.shortCtaToken) return;
    if (config.autoCaptura === false) return;

    autoEnviado = true;
    mostrarStatusAuto('Capturando comentários automaticamente…', 'enviando');

    try {
      const dados = await coletar({ limite: 100, incluirRespostas: true, maxRespostas: 20 });
      mostrarStatusAuto(`Capturado: ${dados.totais.comentarios} comentários. Enviando…`, 'enviando');

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

      const baseUrl = `${url.replace(/\/+$/, '')}/api/comments/ingest`;
      const hashtags = dados.hashtags || { doVideo: [], nosComentarios: [], todas: [] };
      const CHUNK = 200;
      let totalGravados = 0;

      for (let i = 0; i < comments.length; i += CHUNK) {
        const fatia = comments.slice(i, i + CHUNK);
        const payload = {
          postUrl: dados.video?.url || location.href,
          comments: fatia,
          // Envia hashtags apenas no primeiro chunk para evitar duplicação
          hashtags: i === 0 ? hashtags : { doVideo: [], nosComentarios: [], todas: [] },
        };

        // Delega o fetch ao background service worker para evitar bloqueios de CORS/permissões do content script
        const response = await chrome.runtime.sendMessage({
          tipo: 'fetchIngest',
          url: baseUrl,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.shortCtaToken}`,
          },
          body: JSON.stringify(payload),
        });

        if (!response || !response.ok) {
          const msg = response?.body?.error || response?.body || `Falha na comunicação (status ${response?.status || 0})`;
          throw new Error(msg);
        }

        totalGravados += response.body?.gravados ?? fatia.length;
      }

      mostrarStatusAuto(`✓ Enviado: ${totalGravados} comentários + hashtags`, 'ok');
    } catch (e) {
      mostrarStatusAuto(`Falha no envio automático: ${e.message || e}`, 'erro');
    }
  }

  // Aguarda o DOM carregar antes de iniciar a captura automática
  if (document.readyState === 'complete') {
    setTimeout(tentarEnvioAutomatico, 2000);
  } else {
    window.addEventListener('load', () => setTimeout(tentarEnvioAutomatico, 2000));
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.tipo === 'ping') { sendResponse({ ok: true }); return true; }
    if (msg?.tipo === 'cancelar') { cancelado = true; sendResponse({ ok: true }); return true; }
    if (msg?.tipo !== 'coletar') return;
    coletar(msg.opcoes || {})
      .then((dados) => sendResponse({ ok: true, dados }))
      .catch((err) => sendResponse({ ok: false, erro: String(err.message || err) }));
    return true;
  });
})();
