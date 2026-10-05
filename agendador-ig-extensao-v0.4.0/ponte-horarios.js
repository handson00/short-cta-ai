"use strict";
/**
 * Regras de horário do painel do Agendador IG, para o post que chega do
 * Short CTA AI entrar como se tivesse sido importado à mão.
 *
 * Copiadas do painel compilado (0.4.0): `mm`, `Es`, `Fl`, `pd`, `_r`, `ro`,
 * `Ol`, `fd` e o estado padrão `Pi`. O painel não tem código-fonte no projeto;
 * se ele mudar essas regras, mude aqui também — os testes em
 * `tests/agendadorHorarios.test.ts` descrevem o comportamento esperado.
 *
 * Script clássico (sem `import`): o background carrega com `importScripts`, e
 * o vitest com `require`.
 */
(function (raiz) {
  /** Antecedência mínima que o painel exige, em minutos. */
  const ANTECEDENCIA_MIN = 20;
  const CHAVE_ESTADO = "agendador-ig/state";

  const dois = (n) => String(n).padStart(2, "0");

  function horaValida(t) {
    const m = /^(\d{2}):(\d{2})$/.exec(t);
    return !!m && +m[1] < 24 && +m[2] < 60;
  }

  function paraData(data, hora) {
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data);
    const h = /^(\d{2}):(\d{2})$/.exec(hora);
    if (!d || !h) return null;
    const dt = new Date(+d[1], +d[2] - 1, +d[3], +h[1], +h[2], 0, 0);
    return dt.getMonth() !== +d[2] - 1 ? null : dt;
  }

  const textoData = (dt) => `${dt.getFullYear()}-${dois(dt.getMonth() + 1)}-${dois(dt.getDate())}`;

  function somarDias(data, n) {
    const dt = paraData(data, "12:00");
    if (!dt) return data;
    dt.setDate(dt.getDate() + n);
    return textoData(dt);
  }

  const chaveHorario = (p) => (p.date && p.time ? `${p.date} ${p.time}` : "");

  function horarios(qtd, dataInicio, horas, agora) {
    const lista = [...new Set(horas.filter(horaValida))].sort();
    if (qtd <= 0 || lista.length === 0 || !paraData(dataInicio, "00:00")) return [];
    const minimo = agora.getTime() + ANTECEDENCIA_MIN * 60000;
    const saida = [];
    for (let dia = 0; saida.length < qtd && dia < 3650; dia++) {
      const data = somarDias(dataInicio, dia);
      for (const hora of lista) {
        if (saida.length >= qtd) break;
        const dt = paraData(data, hora);
        if (dt && dt.getTime() >= minimo) saida.push({ date: data, time: hora });
      }
    }
    return saida;
  }

  /** Os próximos `qtd` horários livres da grade, pulando os já ocupados por `posts`. */
  function proximosLivres(qtd, config, posts, agora) {
    if (qtd <= 0) return [];
    const ocupados = new Set(posts.map(chaveHorario).filter(Boolean));
    let pedir = qtd + ocupados.size;
    for (let i = 0; i < 8; i++) {
      const livres = horarios(pedir, config.startDate, config.times, agora).filter((s) => !ocupados.has(chaveHorario(s)));
      if (livres.length >= qtd || livres.length === 0) return livres.slice(0, qtd);
      pedir *= 2;
    }
    return [];
  }

  /** O estado como o painel o lê ao abrir, inclusive quando ainda não existe. */
  function estadoNormalizado(salvo, agora) {
    const padrao = {
      version: 1,
      posts: [],
      settings: { startDate: somarDias(textoData(agora), 1), times: ["09:00", "12:00", "19:00"], fixedHashtags: "" },
    };
    if (!salvo || typeof salvo !== "object" || salvo.version !== 1) return padrao;
    return { ...padrao, ...salvo, settings: { ...padrao.settings, ...salvo.settings } };
  }

  const api = { CHAVE_ESTADO, ANTECEDENCIA_MIN, proximosLivres, estadoNormalizado, chaveHorario };
  raiz.AgendadorHorarios = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
