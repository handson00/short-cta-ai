/**
 * Diagnóstico do OCR: mostra exatamente o comando que a aplicação executa,
 * o código de saída, a saída de erro do Tesseract e o começo do TSV.
 *
 *   npm run ocr:check                      # usa tests/fixtures/gancho_topo.mp4
 *   npm run ocr:check -- caminho/do.mp4    # usa o seu próprio vídeo
 *   npm run ocr:check -- caminho/da.png    # usa uma imagem direto
 *
 * Existe porque uma falha do Tesseract e um vídeo sem texto produzem o mesmo
 * resultado vazio: sem ver o erro cru não dá para distinguir os dois.
 */
import { config } from "dotenv";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

config({ path: ".env.local" });
config({ path: ".env" });

// O import precisa acontecer DEPOIS do dotenv: env.ts lê process.env no
// momento em que é carregado, e um import estático seria içado para cima.
async function main() {
const { env } = await import("../src/lib/env");

const alvo = process.argv[2] ?? path.join("tests", "fixtures", "gancho_topo.mp4");
if (!fs.existsSync(alvo)) {
  console.error(`Arquivo não encontrado: ${alvo}`);
  console.error("Gere as fixtures com `npm run fixtures` (precisa de bash) ou passe um vídeo seu.");
  process.exit(1);
}

console.info("\n--- configuração vista pela aplicação ---");
console.info(`  TESSERACT_PATH : ${env.tesseractPath}`);
console.info(`  TESSERACT_LANGS: ${env.tesseractLangs}`);
console.info(`  tessdataDir    : ${env.tessdataDir || "(nenhuma; usa a instalação do sistema)"}`);
if (env.tessdataDir) {
  const arquivos = fs.existsSync(env.tessdataDir)
    ? fs.readdirSync(env.tessdataDir).filter((f) => f.endsWith(".traineddata"))
    : [];
  console.info(`  idiomas na pasta: ${arquivos.join(", ") || "NENHUM"}`);
}

// 1. um quadro da imagem
let imagem = alvo;
if (!/\.(png|jpe?g|bmp|tiff?)$/i.test(alvo)) {
  imagem = path.join(os.tmpdir(), `ocrcheck_${Date.now()}.png`);
  const ff = spawnSync(env.ffmpegPath, ["-y", "-v", "error", "-ss", "0.5", "-i", alvo, "-frames:v", "1", imagem], {
    encoding: "utf8",
  });
  if (ff.status !== 0 || !fs.existsSync(imagem)) {
    console.error(`\nFFmpeg não conseguiu extrair o quadro (código ${ff.status}).`);
    console.error(ff.stderr?.slice(0, 500));
    process.exit(1);
  }
  console.info(`\n  quadro extraído: ${imagem}`);
}

// 2. o pipeline de producao tenta primeiro uma versao "enhanced" do frame
//    (2x + escala de cinza + contraste) e so cai pro frame cru se o enhanced
//    nao ler nada. Testamos os dois aqui, separados, para saber qual funciona.
const enhanced = path.join(os.tmpdir(), `ocrcheck_enhanced_${Date.now()}.png`);
const ffEnhance = spawnSync(
  env.ffmpegPath,
  ["-y", "-v", "error", "-i", imagem, "-vf", "scale=iw*2:ih*2:flags=lanczos,format=gray,eq=contrast=1.6", enhanced],
  { encoding: "utf8" },
);
const temEnhanced = ffEnhance.status === 0 && fs.existsSync(enhanced);
if (!temEnhanced) {
  console.info("\n  (não foi possível gerar a versão 'enhanced' para comparar; seguindo só com o frame cru)");
}

function rodarTesseract(alvoImagem: string, escala: number, rotulo: string) {
  const args = [alvoImagem, "stdout", "-l", env.tesseractLangs, "--psm", "11", "-c", "tessedit_create_tsv=1"];
  if (env.tessdataDir) args.push("--tessdata-dir", env.tessdataDir);

  console.info(`\n--- comando executado (${rotulo}) ---`);
  console.info(`  ${env.tesseractPath} ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`);

  const r = spawnSync(env.tesseractPath, args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });

  console.info(`  código de saída: ${r.status}`);
  if (r.error) console.info(`  erro ao executar: ${r.error.message}`);

  const stderr = (r.stderr ?? "").trim();
  if (stderr) console.info(`  stderr: ${stderr.split("\n").join(" | ")}`);

  const stdout = r.stdout ?? "";
  const linhas = stdout.split("\n").filter((l) => l.trim());
  const ehTsv = (linhas[0] ?? "").startsWith("level\tpage_num");
  console.info(`  formato TSV: ${ehTsv ? "sim" : "NÃO"}`);

  if (ehTsv) {
    const palavras = linhas
      .slice(1)
      .map((l) => l.split("\t"))
      .filter((c) => c.length > 11 && (c[11] ?? "").trim());
    console.info(`  palavras lidas: ${palavras.length}`);
    console.info(`  texto: ${palavras.map((c) => c[11]).join(" ").slice(0, 200) || "(nenhum)"}`);
    return palavras.length;
  }
  return 0;
}

console.info("\n=== TESTE 1: frame cru (sem enhance) ===");
const palavrasCru = rodarTesseract(imagem, 1, "frame cru");

let palavrasEnhanced = 0;
if (temEnhanced) {
  console.info("\n=== TESTE 2: frame com enhance (2x + cinza + contraste 1.6) — é o que o app usa primeiro ===");
  palavrasEnhanced = rodarTesseract(enhanced, 2, "enhanced");
  fs.rmSync(enhanced, { force: true });
}

console.info("\n--- conclusão ---");
console.info(`  frame cru      : ${palavrasCru} palavra(s)`);
console.info(`  frame enhanced : ${temEnhanced ? `${palavrasEnhanced} palavra(s)` : "não testado"}`);
if (temEnhanced && palavrasEnhanced === 0 && palavrasCru > 0) {
  console.info("  → O enhance está destruindo o texto. O app usa o enhanced primeiro e só cai pro cru se vier");
  console.info("    ZERO linhas — se o enhanced overprodução lixo, o app nunca chega a tentar o cru.");
} else if (temEnhanced && palavrasEnhanced > 0 && palavrasCru > 0) {
  console.info("  → Os dois leem algo; compare o texto acima para ver qual é mais fiel.");
}
console.info("");
}

void main();
