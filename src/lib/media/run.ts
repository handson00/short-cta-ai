import { spawn } from "node:child_process";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export class CommandError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly stderr: string,
  ) {
    super(message);
    this.name = "CommandError";
  }
}

/** Executa um binario externo com limite de tempo e captura de saida. */
export function run(
  bin: string,
  args: string[],
  opts: { timeoutMs?: number; binaryStdout?: boolean } = {},
): Promise<RunResult & { stdoutBuffer: Buffer }> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new CommandError(`${bin} excedeu ${timeoutMs}ms`, -1, ""));
    }, timeoutMs);

    child.stdout.on("data", (c: Buffer) => outChunks.push(c));
    child.stderr.on("data", (c: Buffer) => {
      // Limita o buffer de erro para nao guardar megabytes de log do ffmpeg.
      if (errChunks.length < 200) errChunks.push(c);
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new CommandError(`Nao foi possivel executar ${bin}: ${err.message}`, -1, ""));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stdoutBuffer = Buffer.concat(outChunks);
      const stderr = Buffer.concat(errChunks).toString("utf8");
      const result = {
        code: code ?? -1,
        stdout: opts.binaryStdout ? "" : stdoutBuffer.toString("utf8"),
        stderr,
        stdoutBuffer,
      };
      if (code === 0) resolve(result);
      else reject(new CommandError(`${bin} falhou (codigo ${code})`, code ?? -1, stderr.slice(-2000)));
    });
  });
}

export async function binaryAvailable(bin: string, versionArg = "-version"): Promise<boolean> {
  try {
    await run(bin, [versionArg], { timeoutMs: 10_000 });
    return true;
  } catch {
    return false;
  }
}
