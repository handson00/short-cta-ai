/**
 * Sobe o worker junto com o servidor quando WORKER_IN_PROCESS estiver ligado.
 * Para separar os processos, ponha WORKER_IN_PROCESS=false e rode
 * `npm run worker` ao lado de `npm run dev` / `npm start`.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { env } = await import("./lib/env");
  const { db } = await import("./lib/db");
  db();

  if (!env.workerInProcess) {
    const { recoverStaleJobs } = await import("./lib/queue");
    const recovery = recoverStaleJobs();
    if (recovery.requeued || recovery.failed) {
      console.info(`[fila] ${recovery.requeued} job(s) devolvidos a fila, ${recovery.failed} com erro apos reinicio.`);
    }
    console.info("[fila] worker embutido desligado; rode `npm run worker` em outro processo.");
    return;
  }

  const { startWorker } = await import("./lib/queue");
  startWorker();
}
