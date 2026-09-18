import type { Transcript, TranscriptionProvider } from "../../types";

/** Placeholder explicito: nao inventa texto, apenas declara a limitacao. */
export class NoTranscriptionProvider implements TranscriptionProvider {
  readonly name = "none";
  readonly available = false;

  async transcribe(): Promise<Transcript> {
    return {
      provider: this.name,
      language: null,
      text: "",
      segments: [],
      hasSpeech: false,
      lowConfidence: false,
      warnings: ["Nenhum provedor de transcricao configurado; o audio nao foi analisado."],
    };
  }
}
