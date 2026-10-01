import fs from "node:fs";
import path from "node:path";

function str(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

const dataDir = path.resolve(process.cwd(), str("DATA_DIR", "./data"));

function defaultTessdataDir(): string {
  const local = path.resolve(process.cwd(), "tessdata");
  return fs.existsSync(local) ? local : "";
}

export const env = {
  isProduction: process.env.NODE_ENV === "production",

  appPassword: str("APP_PASSWORD"),
  sessionSecret: str("APP_SESSION_SECRET"),
  masterKey: str("SECRETS_MASTER_KEY"),

  dataDir,
  uploadsDir: path.join(dataDir, "uploads"),
  artifactsDir: path.join(dataDir, "artifacts"),
  templatesDir: path.join(dataDir, "templates"),
  textLayersDir: path.join(dataDir, "text-layers"),
  outputDir: str("EDITOR_OUTPUT_DIR", path.join(dataDir, "output")),
  databasePath: str("DATABASE_PATH", path.join(dataDir, "short-cta-ai.db")),

  // Token que autoriza a extensao a enviar comentarios. Sem valor configurado,
  // o endpoint de ingestao recusa tudo - um coletor que nao existe nao pode
  // deixar uma porta aberta na maquina do usuario.
  commentsIngestToken: str("COMMENTS_INGEST_TOKEN"),

  ghostcliApiKey: str("GHOSTCLI_API_KEY"),
  ghostcliBaseUrl: str("GHOSTCLI_BASE_URL"),
  ghostcliAuthHeader: str("GHOSTCLI_AUTH_HEADER", "authorization").toLowerCase(),

  // Google Gemini. A chave também pode ser salva pela tela de Configurações
  // (criptografada no banco); a variável de ambiente, se existir, vence.
  geminiApiKey: str("GEMINI_API_KEY"),
  /** Endereço compatível com Chat Completions: o mesmo cliente do GhostCLI serve. */
  geminiBaseUrl: str("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai"),
  /** API nativa, usada só para listar os modelos da conta. */
  geminiNativeUrl: str("GEMINI_NATIVE_URL", "https://generativelanguage.googleapis.com/v1beta"),

  ffmpegPath: str("FFMPEG_PATH", "ffmpeg"),
  ffprobePath: str("FFPROBE_PATH", "ffprobe"),
  tesseractPath: str("TESSERACT_PATH", "tesseract"),

  transcriptionProvider: str("TRANSCRIPTION_PROVIDER", "faster-whisper"),
  fasterWhisper: {
    python: str("FASTER_WHISPER_PYTHON", "python3"),
    model: str("FASTER_WHISPER_MODEL", "small"),
    device: str("FASTER_WHISPER_DEVICE", "cpu"),
    computeType: str("FASTER_WHISPER_COMPUTE_TYPE", "int8"),
    language: str("FASTER_WHISPER_LANGUAGE", "pt"),
    /**
     * 1 = decodificação gulosa. Medido num corte real de 107 s (2026-09-29):
     * ~40% mais rápido que 5, com 98% das palavras idênticas (a diferença foi
     * pontuação). Suba para 5 se a fala do acervo for muito difícil.
     */
    beamSize: str("FASTER_WHISPER_BEAM", "1"),
  },

  visionProvider: str("VISION_PROVIDER", "tesseract"),
  tesseractLangs: str("TESSERACT_LANGS", "por+eng"),
  /**
   * Pasta com os arquivos .traineddata. Uma pasta "tessdata" na raiz do
   * projeto e usada automaticamente: assim o idioma portugues acompanha a
   * aplicacao, sem depender de permissao de administrador para escrever
   * dentro da instalacao do Tesseract.
   */
  tessdataDir: str("TESSDATA_DIR", defaultTessdataDir()),

  searchProvider: str("SEARCH_PROVIDER", "none"),
  searchHttpEndpoint: str("SEARCH_HTTP_ENDPOINT"),
  searchHttpApiKey: str("SEARCH_HTTP_API_KEY"),

  workerInProcess: bool("WORKER_IN_PROCESS", true),
};

/** Problemas de configuracao que a interface deve mostrar sem vazar valores. */
export function configWarnings(): string[] {
  const out: string[] = [];
  if (!env.appPassword) out.push("APP_PASSWORD nao definida: a aplicacao esta aberta a quem alcancar a porta.");
  if (!env.sessionSecret) out.push("APP_SESSION_SECRET nao definida: sessoes usam um segredo efemero e caem a cada reinicio.");
  if (!env.masterKey) out.push("SECRETS_MASTER_KEY nao definida: as chaves de IA (GhostCLI, Gemini) so podem vir por variavel de ambiente, nao pela interface.");
  return out;
}
