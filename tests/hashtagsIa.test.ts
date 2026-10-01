import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { validateHashtags, validateJapaneseCaption } from "../src/lib/pipeline/validation";
import { hashtagsSystemPrompt, japaneseCaptionSystemPrompt } from "../src/lib/prompts";

/**
 * Hashtags geradas por IA na página de Exportações.
 *
 * O que se garante aqui é o que o prompt NÃO pode garantir sozinho: hashtag de
 * volume não entra, e nenhuma repete as que o vídeo já tem.
 */

vi.mock("../src/lib/auth", () => ({ isAuthenticated: async () => true, guardApi: async () => null }));

describe("validação das hashtags", () => {
  it("recusa as de volume, que não trazem alcance", () => {
    const out = validateHashtags(
      { hashtags: [{ tag: "#viral" }, { tag: "#fyp" }, { tag: "#ficcaocientifica", reason: "o gênero do corte" }] },
      [],
      2,
    );
    expect(out).toEqual([{ tag: "#ficcaocientifica", reason: "o gênero do corte" }]);
  });

  it("não repete o que o vídeo já tem, nem entre si", () => {
    const out = validateHashtags(
      { hashtags: [{ tag: "#filme" }, { tag: "#FILME" }, { tag: "#viagemnotempo" }, { tag: "#viagemnotempo" }] },
      ["#filme"],
      5,
    );
    expect(out.map((h) => h.tag)).toEqual(["#viagemnotempo"]);
  });

  it("normaliza acento, maiúscula e símbolo", () => {
    const out = validateHashtags({ hashtags: [{ tag: "#Ficção Científica!" }] }, [], 2);
    expect(out[0].tag).toBe("#ficcaocientifica");
  });

  it("entrega no máximo o pedido", () => {
    const out = validateHashtags(
      { hashtags: [{ tag: "#um" }, { tag: "#dois" }, { tag: "#tres" }, { tag: "#quatro" }] },
      [],
      2,
    );
    expect(out).toHaveLength(2);
  });

  it("só genéricas = erro explícito, não lista vazia em silêncio", () => {
    expect(() => validateHashtags({ hashtags: [{ tag: "#viral" }, { tag: "#parati" }] }, [], 2)).toThrow(
      /nenhuma hashtag nova e específica/i,
    );
  });

  it("resposta fora do contrato vira erro", () => {
    expect(() => validateHashtags({ tags: ["#a"] }, [], 2)).toThrow(/contrato de saída/i);
  });

  it("o prompt manda as que o vídeo já tem e proíbe as de volume", () => {
    const p = hashtagsSystemPrompt(2, ["#filme", "#cenasdefilme"]);
    expect(p).toContain("#filme #cenasdefilme");
    expect(p).toContain("exatamente 2");
    expect(p).toMatch(/#viral/);
  });
});

describe("legenda em japonês", () => {
  const TAG = "#tvアニメ";

  it("garante a hashtag na primeira linha quando o modelo esquece", () => {
    const out = validateJapaneseCaption({ caption: "午前2時、誰もいないラーメン店で奇妙なことが起きた…。" }, TAG);
    expect(out.startsWith(`${TAG} `)).toBe(true);
    expect(out).toContain("午前2時");
  });

  it("não duplica a hashtag quando o modelo já a colocou", () => {
    const out = validateJapaneseCaption({ caption: `${TAG} 深夜のラーメン店に、毎晩やって来る不思議な客。` }, TAG);
    expect(out.match(/#tvアニメ/g)).toHaveLength(1);
    expect(out.startsWith(TAG)).toBe(true);
  });

  it("resposta em português é recusada: a legenda perderia a razão de ser", () => {
    expect(() => validateJapaneseCaption({ caption: "Ele inventou uma maquina do tempo" }, TAG)).toThrow(
      /não veio em japonês/i,
    );
  });

  it("preserva as quebras de linha do formato", () => {
    const caption = `${TAG}『鏡の国のミステリー』\n鏡の国に潜む謎を一挙公開！\n◆注目のポイント：`;
    expect(validateJapaneseCaption({ caption }, TAG).split("\n")).toHaveLength(3);
  });

  it("fora do contrato vira erro", () => {
    expect(() => validateJapaneseCaption({ texto: "..." }, TAG)).toThrow(/contrato de saída/i);
  });

  it("o prompt leva a hashtag configurada e os dois formatos", () => {
    const p = japaneseCaptionSystemPrompt("#TVアニメ");
    expect(p).toContain("#TVアニメ");
    expect(p).toContain("FORMATO A");
    expect(p).toContain("FORMATO B");
  });
});

// --------------------------------- Rota -------------------------------------

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shortcta-hashtags-"));
const gerar = vi.fn();

const gerarJp = vi.fn();

vi.mock("../src/lib/providers/ai", async () => ({
  aiProvider: () => ({ generateHashtags: gerar, generateJapaneseCaption: gerarJp }),
  AiError: (await vi.importActual<typeof import("../src/lib/providers/ai/errors")>("../src/lib/providers/ai/errors"))
    .AiError,
}));

let dbMod: typeof import("../src/lib/db");
let repo: typeof import("../src/lib/repo");
let route: typeof import("../src/app/api/exports/hashtags/route");

beforeAll(async () => {
  process.env.DATA_DIR = tmpDir;
  process.env.DATABASE_PATH = path.join(tmpDir, "teste.db");
  vi.resetModules();
  dbMod = await import("../src/lib/db");
  repo = await import("../src/lib/repo");
  route = await import("../src/app/api/exports/hashtags/route");
  dbMod.db();
});

afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Windows pode segurar o banco; a pasta é temporária.
  }
});

