/**
 * Worker em processo separado.
 *
 * Use quando quiser que a interface e o processamento pesado (FFmpeg, OCR,
 * transcricao) nao dividam o mesmo processo: WORKER_IN_PROCESS=false no .env
 * e `npm run worker` ao lado do servidor.
 */
import { config } from "dotenv";
import { startWorker, stopWorker } from "../src/lib/queue";
import { db } from "../src/lib/db";

config({ path: ".env.local" });
config({ path: ".env" });

db();
startWorker();

const shutdown = (signal: string) => {
  console.info(`[worker] ${signal} recebido, encerrando...`);
  stopWorker();
  setTimeout(() => process.exit(0), 500);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
