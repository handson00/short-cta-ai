/**
 * `Promise.all` com teto de tarefas simultâneas, mantendo a ordem da entrada no
 * resultado. Serve para processos externos (ffmpeg, Tesseract): disparar todos
 * de uma vez disputaria a CPU com a transcrição e com o outro vídeo da fila.
 */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
