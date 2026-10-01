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

  // Início desta sessão do servidor, para a página de Exportações separar "o
  // que saiu agora" do histórico. No globalThis porque o Next.js carrega uma
  // cópia de cada módulo por contexto (ver HANDOFF, armadilha 6).
  (globalThis as { __appStartedAt?: string }).__appStartedAt ??= new Date().toISOString();

  // A fila do editor sobe sempre aqui, independente de WORKER_IN_PROCESS: o
  // cancelamento precisa alcançar o FFmpeg, que só existe neste processo.
  const { startExportWorker } = await import("./lib/editor/exportQueue");
  void startExportWorker();

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
