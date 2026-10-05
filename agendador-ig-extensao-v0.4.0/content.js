"use strict";
(() => {
  // src/content/automation/dom.ts
  var StepError = class extends Error {
    constructor(step, message) {
      super(message);
      this.step = step;
    }
    step;
  };
  var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  var humanPause = (base = 350) => sleep(base + Math.round(Math.random() * base * 0.6));
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05;
  }
  async function waitFor(fn, step, timeout = 15e3, interval = 150) {
    const t0 = Date.now();
    for (; ; ) {
      let v = null;
      try {
        v = fn();
      } catch {
        v = null;
      }
      if (v) return v;
      if (Date.now() - t0 > timeout) throw new StepError(step, `Tempo esgotado em: ${step}`);
      await sleep(interval);
    }
  }
  var textOf = (el) => (el.textContent ?? "").replace(/ /g, " ").trim();
  var matches = (t, list) => (Array.isArray(list) ? list : [list]).includes(t);
  function visibleDialogs() {
    return [...document.querySelectorAll('div[role="dialog"]')].filter(isVisible);
  }
  function topDialog() {
    const list = visibleDialogs();
    return list[list.length - 1] ?? null;
  }
  function dialogTitle(d) {
    if (!d) return "";
    const h = d.querySelector('h1, h2, [role="heading"]');
    return (d.getAttribute("aria-label") ?? "") + "|" + (h ? textOf(h) : "");
  }
  function clickableOf(el) {
    return el?.closest('button, [role="button"], a, [role="link"]') ?? null;
  }
  function byIcon(root, labels) {
    for (const l of labels) {
      const svg = [...root.querySelectorAll(`svg[aria-label="${l}"]`)].find((s) => isVisible(s));
      const c = clickableOf(svg ?? null);
      if (c) return c;
    }
    return null;
  }
  function buttonByText(root, labels) {
    const list = [...root.querySelectorAll('button, [role="button"]')];
    return list.find((b) => isVisible(b) && matches(textOf(b), labels)) ?? null;
  }
  function leafByText(root, test) {
    const all = root.querySelectorAll("span, div, h1, h2");
    for (const el of all) {
      if (el.children.length === 0 && test(textOf(el)) && isVisible(el)) return el;
    }
    return null;
  }
  function click(el) {
    el.scrollIntoView?.({ block: "center", inline: "nearest" });
    el.click();
  }
  function keydown(el, keyCode, key) {
    const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    Object.defineProperty(e, "keyCode", { get: () => keyCode });
    Object.defineProperty(e, "which", { get: () => keyCode });
    el.dispatchEvent(e);
  }
  var inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  async function typeChars(el, text) {
    el.focus();
    for (const ch of text) {
      inputSetter?.call(el, ch);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(110);
    }
  }

  // src/content/automation/selectors.ts
  var SEL = {
    // Barra lateral
    createIcon: ["Novo post", "New post"],
    // svg[aria-label] do item "Criar"
    postIcon: ["Postar", "Post"],
    // svg[aria-label] do submenu "Postar"
    // Janela de criacao
    dialogCreate: ["Criar novo post", "Create new post"],
    dialogCrop: ["Cortar", "Crop"],
    dialogEdit: ["Editar", "Edit"],
    headingNewReel: ["Novo reel", "New reel"],
    cropButtonIcon: ["Selecionar corte", "Select crop"],
    ratio916: "9:16",
    next: ["Avan\xE7ar", "Next"],
    share: ["Compartilhar", "Share"],
    schedule: ["Programar", "Schedule"],
    scheduleToggleLabel: ["Programar conte\xFAdo", "Schedule content"],
    captionEditor: '[contenteditable="true"][role="textbox"]',
    hours: 'input[aria-label="Hours"], input[aria-label="Horas"]',
    minutes: 'input[aria-label="Minutes"], input[aria-label="Minutos"]',
    nextMonth: ["Next month", "Pr\xF3ximo m\xEAs"],
    prevMonth: ["Previous month", "M\xEAs anterior"],
    closeIcon: ["Fechar", "Close"],
    discard: ["Descartar", "Discard"],
    reelsNoticeOk: ["OK"],
    // Texto do botao de data: "qui., 29 de out. de 2026" / "Thu, Oct 29, 2026"
    dateButtonText: /^(\S+\.?,?\s+\d{1,2}\s+de\s+\S+\s+de\s+\d{4}|\S+,\s+\S+\s+\d{1,2},\s+\d{4})$/i,
    // Resultado depois de clicar em Programar
    successText: /(foi programad|programad[oa] com sucesso|reel programado|post programado|has been scheduled|was scheduled|reel scheduled|post scheduled)/i,
    errorText: /(não foi possível|nao foi possivel|ocorreu um erro|tente novamente|something went wrong|couldn't|could not|try again)/i,
    // Mensagens de validacao em vermelho dentro da janela (data/hora)
    inlineError: /(dentro d[oa]s? próximos|próximos \d+ dias|escolha (uma )?(data|hora)|horário inválido|data inválida|within the next|choose a (date|time)|invalid (date|time))/i,
    hashtagSuggestion: /^#[^\s]+.*(posts|publicaç|publicac)/i
  };
  var MONTHS_PT = ["janeiro", "fevereiro", "mar\xE7o", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  var MONTHS_EN = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

  // src/content/automation/schedulePost.ts
  var norm = (s) => s.replace(/ /g, " ").replace(/\r/g, "").split("\n").map((l) => l.replace(/\s+$/, "")).join("\n").trim();
  function mainDialog() {
    const list = visibleDialogs();
    return list.filter((d) => d.querySelector(SEL.captionEditor)).pop() ?? list[list.length - 1] ?? null;
  }
  function describeDialog(d) {
    if (!d) return "nenhuma janela aberta";
    const seen = /* @__PURE__ */ new Set();
    for (const el of d.querySelectorAll("span, h1, h2")) {
      if (el.children.length) continue;
      const t = textOf(el);
      if (t.length > 3 && t.length < 40 && isVisible(el) && !t.startsWith("#")) seen.add(t);
      if (seen.size >= 12) break;
    }
    return [...seen].join(", ");
  }
  function dialogHasTitle(labels) {
    const d = topDialog();
    if (!d) return null;
    const title = dialogTitle(d);
    return labels.some((l) => title.includes(l)) ? d : null;
  }
  function dismissNotices() {
    for (const d of visibleDialogs()) {
      const ok = buttonByText(d, SEL.reelsNoticeOk);
      if (ok && /reels?/i.test(d.innerText) && !d.querySelector('input[type="file"]')) click(ok);
    }
  }
  async function openCreateDialog(progress2) {
    progress2('Abrindo "Criar"', 5);
    const createBtn = await waitFor(() => byIcon(document, SEL.createIcon), 'Abrir "Criar"', 1e4);
    click(createBtn);
    await humanPause(300);
    progress2('Escolhendo "Postar"', 8);
    const target = await waitFor(
      () => topDialog()?.querySelector('input[type="file"]') ?? byIcon(document, SEL.postIcon),
      'Escolher "Postar"',
      8e3
    );
    if (!(target instanceof HTMLInputElement)) {
      click(target);
    }
  }
  async function sendVideo(file, progress2) {
    progress2("Enviando o v\xEDdeo", 12);
    const input = await waitFor(
      () => topDialog()?.querySelector('input[type="file"]'),
      'Abrir janela "Criar novo post"',
      1e4
    );
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    progress2("Carregando o v\xEDdeo no Instagram", 18);
    await waitFor(
      () => {
        dismissNotices();
        const d = topDialog();
        if (!d) return null;
        const title = dialogTitle(d);
        if (/Não foi possível|Couldn't|could not/i.test(title)) {
          throw new StepError("Carregar v\xEDdeo", "O Instagram n\xE3o aceitou o arquivo de v\xEDdeo (formato, dura\xE7\xE3o ou tamanho).");
        }
        return byIcon(d, SEL.cropButtonIcon);
      },
      "Carregar v\xEDdeo",
      9e4,
      250
    ).catch((e) => {
      if (e instanceof StepError && e.step === "Carregar v\xEDdeo" && !/não aceitou/.test(e.message)) {
        throw new StepError("Carregar v\xEDdeo", "O v\xEDdeo demorou demais para carregar no Instagram.");
      }
      throw e;
    });
  }
  async function chooseRatio916(progress2) {
    progress2("Selecionando 9:16", 25);
    const d = topDialog();
    click(await waitFor(() => byIcon(d, SEL.cropButtonIcon), "Abrir menu de corte", 5e3));
    await humanPause(250);
    const option = await waitFor(
      () => clickableOf(leafByText(topDialog() ?? document, (t) => t === SEL.ratio916)),
      "Op\xE7\xE3o 9:16",
      5e3
    );
    click(option);
    await humanPause(300);
  }
  async function nextStep(fromTitles, step) {
    const d = await waitFor(() => dialogHasTitle(fromTitles), step, 1e4);
    click(await waitFor(() => buttonByText(d, SEL.next), step, 5e3));
    await humanPause(400);
  }
  async function setCover(cover, progress2) {
    progress2("Colocando a capa", 38);
    const d = await waitFor(() => dialogHasTitle(SEL.dialogEdit), 'Tela "Editar"', 1e4);
    const input = await waitFor(
      () => d.querySelector('input[type="file"][accept*="image"]'),
      "Capa",
      8e3
    ).catch(() => {
      throw new StepError("Capa", 'N\xE3o achei "Selecionar do computador" da foto da capa.');
    });
    const dt = new DataTransfer();
    dt.items.add(cover);
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(2500);
    dismissNotices();
  }
  async function insertCaption(text, progress2) {
    progress2("Escrevendo legenda e hashtags", 45);
    const d = await waitFor(() => dialogHasTitle(SEL.headingNewReel), 'Abrir tela "Novo reel"', 15e3);
    const ed = await waitFor(() => d.querySelector(SEL.captionEditor), "Campo de legenda", 8e3);
    if (!text) return;
    ed.focus();
    await sleep(150);
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    ed.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    await sleep(400);
    if (!norm(ed.innerText)) {
      document.execCommand("insertText", false, text);
      await sleep(400);
    }
    await sleep(1500);
    await closeSuggestions(d, ed);
    if (norm(ed.innerText) !== norm(text)) {
      throw new StepError("Legenda", "A legenda n\xE3o ficou igual ao texto do painel.");
    }
  }
  function suggestionsOpen() {
    return visibleDialogs().some(
      (x) => [...x.querySelectorAll("button")].some((b) => isVisible(b) && SEL.hashtagSuggestion.test(textOf(b)))
    );
  }
  async function closeSuggestions(d, ed) {
    const editor = ed ?? d.querySelector(SEL.captionEditor);
    for (let i = 0; i < 5 && suggestionsOpen(); i++) {
      if (editor) {
        editor.focus();
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
        const first = walker.nextNode();
        const sel = window.getSelection();
        if (first && sel) {
          const r = document.createRange();
          r.setStart(first, 0);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
        }
        await sleep(250);
        keydown(editor, 27, "Escape");
        await sleep(250);
      }
      d.querySelector('h1, h2, [role="heading"]')?.click();
      await sleep(400);
    }
    if (suggestionsOpen()) throw new StepError("Legenda", "N\xE3o foi poss\xEDvel fechar a lista de sugest\xF5es de hashtag.");
  }
  function inlineErrorText(d) {
    const el = leafByText(d, (t) => SEL.inlineError.test(t));
    const alert2 = [...d.querySelectorAll('[role="alert"]')].find((a) => isVisible(a) && textOf(a));
    return el ? textOf(el) : alert2 ? textOf(alert2) : null;
  }
  function findScheduleSwitch(d) {
    let node = leafByText(d, (t) => SEL.scheduleToggleLabel.includes(t));
    for (let i = 0; i < 8 && node; i++) {
      node = node.parentElement;
      const sw = node?.querySelector('input[role="switch"], input[type="checkbox"]');
      if (sw) return sw;
    }
    return null;
  }
  async function enableSchedule(progress2) {
    progress2('Ligando "Programar conte\xFAdo"', 60);
    let lastScroll = 0;
    const t0 = Date.now();
    const sw = await waitFor(
      () => {
        dismissNotices();
        const d = mainDialog();
        if (!d) return null;
        const found = findScheduleSwitch(d);
        if (found) return found;
        if (Date.now() - lastScroll > 3e3) {
          lastScroll = Date.now();
          for (const el of d.querySelectorAll("div")) {
            if (el.scrollHeight > el.clientHeight + 40 && getComputedStyle(el).overflowY.match(/auto|scroll/)) {
              el.scrollTop = el.scrollHeight;
            }
          }
        }
        return null;
      },
      'Op\xE7\xE3o "Programar conte\xFAdo"',
      25e3,
      250
    ).catch(() => {
      const secs = Math.round((Date.now() - t0) / 1e3);
      throw new StepError(
        'Op\xE7\xE3o "Programar conte\xFAdo"',
        `N\xE3o apareceu em ${secs}s. Na tela havia: ${describeDialog(mainDialog())}`
      );
    });
    if (!sw.checked) {
      sw.scrollIntoView({ block: "center" });
      sw.click();
    }
    await waitFor(() => mainDialog()?.querySelector(SEL.hours), "Campos de data e hora", 8e3);
    await humanPause(250);
  }
  function parseMonthHeader(t) {
    const pt = /^([a-zçãé]+) de (\d{4})$/i.exec(t);
    const en = /^([a-z]+) (\d{4})$/i.exec(t);
    const r = pt ?? en;
    if (!r) return null;
    const name = r[1].toLowerCase();
    const m = MONTHS_PT.indexOf(name) >= 0 ? MONTHS_PT.indexOf(name) : MONTHS_EN.indexOf(name);
    return m >= 0 ? { y: +r[2], m } : null;
  }
  async function setDate(date, progress2) {
    progress2("Escolhendo a data", 68);
    const [y, m, day] = date.split("-").map(Number);
    const d = mainDialog();
    const dateBtn = await waitFor(() => clickableOf(leafByText(d, (t) => SEL.dateButtonText.test(t))), "Bot\xE3o de data", 5e3);
    click(dateBtn);
    for (let i = 0; i < 6; i++) {
      const header = await waitFor(
        () => {
          const el = leafByText(document, (t) => !!parseMonthHeader(t));
          return el ? parseMonthHeader(textOf(el)) : null;
        },
        "Abrir calend\xE1rio",
        5e3
      );
      const diff = y * 12 + (m - 1) - (header.y * 12 + header.m);
      if (diff === 0) break;
      const labels = diff > 0 ? SEL.nextMonth : SEL.prevMonth;
      const nav = labels.map((l) => document.querySelector(`[aria-label="${l}"]`)).find(Boolean);
      if (!nav || nav.disabled || nav.getAttribute("aria-disabled") === "true") {
        throw new StepError("Data", "Data fora do per\xEDodo que o Instagram permite agendar (at\xE9 29 dias \xE0 frente).");
      }
      nav.click();
      await sleep(350);
    }
    const cells = [...document.querySelectorAll('[role="gridcell"]')].filter(isVisible);
    const first = cells.findIndex((c) => textOf(c) === "1");
    const cell = cells.slice(Math.max(first, 0)).find((c) => textOf(c) === String(day));
    if (!cell || cell.getAttribute("aria-disabled") === "true") {
      throw new StepError("Data", "Data fora do per\xEDodo que o Instagram permite agendar (at\xE9 29 dias \xE0 frente).");
    }
    click(cell);
    await sleep(350);
    const shown = leafByText(d, (t) => SEL.dateButtonText.test(t));
    const txt = shown ? textOf(shown) : "";
    if (!new RegExp(`\\b${day}\\b`).test(txt) || !txt.includes(String(y))) {
      throw new StepError("Data", `A data n\xE3o foi aplicada (aparece "${txt}").`);
    }
  }
  async function setSpin(input, target, max, step) {
    await typeChars(input, String(target).padStart(2, "0"));
    await sleep(200);
    for (let i = 0; i < max + 2; i++) {
      const now = Number(input.getAttribute("aria-valuenow"));
      if (now === target) return;
      input.focus();
      keydown(input, now < target ? 38 : 40, now < target ? "ArrowUp" : "ArrowDown");
      await sleep(60);
    }
    if (Number(input.getAttribute("aria-valuenow")) !== target) {
      throw new StepError(step, `N\xE3o foi poss\xEDvel ajustar ${step.toLowerCase()}.`);
    }
  }
  async function setTime(time, progress2) {
    progress2("Ajustando o hor\xE1rio", 76);
    const [hh, mm] = time.split(":").map(Number);
    const d = mainDialog();
    const h = await waitFor(() => d.querySelector(SEL.hours), "Campo de hora", 5e3);
    await setSpin(h, hh, 23, "Hora");
    const mi = await waitFor(() => d.querySelector(SEL.minutes), "Campo de minutos", 5e3);
    await setSpin(mi, mm, 59, "Minutos");
    d.querySelector('h1, h2, [role="heading"]')?.click();
    await sleep(300);
    if (Number(h.getAttribute("aria-valuenow")) !== hh || Number(mi.getAttribute("aria-valuenow")) !== mm) {
      throw new StepError("Hora", "O hor\xE1rio n\xE3o ficou igual ao do painel.");
    }
  }
  async function finalCheck(job) {
    const d = mainDialog();
    if (!d) throw new StepError("Revis\xE3o", "A janela do post fechou antes da hora.");
    await closeSuggestions(d);
    await sleep(300);
    const err = inlineErrorText(d);
    if (err) throw new StepError("Data/Hora", `O Instagram recusou a data/hora: ${err}`);
    const ed = d.querySelector(SEL.captionEditor);
    if (job.caption && ed && norm(ed.innerText) !== norm(job.caption)) {
      throw new StepError("Revis\xE3o", "A legenda mudou antes de programar (sugest\xE3o de hashtag?).");
    }
  }
  async function closeAndDiscard() {
    for (let i = 0; i < 3 && visibleDialogs().length; i++) {
      const discard = visibleDialogs().map((d) => buttonByText(d, SEL.discard)).find(Boolean);
      if (discard) {
        click(discard);
      } else {
        const close = byIcon(document, SEL.closeIcon);
        if (!close) break;
        click(close);
      }
      await sleep(700);
    }
    await waitFor(() => visibleDialogs().length === 0, "Fechar janela", 5e3).catch(() => void 0);
  }
  async function confirmSchedule(progress2) {
    progress2('Clicando em "Programar"', 85);
    const d = mainDialog();
    const btn = await waitFor(() => buttonByText(d, SEL.schedule), 'Bot\xE3o "Programar"', 5e3);
    click(btn);
    progress2("Aguardando confirma\xE7\xE3o do Instagram", 90);
    await sleep(5e3);
    const stillThere = () => {
      const x = mainDialog();
      return x && x === d && x.querySelector(SEL.captionEditor) && buttonByText(x, SEL.schedule);
    };
    if (stillThere()) {
      const err = inlineErrorText(d);
      if (err) throw new StepError("Confirma\xE7\xE3o", `O Instagram recusou: ${err}`);
      await closeSuggestions(d).catch(() => void 0);
      const again = buttonByText(d, SEL.schedule);
      if (again) click(again);
      await sleep(5e3);
      if (stillThere()) {
        const err2 = inlineErrorText(d);
        throw new StepError(
          "Confirma\xE7\xE3o",
          err2 ? `O Instagram recusou: ${err2}` : 'O Instagram n\xE3o reagiu ao clique em "Programar". Nada foi agendado.'
        );
      }
    }
    const outcome = await waitFor(
      () => {
        const dialogs = visibleDialogs();
        for (const x of dialogs) {
          const t = x.innerText;
          if (SEL.successText.test(t)) return { ok: true, text: t.split("\n").find((l) => SEL.successText.test(l)) ?? "" };
          if (SEL.errorText.test(t) && !x.querySelector(SEL.captionEditor)) {
            return { ok: false, text: t.split("\n").find((l) => SEL.errorText.test(l)) ?? t.slice(0, 120) };
          }
        }
        if (dialogs.length === 0) return { ok: true, text: "" };
        return null;
      },
      "Confirma\xE7\xE3o",
      18e4,
      400
    );
    if (!outcome.ok) throw new StepError("Confirma\xE7\xE3o", `Instagram respondeu: ${outcome.text}`);
    await sleep(800);
    const close = byIcon(document, SEL.closeIcon);
    if (close && visibleDialogs().length) click(close);
    await sleep(500);
    return outcome.text || "Programado";
  }
  async function schedulePost(job, file, progress2, cover) {
    let opened = false;
    try {
      if (visibleDialogs().length) {
        throw new StepError("In\xEDcio", "H\xE1 uma janela aberta no Instagram. Feche-a e tente de novo.");
      }
      await openCreateDialog(progress2);
      opened = true;
      await sendVideo(file, progress2);
      await chooseRatio916(progress2);
      await nextStep(SEL.dialogCrop, "Avan\xE7ar (corte)");
      if (cover) await setCover(cover, progress2);
      await nextStep(SEL.dialogEdit, "Avan\xE7ar (edi\xE7\xE3o)");
      await insertCaption(job.caption, progress2);
      await enableSchedule(progress2);
      await setTime(job.time, progress2);
      await setDate(job.date, progress2);
      await setTime(job.time, progress2);
      await finalCheck(job);
      if (job.dryRun) {
        progress2("Teste conclu\xEDdo, descartando rascunho", 95);
        await sleep(1500);
        await closeAndDiscard();
        progress2("Teste conclu\xEDdo", 100);
        return { ok: true, message: "Teste conclu\xEDdo: tudo foi preenchido e o rascunho foi descartado." };
      }
      const msg = await confirmSchedule(progress2);
      progress2("Agendado", 100);
      return { ok: true, message: msg };
    } catch (e) {
      const step = e instanceof StepError ? e.step : "Desconhecido";
      const message = e instanceof Error ? e.message : String(e);
      if (opened) await closeAndDiscard().catch(() => void 0);
      return { ok: false, step, message };
    }
  }

  // src/content/content.ts
  var BUTTON_ID = "agendador-ig-open";
  var CHUNK = 4 * 1024 * 1024;
  var running = false;
  function injectButton() {
    if (document.getElementById(BUTTON_ID)) return;
    const host = document.createElement("div");
    host.id = BUTTON_ID;
    host.style.all = "initial";
    host.style.position = "fixed";
    host.style.right = "24px";
    host.style.bottom = "88px";
    host.style.zIndex = "2147483000";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
    <style>
      button {
        font: 600 14px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        display: inline-flex; align-items: center; gap: 8px;
        padding: 12px 16px; border: 0; border-radius: 999px; cursor: pointer;
        color: #fff; background: #4f46e5;
        box-shadow: 0 6px 20px rgba(0,0,0,.35);
        transition: transform .12s ease, background .12s ease;
      }
      button:hover { background: #4338ca; transform: translateY(-1px); }
      button.busy { background: #0f766e; cursor: default; }
      svg { width: 18px; height: 18px; }
    </style>
    <button type="button" title="Abrir o painel do Agendador IG">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/><path d="M12 14v3l2 1"/>
      </svg>
      <span>Agendar posts</span>
    </button>`;
    shadow.querySelector("button")?.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "open-dashboard" }).catch(() => {
        alert("Agendador IG foi atualizado. Recarregue a p\xE1gina do Instagram.");
      });
    });
    document.documentElement.appendChild(host);
  }
  function setBusyLabel(text) {
    const root = document.getElementById(BUTTON_ID)?.shadowRoot;
    const btn = root?.querySelector("button");
    const span = root?.querySelector("span");
    if (!btn || !span) return;
    btn.classList.toggle("busy", !!text);
    span.textContent = text ?? "Agendar posts";
  }
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  async function fetchFile(job, kind) {
    const what = kind === "video" ? "V\xEDdeo" : "Capa";
    const meta = await chrome.runtime.sendMessage({ type: "ag:video-meta", id: job.postId, kind });
    if (!meta || !meta.ok) throw new Error(`${what} n\xE3o encontrado no painel. Deixe o painel aberto durante o envio.`);
    const parts = [];
    for (let start = 0; start < meta.size; start += CHUNK) {
      const end = Math.min(meta.size, start + CHUNK);
      const res = await chrome.runtime.sendMessage({ type: "ag:video-chunk", id: job.postId, kind, start, end });
      if (!res || !res.ok) throw new Error(`Falha ao transferir ${what.toLowerCase()} do painel.`);
      parts.push(b64ToBytes(res.b64));
    }
    if (kind === "cover") return new File(parts, "capa.jpg", { type: meta.mime || "image/jpeg" });
    return new File(parts, job.fileName || "video.mp4", { type: job.mime || meta.mime || "video/mp4" });
  }
  function progress(postId, label) {
    return (step, pct) => {
      setBusyLabel(label ? `${label} \xB7 ${step}\u2026` : `${step}\u2026`);
      chrome.runtime.sendMessage({ type: "ag:progress", postId, step, pct }).catch(() => void 0);
    };
  }
  async function run(job) {
    if (running) return { ok: false, step: "In\xEDcio", message: "J\xE1 existe um agendamento em andamento nesta aba." };
    running = true;
    try {
      const report = progress(job.postId, job.label);
      report("Recebendo o v\xEDdeo do painel", 2);
      let file;
      let cover = null;
      try {
        file = await fetchFile(job, "video");
        if (job.hasCover) cover = await fetchFile(job, "cover");
      } catch (e) {
        return { ok: false, step: "Transfer\xEAncia", message: e instanceof Error ? e.message : String(e) };
      }
      return await schedulePost(job, file, report, cover);
    } finally {
      running = false;
      setBusyLabel(null);
    }
  }
  if (!window.__agendadorIgLoaded) {
    window.__agendadorIgLoaded = true;
    injectButton();
    new MutationObserver(() => injectButton()).observe(document.documentElement, { childList: true });
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === "ag:ping") {
        sendResponse({ ok: true, running });
        return false;
      }
      if (msg?.type === "ag:run") {
        run(msg.job).then(sendResponse);
        return true;
      }
      return false;
    });
  }
})();
