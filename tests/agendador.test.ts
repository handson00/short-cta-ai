import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  AGENDADOR_LIMITES,
  contarCaracteres,
  hashtagsOferecidas,
  montarPost,
  selecaoPadrao,
  type FontesDoPost,
} from "../src/lib/agendadorPost";

/**
 * Envio de exportações para a extensão "Agendador IG".
 *
 * Banco e pastas numa área temporária: nada encosta em data/. O lado da
 * extensão que dá para testar fora do Chrome — as regras de horário — é
 * carregado direto do arquivo que ela usa.
 */

vi.mock("../src/lib/auth", () => ({ isAuthenticated: async () => true, guardApi: async () => null }));

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shortcta-agendador-"));
const FIXTURE = path.join(__dirname, "fixtures", "gancho_topo.mp4");

const fontes = (p: Partial<FontesDoPost> = {}): FontesDoPost => ({
  cta: null,
  ptCaption: null,
  jpCaption: null,
  description: null,
  ...p,
});

// ------------------------------ Montagem do post -----------------------------

describe("montagem do post (igual à extensão)", () => {
  it("abre com a legenda em português e todas as hashtags marcadas", () => {
    const f = fontes({ ptCaption: "Legenda PT", description: "Kit", cta: "CTA" });
    expect(selecaoPadrao(f, ["#a", "#b"])).toEqual({ blocos: ["pt"], hashtags: ["#a", "#b"] });
  });

  it("sem legenda em português, abre com a do kit", () => {
    expect(selecaoPadrao(fontes({ description: "Kit" }), []).blocos).toEqual(["kit"]);
    expect(selecaoPadrao(fontes(), []).blocos).toEqual([]);
  });

  it("junta legenda e hashtags com uma linha em branco, como o painel da extensão", () => {
    const p = montarPost(fontes({ ptCaption: "Olha isso  " }), { blocos: ["pt"], hashtags: ["#filme", "suspense"] });
    expect(p.caption).toBe("Olha isso");
    expect(p.hashtags).toBe("#filme #suspense");
    expect(p.textoFinal).toBe("Olha isso\n\n#filme #suspense");
    expect(p.problemas).toEqual([]);
  });

  it("o CTA abre a legenda, qualquer que seja a ordem dos cliques", () => {
    const p = montarPost(fontes({ cta: "GANCHO", ptCaption: "Legenda" }), { blocos: ["pt", "cta"], hashtags: [] });
    expect(p.textoFinal).toBe("GANCHO\n\nLegenda");
  });

  it("não repete a hashtag que já está na legenda (a japonesa abre com uma)", () => {
    const p = montarPost(fontes({ jpCaption: "#tvアニメ 物語の結末とは…" }), {
      blocos: ["ja"],
      hashtags: ["#TVアニメ", "#映画"],
    });
    expect(p.textoFinal).toBe("#tvアニメ 物語の結末とは…\n\n#映画");
    expect(p.totalHashtags).toBe(2);
  });

  it("só hashtags, sem legenda, também vale", () => {
    expect(montarPost(fontes(), { blocos: [], hashtags: ["#filme"] }).textoFinal).toBe("#filme");
  });

  it("nada marcado é recusado com motivo, não enviado vazio", () => {
    expect(montarPost(fontes({ ptCaption: "x" }), { blocos: [], hashtags: [] }).problemas[0]).toMatch(/marque/i);
  });

  it("hashtag com hífen é recusada, como o Instagram faria", () => {
    const p = montarPost(fontes(), { blocos: [], hashtags: ["#ficção-científica", "#ok"] });
    expect(p.problemas[0]).toMatch(/inválida.*ficção-científica/);
    expect(p.hashtags).toBe("#ok");
  });

  it("acima de 30 hashtags é recusado", () => {
    const tags = Array.from({ length: AGENDADOR_LIMITES.hashtags + 1 }, (_, i) => `#tag${i}`);
    expect(montarPost(fontes(), { blocos: [], hashtags: tags }).problemas.join(" ")).toMatch(/31 hashtags/);
  });

  it("acima de 2200 caracteres é recusado; emoji conta como 1", () => {
    expect(contarCaracteres("👍🏽ok")).toBe(3);
    const longa = "a".repeat(AGENDADOR_LIMITES.caracteres + 1);
    expect(montarPost(fontes({ ptCaption: longa }), { blocos: ["pt"], hashtags: [] }).problemas[0]).toMatch(/2201/);
  });

  it("oferece as capturadas, senão as do kit, e depois as da IA", () => {
    const ia = [{ tag: "#ia" }];
    const ja = [{ tag: "#映画" }];
    expect(hashtagsOferecidas({ hashtags: ["#cap"], kitHashtags: ["#kit"], aiHashtags: ia, aiHashtagsJa: ja })).toEqual([
      "#cap",
      "#ia",
      "#映画",
    ]);
    expect(hashtagsOferecidas({ hashtags: [], kitHashtags: ["#kit"], aiHashtags: [], aiHashtagsJa: [] })).toEqual(["#kit"]);
  });
});