afterEach(() => {
  gerar.mockReset();
  gerarJp.mockReset();
  gerarJp.mockResolvedValue("#tvアニメ 午前2時、奇妙なことが起きた…。");
});

/** Liga ou desliga a legenda japonesa para isolar o que o teste mede. */
async function legendaJp(ligada: boolean) {
  const settings = await import("../src/lib/settings");
  settings.saveSettings({ publish: { japaneseCaption: ligada } });
}

let seq = 0;
function video(): string {
  const name = `v${++seq}`;
  const file = path.join(tmpDir, `${name}.mp4`);
  fs.writeFileSync(file, "x");
  return repo.createVideo({
    originalName: `${name}.mp4`,
    storedName: `${name}.mp4`,
    path: file,
    hash: `h_${name}`,
    bytes: 1,
    mime: "video/mp4",
  }).id;
}

function post(body: unknown) {
  return route.POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }));
}

describe("rota que gera as hashtags", () => {
  it("gera, salva e devolve o que foi gerado", async () => {
    await legendaJp(false);
    const id = video();
    gerar.mockResolvedValue([
      { tag: "#viagemnotempo", reason: "o enredo" },
      { tag: "#suspense", reason: "o clima" },
    ]);

    const data = (await (await post({ videoIds: [id] })).json()) as { gerados: unknown[]; porVideo: number };
    expect(data.gerados).toHaveLength(1);
    expect(data.porVideo).toBe(2);
    expect(repo.getVideoHashtags(id)?.ia.map((h) => h.tag)).toEqual(["#viagemnotempo", "#suspense"]);
  });

  it("vídeo que já tem sugestão é pulado: não gasta chamada à toa", async () => {
    await legendaJp(false);
    const id = video();
    repo.saveAiHashtags(id, [{ tag: "#ja", reason: null }]);

    const data = (await (await post({ videoIds: [id] })).json()) as { pulados: unknown[] };
    expect(data.pulados).toHaveLength(1);
    expect(gerar).not.toHaveBeenCalled();
  });

  it("com a legenda japonesa ligada, gera e salva com a hashtag configurada", async () => {
    await legendaJp(true);
    const id = video();
    gerar.mockResolvedValue([{ tag: "#nova", reason: null }]);

    await post({ videoIds: [id] });
    expect(gerarJp).toHaveBeenCalledTimes(1);
    expect(gerarJp.mock.calls[0][1]).toBe("#tvアニメ");
    expect(repo.getJapaneseCaption(id)?.text).toContain("午前2時");
  });

  it("ligar a legenda depois não deixa de fora quem já tinha as hashtags", async () => {
    await legendaJp(false);
    const id = video();
    gerar.mockResolvedValue([{ tag: "#primeira", reason: null }]);
    await post({ videoIds: [id] });
    expect(repo.getJapaneseCaption(id)).toBeNull();

    // Agora o usuário liga a opção: o vídeo não pode ser "pulado por já ter
    // hashtags" — faltaria justamente a legenda. E as hashtags não são refeitas.
    await legendaJp(true);
    gerar.mockClear();
    await post({ videoIds: [id] });
    expect(gerar).not.toHaveBeenCalled();
    expect(gerarJp).toHaveBeenCalledTimes(1);
    expect(repo.getJapaneseCaption(id)?.text).toContain("午前2時");
  });

  it("desligada, não gera legenda nenhuma", async () => {
    await legendaJp(false);
    const id = video();
    gerar.mockResolvedValue([{ tag: "#x", reason: null }]);

    await post({ videoIds: [id] });
    expect(gerarJp).not.toHaveBeenCalled();
    expect(repo.getJapaneseCaption(id)).toBeNull();
  });

  it("com `force`, refaz — e as antigas entram na lista de não repetir", async () => {
    const id = video();
    repo.saveAiHashtags(id, [{ tag: "#antiga", reason: null }]);
    gerar.mockResolvedValue([{ tag: "#nova", reason: null }]);

    await post({ videoIds: [id], force: true });
    expect(gerar).toHaveBeenCalledTimes(1);
    expect(gerar.mock.calls[0][1]).toContain("#antiga");
    expect(repo.getVideoHashtags(id)?.ia.map((h) => h.tag)).toEqual(["#nova"]);
  });

  it("as capturadas pela extensão entram no 'não repita'", async () => {
    const id = video();
    repo.saveVideoHashtags(id, { doVideo: ["#filme", "#cenasdefilme"], nosComentarios: [], todas: [] });
    gerar.mockResolvedValue([{ tag: "#nova", reason: null }]);

    await post({ videoIds: [id] });
    expect(gerar.mock.calls[0][1]).toEqual(expect.arrayContaining(["#filme", "#cenasdefilme"]));
  });

  it("falha num vídeo não derruba o lote, e é relatada", async () => {
    await legendaJp(false);
    const a = video();
    const b = video();
    gerar.mockRejectedValueOnce(new Error("modelo fora do ar")).mockResolvedValueOnce([{ tag: "#ok", reason: null }]);

    const data = (await (await post({ videoIds: [a, b] })).json()) as {
      gerados: unknown[];
      falhas: Array<{ reason: string }>;
    };
    expect(data.gerados).toHaveLength(1);
    expect(data.falhas[0].reason).toBe("modelo fora do ar");
  });

  it("cota esgotada para o lote: insistir só queimaria o resto da cota", async () => {
    const a = video();
    const b = video();
    const c = video();
    const { AiError } = await import("../src/lib/providers/ai/errors");
    gerar.mockRejectedValue(new AiError("quota_exhausted", "Cota do dia esgotada."));

    const data = (await (await post({ videoIds: [a, b, c] })).json()) as { falhas: unknown[] };
    expect(gerar).toHaveBeenCalledTimes(1);
    expect(data.falhas).toHaveLength(1);
  });
});
