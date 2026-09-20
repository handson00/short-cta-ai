import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Integração real com FFmpeg e Tesseract sobre os vídeos de tests/fixtures.
 * Gere-os antes com `npm run fixtures`. Sem os arquivos, o bloco é ignorado.
 */

const FIXTURES = path.join(process.cwd(), "tests", "fixtures");
const hasFixtures = fs.existsSync(path.join(FIXTURES, "gancho_topo.mp4"));

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shortcta-media-"));

let ffmpeg: typeof import("../src/lib/media/ffmpeg");
let visionModule: typeof import("../src/lib/providers/vision/tesseract");

beforeAll(async () => {
  process.env.DATA_DIR = tmpDir;
  process.env.VISION_PROVIDER = "tesseract";
  ffmpeg = await import("../src/lib/media/ffmpeg");
  visionModule = await import("../src/lib/providers/vision/tesseract");
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("mensagens de falha do OCR", () => {
  it("um pacote de idioma ausente é dito com todas as letras", async () => {
    const { describeTesseractError } = await import("../src/lib/providers/vision/tesseract");
    const { CommandError } = await import("../src/lib/media/run");
    const erro = new CommandError(
      "tesseract falhou (codigo 1)",
      1,
      "Error opening data file /usr/share/tessdata/por.traineddata\nFailed loading language 'por'",
    );
    const msg = describeTesseractError(erro, "por+eng");
    expect(msg).toMatch(/pacote de idioma ausente/);
    expect(msg).toContain("por");
    // A saída precisa dizer o que fazer, não só que falhou.
    expect(msg).toMatch(/tessdata|TESSERACT_LANGS/);
  });

  it("não confunde uma falha do OCR com um vídeo sem texto", async () => {
    const { describeTesseractError } = await import("../src/lib/providers/vision/tesseract");
    const msg = describeTesseractError(new Error("qualquer outra coisa"), "por+eng");
    expect(msg).toBeTruthy();
    expect(msg).not.toMatch(/nenhum texto/i);
  });
});

describe.runIf(hasFixtures)("extração de mídia", () => {
  it("lê metadados com ffprobe", async () => {
    const info = await ffmpeg.probe(path.join(FIXTURES, "gancho_topo.mp4"));
    expect(info.hasVideo).toBe(true);
    expect(info.durationSeconds).toBeGreaterThan(5);
    expect(info.aspectRatio).toBeTruthy();
  });

  it("detecta ausência de trilha de áudio", async () => {
    const info = await ffmpeg.probe(path.join(FIXTURES, "sem_fala_sem_cta.mp4"));
    expect(info.hasAudio).toBe(false);
  });

  it("descarta frames quase idênticos", async () => {
    const out = path.join(tmpDir, "frames_estatico");
    const result = await ffmpeg.extractFrames(path.join(FIXTURES, "gancho_topo.mp4"), 6, out, 12);
    // O vídeo é estático: um punhado de frames idênticos vira um punhado bem
    // menor. O piso não é 1: começo, meio e fim são preservados de propósito,
    // mesmo idênticos, porque é a presença do MESMO texto nos três instantes
    // que prova que o CTA é fixo. Sem eles, um vídeo de fundo parado perderia
    // justamente a evidência de permanência (o average hash 8x8 não enxerga
    // texto sobreposto e descartaria os três).
    expect(result.frames.length).toBeLessThanOrEqual(4);
    expect(result.skipped).toBeGreaterThan(0);
  });

  it("mantém frames de antes e depois de uma animação", async () => {
    const out = path.join(tmpDir, "frames_atrasado");
    const result = await ffmpeg.extractFrames(path.join(FIXTURES, "gancho_atrasado.mp4"), 8, out, 12);
    expect(result.frames.length).toBeGreaterThanOrEqual(2);
  });

  it("gera miniatura", async () => {
    const out = path.join(tmpDir, "thumb.jpg");
    expect(await ffmpeg.extractThumbnail(path.join(FIXTURES, "gancho_topo.mp4"), out, 0.3)).toBe(out);
    expect(fs.statSync(out).size).toBeGreaterThan(0);
  });

  it("extrai áudio apenas quando existe trilha", async () => {
    const semAudio = await ffmpeg.extractAudio(
      path.join(FIXTURES, "sem_fala_sem_cta.mp4"),
      path.join(tmpDir, "a.wav"),
    );
    expect(semAudio).toBeNull();
  });
});

describe.runIf(hasFixtures)("OCR e classificação do texto", () => {
  async function analyze(fixture: string, duration: number) {
    const dir = path.join(tmpDir, `f_${fixture}`);
    const { frames } = await ffmpeg.extractFrames(path.join(FIXTURES, fixture), duration, dir, 8);
    const provider = new visionModule.TesseractVisionProvider();
    return provider.analyzeFrames(frames.map((f) => ({ path: f.path, timestampSeconds: f.timestampSeconds })));
  }

  it("encontra o gancho no terço superior", async () => {
    const result = await analyze("gancho_topo.mp4", 6);
    expect(result.existingCta).not.toBeNull();
    expect(result.existingCta!.text.toUpperCase()).toMatch(/DECIS|CRUEL|SALVOU/);
  });

  it("não promove legenda de diálogo a gancho", async () => {
    const result = await analyze("legenda_marca.mp4", 6);
    const kinds = result.visibleText.map((t) => t.type);
    expect(kinds).toContain("possible_handle");
    if (result.existingCta) {
      expect(result.existingCta.text.toLowerCase()).not.toContain("nao faca isso");
    }
  });

  it("não inventa texto em vídeo sem nada escrito", async () => {
    const result = await analyze("sem_fala_sem_cta.mp4", 6);
    expect(result.existingCta).toBeNull();
  });

  it("não mistura o texto de dois vídeos analisados em paralelo", async () => {
    // Regressão: os arquivos temporários do OCR eram nomeados pelo frame, então
    // dois vídeos processados ao mesmo tempo sobrescreviam o arquivo um do outro.
    const [comGancho, comLegenda] = await Promise.all([
      analyze("gancho_topo.mp4", 6),
      analyze("legenda_marca.mp4", 6),
    ]);

    const textoGancho = comGancho.visibleText.map((t) => t.text.toUpperCase()).join(" ");
    const textoLegenda = comLegenda.visibleText.map((t) => t.text.toUpperCase()).join(" ");

    expect(textoGancho).not.toContain("CORTESDOFILME");
    expect(textoLegenda).not.toMatch(/CRUEL|SALVOU/);
    expect(comGancho.existingCta).not.toBeNull();
  });

  it("declara a limitação de não descrever a cena", async () => {
    const result = await analyze("gancho_topo.mp4", 6);
    expect(result.sceneDescription).toBeNull();
    expect(result.limitations.join(" ")).toMatch(/Descrição visual indisponível/);
  });
});

describe("parseTesseractTsv e a terminação de linha", () => {
  // Regressão do bug que bloqueou o projeto por dois dias.
  //
  // O Tesseract do Windows escreve o TSV com CRLF. O parser cortava só por
  // "\n", a última coluna do cabeçalho virava "text\r", indexOf("text") dava
  // -1 e a leitura inteira era descartada em silêncio — nos 79 vídeos. No
  // Linux, com "\n" puro, nada disso aparecia. Por isso este teste roda os
  // dois formatos sobre a MESMA tabela.
  const CABECALHO =
    "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext";
  const LINHAS = [
    "5\t1\t1\t1\t1\t1\t100\t150\t300\t80\t96\tESSA",
    "5\t1\t1\t1\t1\t2\t410\t150\t300\t80\t95\tGAROTA",
  ];
  const TAMANHO = { width: 1080, height: 1920 };

  for (const [nome, quebra] of [
    ["LF (Linux)", "\n"],
    ["CRLF (Windows)", "\r\n"],
  ] as const) {
    it(`lê o texto com terminação ${nome}`, async () => {
      const { parseTesseractTsv } = await import("../src/lib/providers/vision/tesseract");
      const tsv = [CABECALHO, ...LINHAS].join(quebra) + quebra;
      const linhas = parseTesseractTsv(tsv, 0, TAMANHO);

      expect(linhas).toHaveLength(1);
      expect(linhas[0].text).toBe("ESSA GAROTA");
      // O \r não pode sobrar grudado na última coluna.
      expect(linhas[0].text).not.toMatch(/\r/);
      expect(linhas[0].left).toBe(100);
      expect(linhas[0].confidence).toBeCloseTo(0.955, 2);
    });
  }
});