// --------------------- Regras de horário (arquivo da extensão) ---------------

describe("horário do rascunho (regras do painel da extensão)", () => {
  const H = createRequire(__filename)("../agendador-ig-extensao-v0.4.0/ponte-horarios.js") as {
    proximosLivres: (n: number, cfg: object, posts: object[], agora: Date) => Array<{ date: string; time: string }>;
    estadoNormalizado: (salvo: unknown, agora: Date) => { posts: unknown[]; settings: { startDate: string; times: string[] } };
  };
  const cfg = { startDate: "2026-10-05", times: ["19:00", "09:00", "12:00"] };
  const agora = new Date(2026, 9, 2, 10, 0);

  it("pega o primeiro horário da grade, em ordem", () => {
    expect(H.proximosLivres(1, cfg, [], agora)).toEqual([{ date: "2026-10-05", time: "09:00" }]);
  });

  it("pula os horários já ocupados por outros posts", () => {
    const posts = [
      { date: "2026-10-05", time: "09:00" },
      { date: "2026-10-05", time: "12:00" },
    ];
    expect(H.proximosLivres(1, cfg, posts, agora)).toEqual([{ date: "2026-10-05", time: "19:00" }]);
  });

  it("não usa horário a menos de 20 minutos de agora", () => {
    const hoje = { startDate: "2026-10-02", times: ["10:15", "10:30"] };
    expect(H.proximosLivres(1, hoje, [], agora)).toEqual([{ date: "2026-10-02", time: "10:30" }]);
  });

  it("vira o dia quando a grade de hoje acabou", () => {
    const hoje = { startDate: "2026-10-02", times: ["09:00"] };
    expect(H.proximosLivres(1, hoje, [], agora)).toEqual([{ date: "2026-10-03", time: "09:00" }]);
  });

  it("grade sem horário válido não inventa horário", () => {
    expect(H.proximosLivres(1, { startDate: "2026-10-05", times: ["25:00"] }, [], agora)).toEqual([]);
  });

  it("sem estado salvo, usa o padrão do painel: começa amanhã, 09h/12h/19h", () => {
    const e = H.estadoNormalizado(undefined, agora);
    expect(e.posts).toEqual([]);
    expect(e.settings).toMatchObject({ startDate: "2026-10-03", times: ["09:00", "12:00", "19:00"] });
  });

  it("estado salvo é preservado, completando só o que falta", () => {
    const e = H.estadoNormalizado({ version: 1, posts: [{ id: "x" }], settings: { times: ["08:00"] } }, agora);
    expect(e.posts).toEqual([{ id: "x" }]);
    expect(e.settings).toMatchObject({ startDate: "2026-10-03", times: ["08:00"] });
  });
});

// ------------------------------ Rotas e ingresso -----------------------------

let dbMod: typeof import("../src/lib/db");
let repo: typeof import("../src/lib/repo");
let editorRepo: typeof import("../src/lib/editorRepo");
let agendador: typeof import("../src/lib/agendador");
let preparar: typeof import("../src/app/api/agendador/[jobId]/route");
let confirmar: typeof import("../src/app/api/agendador/[jobId]/confirmar/route");
let video: typeof import("../src/app/api/agendador/video/route");
let lista: typeof import("../src/app/api/exports/route");

beforeAll(async () => {
  process.env.DATA_DIR = tmpDir;
  process.env.DATABASE_PATH = path.join(tmpDir, "teste.db");
  process.env.EDITOR_OUTPUT_DIR = path.join(tmpDir, "saida");
  process.env.APP_SESSION_SECRET = "segredo-so-do-teste";
  vi.resetModules();
  dbMod = await import("../src/lib/db");
  repo = await import("../src/lib/repo");
  editorRepo = await import("../src/lib/editorRepo");
  agendador = await import("../src/lib/agendador");
  preparar = await import("../src/app/api/agendador/[jobId]/route");
  confirmar = await import("../src/app/api/agendador/[jobId]/confirmar/route");
  video = await import("../src/app/api/agendador/video/route");
  lista = await import("../src/app/api/exports/route");
  dbMod.db();
});

afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Windows pode segurar o banco; a pasta é temporária.
  }
});

/** Um vídeo exportado de verdade (MP4 válido), com legenda e hashtags. */
function exportado(nome: string): { jobId: string; videoId: string; bytes: number } {
  const v = repo.createVideo({
    originalName: `${nome}.mp4`,
    storedName: `${nome}.mp4`,
    path: FIXTURE,
    hash: `h_${nome}`,
    bytes: 1,
    mime: "video/mp4",
  });
  editorRepo.addVideosToEditor([v.id]);
  repo.saveVideoHashtags(v.id, { doVideo: ["#filme", "#cenasdefilme"], nosComentarios: [], todas: [] });
  repo.saveCaptions(v.id, { pt: "Ele não sabia o que vinha." });
  const out = path.join(tmpDir, `${nome}_editado.mp4`);
  fs.copyFileSync(FIXTURE, out);
  const job = editorRepo.createEditorJob({ videoId: v.id });
  dbMod
    .db()
    .prepare("UPDATE editor_jobs SET status = 'completed', progress = 100, output_path = ?, completed_at = ? WHERE id = ?")
    .run(out, new Date().toISOString(), job.id);
  return { jobId: job.id, videoId: v.id, bytes: fs.statSync(out).size };
}

