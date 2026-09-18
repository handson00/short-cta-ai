/**
 * Cria o .env.local com segredos gerados na hora.
 *
 * Existe porque `openssl` não vem no Windows e `cp` não existe no cmd: este
 * caminho funciona igual em Windows, macOS e Linux, já que só usa o Node.
 *
 *   node scripts/setup-env.mjs            # não sobrescreve um .env.local existente
 *   node scripts/setup-env.mjs --force    # regenera (invalida a chave salva no banco)
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const target = path.resolve(process.cwd(), ".env.local");
const force = process.argv.includes("--force");

if (fs.existsSync(target) && !force) {
  console.info(".env.local já existe. Nada foi alterado. Use --force para regerar.");
  process.exit(0);
}

if (fs.existsSync(target) && force) {
  const backup = `${target}.bak`;
  fs.copyFileSync(target, backup);
  console.warn(`Backup do arquivo anterior em ${path.basename(backup)}.`);
  console.warn("Atenção: uma SECRETS_MASTER_KEY nova torna ilegível a credencial já salva no banco.");
}

const secret = () => crypto.randomBytes(32).toString("hex");

const lines = [
  "# Gerado por scripts/setup-env.mjs. Não versione este arquivo.",
  "",
  "# Troque por uma senha sua: ela protege todas as rotas da aplicação.",
  "APP_PASSWORD=troque-esta-senha",
  `APP_SESSION_SECRET=${secret()}`,
  `SECRETS_MASTER_KEY=${secret()}`,
  "",
  "# Credencial do GhostCLI. Deixe em branco para salvar pela interface.",
  "GHOSTCLI_API_KEY=",
  "GHOSTCLI_BASE_URL=https://ghostcli.dev/v1",
  "GHOSTCLI_AUTH_HEADER=authorization",
  "",
  "DATA_DIR=./data",
  "",
  "# Binários externos. No Windows, use barras normais ou escape as invertidas:",
  "# FFMPEG_PATH=C:/ffmpeg/bin/ffmpeg.exe",
  "FFMPEG_PATH=ffmpeg",
  "FFPROBE_PATH=ffprobe",
  "TESSERACT_PATH=tesseract",
  "TESSERACT_LANGS=por+eng",
  "",
  "# Troque para faster-whisper depois de instalar o pacote Python.",
  "TRANSCRIPTION_PROVIDER=none",
  "VISION_PROVIDER=tesseract",
  "SEARCH_PROVIDER=none",
  "",
  "WORKER_IN_PROCESS=true",
  "",
];

fs.writeFileSync(target, lines.join("\n"), { mode: 0o600 });
console.info(".env.local criado com segredos novos.");
console.info("Abra o arquivo e troque APP_PASSWORD antes de usar.");
