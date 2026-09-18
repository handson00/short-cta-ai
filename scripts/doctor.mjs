/**
 * Diagnóstico do ambiente: diz o que falta antes de processar o primeiro vídeo.
 *
 *   npm run doctor
 *
 * Verifica o binário nativo do SQLite (que não é compilado quando o npm bloqueia
 * install scripts), FFmpeg, FFprobe, Tesseract e seus idiomas, o Python com
 * faster-whisper e o .env.local.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

let envFile = {};
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match) envFile[match[1]] = match[2].trim();
  }
}

const cfg = (name, fallback) => process.env[name] || envFile[name] || fallback;

const results = [];
const ok = (item, detail) => results.push({ level: "ok", item, detail });
const warn = (item, detail, fix) => results.push({ level: "aviso", item, detail, fix });
const bad = (item, detail, fix) => results.push({ level: "falta", item, detail, fix });

async function version(bin, args) {
  const { stdout, stderr } = await run(bin, args, { timeout: 15_000, windowsHide: true });
  return (stdout || stderr).split("\n")[0].trim();
}

// 1. Módulo nativo do SQLite
try {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  require("better-sqlite3");
  ok("better-sqlite3", "binário nativo carregado");
} catch (err) {
  bad(
    "better-sqlite3",
    `não carrega (${String(err.message).split("\n")[0]})`,
    "O npm provavelmente bloqueou os install scripts. Rode: npm approve-scripts better-sqlite3 && npm install",
  );
}

// 2. FFmpeg e FFprobe
for (const [name, key] of [
  ["ffmpeg", "FFMPEG_PATH"],
  ["ffprobe", "FFPROBE_PATH"],
]) {
  const bin = cfg(key, name);
  try {
    ok(name, await version(bin, ["-version"]));
  } catch {
    bad(
      name,
      `não encontrado em "${bin}"`,
      process.platform === "win32"
        ? "winget install Gyan.FFmpeg (abra um terminal novo depois) ou aponte " + key + " no .env.local"
        : "instale o FFmpeg ou aponte " + key + " no .env.local",
    );
  }
}

// 3. Tesseract e idiomas
const tesseract = cfg("TESSERACT_PATH", "tesseract");
const wantedLangs = cfg("TESSERACT_LANGS", "por+eng").split("+").filter(Boolean);
const localTessdata = cfg("TESSDATA_DIR", path.resolve(process.cwd(), "tessdata"));
const localLangs = fs.existsSync(localTessdata)
  ? fs.readdirSync(localTessdata).filter((f) => f.endsWith(".traineddata")).map((f) => f.replace(".traineddata", ""))
  : [];
try {
  ok("tesseract", await version(tesseract, ["--version"]));
  const { stdout } = await run(tesseract, ["--list-langs"], { timeout: 15_000, windowsHide: true });
  const available = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.toLowerCase().startsWith("list of available"));
  // A aplicacao passa --tessdata-dir para a pasta do projeto quando ela existe,
  // entao um idioma que mora la conta tanto quanto um instalado no sistema.
  const todos = [...new Set([...available, ...localLangs])];
  const missing = wantedLangs.filter((l) => !todos.includes(l));
  if (missing.length === 0) {
    ok("idiomas do OCR", wantedLangs.join(", ") + (localLangs.length ? ` (pasta do projeto: ${localLangs.join(", ")})` : ""));
  }
  else
    warn(
      "idiomas do OCR",
      `faltando: ${missing.join(", ")} (disponiveis: ${todos.join(", ") || "nenhum"})`,
      "Baixe o .traineddata para a pasta tessdata/ do projeto ou ajuste TESSERACT_LANGS no .env.local",
    );
} catch {
  bad(
    "tesseract",
    `não encontrado em "${tesseract}"`,
    process.platform === "win32"
      ? "winget install UB-Mannheim.TesseractOCR (marque Portuguese na instalação) ou aponte TESSERACT_PATH"
      : "instale o tesseract-ocr com o idioma português",
  );
}

// 4. Transcrição
const provider = cfg("TRANSCRIPTION_PROVIDER", "faster-whisper");
if (provider !== "faster-whisper") {
  warn("transcrição", `provedor "${provider}": o áudio não será analisado`, "Instale faster-whisper e troque TRANSCRIPTION_PROVIDER");
} else {
  const python = cfg("FASTER_WHISPER_PYTHON", "python3");
  try {
    await run(python, ["-c", "import faster_whisper"], { timeout: 60_000, windowsHide: true });
    ok("faster-whisper", `disponível em ${python}`);
  } catch {
    // Sem transcrição o pipeline continua com as evidências visuais, então isto
    // limita o resultado mas não impede o processamento.
    warn(
      "faster-whisper",
      `não encontrado no Python "${python}"; os vídeos serão analisados só pelo texto na tela`,
      `pip install faster-whisper — no Windows o executável costuma ser "python", ajuste FASTER_WHISPER_PYTHON`,
    );
  }
}

// 5. Configuração
if (!fs.existsSync(envPath)) {
  bad(".env.local", "não existe", "Rode: npm run setup");
} else {
  const faltando = ["APP_PASSWORD", "APP_SESSION_SECRET", "SECRETS_MASTER_KEY"].filter((k) => !cfg(k, ""));
  if (faltando.length) bad(".env.local", `sem valor em ${faltando.join(", ")}`, "Rode: npm run setup --force");
  else if (cfg("APP_PASSWORD", "") === "troque-esta-senha")
    warn(".env.local", "APP_PASSWORD ainda é o valor de exemplo", "Troque por uma senha sua");
  else ok(".env.local", "segredos definidos");
}

const icon = { ok: "  ok  ", aviso: " aviso", falta: " falta" };
console.info("\nDiagnóstico do Short CTA AI\n");
for (const r of results) {
  console.info(`[${icon[r.level]}] ${r.item}: ${r.detail}`);
  if (r.fix) console.info(`          -> ${r.fix}`);
}

const blockers = results.filter((r) => r.level === "falta");
console.info(
  blockers.length === 0
    ? "\nTudo pronto para processar vídeos.\n"
    : `\n${blockers.length} item(ns) bloqueiam o processamento. Resolva os marcados como "falta".\n`,
);
process.exit(blockers.length === 0 ? 0 : 1);
