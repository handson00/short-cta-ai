import path from "node:path";
import { env } from "../../env";
import { run } from "../../media/run";
import type { Transcript, TranscriptionProvider, TranscriptSegment } from "../../types";

interface RawSegment {
  start: number;
  end: number;
  text: string;
  avg_logprob?: number;
  no_speech_prob?: number;
}

interface RawOutput {
  language?: string | null;
  segments?: RawSegment[];
  error?: string;
}

const SCRIPT = path.join(process.cwd(), "scripts", "transcribe_faster_whisper.py");

/**
 * Implementacao local de TranscriptionProvider.
 *
 * Roda o modelo na propria maquina: nenhum audio sai daqui, o que importa
 * porque os cortes costumam ser material de terceiros.
 */
export class FasterWhisperProvider implements TranscriptionProvider {
  readonly name = "faster-whisper";
  private availability: boolean | null = null;

  get available(): boolean {
    return this.availability !== false;
  }

  async checkAvailability(): Promise<boolean> {
    if (this.availability !== null) return this.availability;
    try {
      await run(env.fasterWhisper.python, ["-c", "import faster_whisper"], { timeoutMs: 30_000 });
      this.availability = true;
    } catch {
      this.availability = false;
    }
    return this.availability;
  }

  async transcribe(audioPath: string): Promise<Transcript> {
    if (!(await this.checkAvailability())) {
      throw new Error(
        "faster-whisper nao esta instalado no ambiente Python configurado (pip install faster-whisper).",
      );
    }

    const { stdout } = await run(
      env.fasterWhisper.python,
      [
        SCRIPT,
        audioPath,
        env.fasterWhisper.model,
        env.fasterWhisper.device,
        env.fasterWhisper.computeType,
        env.fasterWhisper.language,
      ],
      { timeoutMs: 900_000 },
    );

    let parsed: RawOutput;
    try {
      parsed = JSON.parse(stdout.trim().split("\n").pop() ?? "{}") as RawOutput;
    } catch {
      throw new Error("Nao foi possivel interpretar a saida do transcritor.");
    }
    if (parsed.error) throw new Error(parsed.error);

    const warnings: string[] = [];
    const segments: TranscriptSegment[] = (parsed.segments ?? [])
      .filter((s) => s.text.trim().length > 0)
      .map((s) => {
        const lowConfidence = (s.avg_logprob ?? 0) < -1.0 || (s.no_speech_prob ?? 0) > 0.6;
        return {
          start: s.start,
          end: s.end,
          text: s.text.trim(),
          kind: "unknown" as const,
          lowConfidence,
        };
      });

    const lowConfidenceCount = segments.filter((s) => s.lowConfidence).length;
    if (segments.length > 0 && lowConfidenceCount / segments.length > 0.4) {
      warnings.push("Boa parte da transcricao saiu com baixa confianca; trate o texto como aproximado.");
    }
    if (segments.length === 0) {
      warnings.push("Nenhuma fala compreensivel foi reconhecida no audio.");
    }

    return {
      provider: this.name,
      language: parsed.language ?? null,
      text: segments.map((s) => s.text).join(" ").trim(),
      segments,
      hasSpeech: segments.length > 0,
      lowConfidence: segments.length > 0 && lowConfidenceCount / segments.length > 0.4,
      warnings,
    };
  }
}
