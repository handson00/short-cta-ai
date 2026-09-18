import { env } from "../../env";
import type { VisionProvider } from "../../types";
import { NoVisionProvider } from "./none";
import { TesseractVisionProvider } from "./tesseract";

let cached: VisionProvider | null = null;

export function visionProvider(): VisionProvider {
  if (cached) return cached;
  cached = env.visionProvider === "tesseract" ? new TesseractVisionProvider() : new NoVisionProvider();
  return cached;
}

export async function visionStatus(): Promise<{ name: string; available: boolean; detail: string }> {
  const provider = visionProvider();
  if (provider instanceof TesseractVisionProvider) {
    const ok = await provider.checkAvailability();
    return {
      name: provider.name,
      available: ok,
      detail: ok ? `OCR ${env.tesseractLangs} (sem descricao de cena)` : "Tesseract nao encontrado no PATH",
    };
  }
  return { name: provider.name, available: false, detail: "Analise visual desativada" };
}