const params = (jobId: string) => ({ params: Promise.resolve({ jobId }) });

function pedirPreparo(jobId: string, corpo: object, host = "localhost:3000") {
  return preparar.POST(
    new Request(`http://${host}/api/agendador/${jobId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
    }),
    params(jobId),
  );
}

describe("ingresso do vídeo", () => {
  it("libera o job para o qual foi emitido", () => {
    expect(agendador.conferirIngresso(agendador.emitirIngresso("ejb_1"))).toBe("ejb_1");
  });

  it("trocar o job dentro do ingresso invalida a assinatura", () => {
    const [, expira, assinatura] = agendador.emitirIngresso("ejb_1").split(".");
    expect(agendador.conferirIngresso(`ejb_2.${expira}.${assinatura}`)).toBeNull();
  });

  it("vence depois do prazo", () => {
    const emitido = agendador.emitirIngresso("ejb_1", 1_000);
    expect(agendador.conferirIngresso(emitido, 1_000 + agendador.INGRESSO_VALIDADE_MS + 1)).toBeNull();
  });

  it("lixo e ausência são recusados", () => {
    expect(agendador.conferirIngresso(null)).toBeNull();
    expect(agendador.conferirIngresso("abc")).toBeNull();
    expect(agendador.conferirIngresso("a.b.c")).toBeNull();
  });
});

describe("rotas do Agendador", () => {
  it("prepara o post com o que foi marcado e um link do vídeo que a extensão consegue baixar", async () => {
    const e = exportado("preparo");
    const res = await pedirPreparo(e.jobId, { blocos: ["pt"], hashtags: ["#filme", "#naooferecida"] });
    expect(res.status).toBe(200);
    const corpo = await res.json();

    expect(corpo.post).toMatchObject({
      exportJobId: e.jobId,
      videoId: e.videoId,
      fileName: "preparo_editado.mp4",
      mime: "video/mp4",
      size: e.bytes,
      caption: "Ele não sabia o que vinha.",
      // A que a tela não ofereceu fica de fora.
      hashtags: "#filme",
    });
    expect(corpo.post.duration).toBeGreaterThan(0);
    expect(corpo.post.thumb).toMatch(/^data:image\/jpeg;base64,/);
    expect(corpo.textoFinal).toBe("Ele não sabia o que vinha.\n\n#filme");

    const link = new URL(corpo.videoUrl);
    expect(link.origin).toBe("http://localhost:3000");
    expect(link.pathname).toBe("/api/agendador/video");

    const baixado = await video.GET(new Request(link.href));
    expect(baixado.status).toBe(200);
    expect(baixado.headers.get("content-length")).toBe(String(e.bytes));
    expect(Buffer.from(await baixado.arrayBuffer()).length).toBe(e.bytes);
  });

  it("recusa preparar quando o sistema não está aberto pelo localhost", async () => {
    const e = exportado("outrohost");
    const res = await pedirPreparo(e.jobId, { blocos: ["pt"], hashtags: [] }, "192.168.0.10:3000");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/localhost/);
  });

  it("recusa preparar um post vazio, com o motivo", async () => {
    const e = exportado("vazio");
    const res = await pedirPreparo(e.jobId, { blocos: [], hashtags: [] });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/marque/i);
  });

  it("o vídeo não sai sem ingresso válido", async () => {
    expect((await video.GET(new Request("http://localhost:3000/api/agendador/video"))).status).toBe(403);
    expect((await video.GET(new Request("http://localhost:3000/api/agendador/video?t=x.1.y"))).status).toBe(403);
  });

  it("o recibo só aparece depois da confirmação, e reenviar substitui", async () => {
    const e = exportado("recibo");
    const daLista = async () => {
      const corpo = await (await lista.GET()).json();
      return corpo.exports.find((x: { jobId: string }) => x.jobId === e.jobId).agendador;
    };
    expect(await daLista()).toBeNull();

    const confirmarCom = (extPostId: string, hora: string) =>
      confirmar.POST(
        new Request(`http://localhost:3000/api/agendador/${e.jobId}/confirmar`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ extPostId, data: "2026-10-08", hora, texto: "Legenda\n\n#filme" }),
        }),
        params(e.jobId),
      );

    expect((await confirmarCom("post-1", "19:00")).status).toBe(200);
    expect(await daLista()).toMatchObject({ extPostId: "post-1", data: "2026-10-08", hora: "19:00" });

    await confirmarCom("post-2", "09:00");
    expect(await daLista()).toMatchObject({ extPostId: "post-2", hora: "09:00" });
  });
});
