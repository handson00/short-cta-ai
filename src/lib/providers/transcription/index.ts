import { env } from "../../env";
import type { TranscriptionProvider } from "../../types";
import { FasterWhisperProvider } from "./fasterWhisper";
import { NoTranscriptionProvider } from "./none";

let cached: TranscriptionProvider | null = null;

export function transcriptionProvider(): TranscriptionProvider {
  if (cached) return cached;
  cached = env.transcriptionProvider === "faster-whisper" ? new FasterWhisperProvider() : new NoTranscriptionProvider();
  return cached;
}

export async function transcriptionStatus(): Promise<{ name: string; available: boolean; detail: string }> {
  const provider = transcriptionProvider();
  if (provider instanceof FasterWhisperProvider) {
    const ok = await provider.checkAvailability();
    return {
      name: provider.name,
      available: ok,
      detail: ok
        ? `Modelo ${env.fasterWhisper.model} em ${env.fasterWhisper.device}`
        : "faster-whisper nao encontrado no Python configurado",
    };
  }
  return { name: provider.name, available: false, detail: "Transcricao desativada" };
}
