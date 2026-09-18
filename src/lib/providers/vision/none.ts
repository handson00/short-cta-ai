import type { VisionProvider, VisualAnalysis } from "../../types";

export class NoVisionProvider implements VisionProvider {
  readonly name = "none";
  readonly available = false;

  async analyzeFrames(): Promise<VisualAnalysis> {
    return {
      provider: this.name,
      visibleText: [],
      sceneDescription: null,
      visualClues: [],
      existingCta: null,
      limitations: ["Nenhum provedor de visao configurado; nem OCR nem descricao visual foram executados."],
    };
  }
}
