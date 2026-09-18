/**
 * Reproduz exatamente o que o teste "OCR e classificação do texto" faz,
 * mas imprimindo cada etapa: frames extraídos, frames descartados por
 * dedupe, texto OCR bruto por frame, e o resultado da classificação.
 *
 *   npx tsx scripts/pipeline-debug.ts tests/fixtures/gancho_topo.mp4
 */
import { config } from "dotenv";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const ffmpeg = await import("../src/lib/media/ffmpeg");
  const visionModule = await import("../src/lib/providers/vision/tesseract");

  const alvo = process.argv[2] ?? path.join("tests", "fixtures", "gancho_topo.mp4");
  const duration = Number(process.argv[3] ?? "6");
  const maxFrames = Number(process.argv[4] ?? "8");

  if (!fs.existsSync(alvo)) {
    console.error(`Arquivo não encontrado: ${alvo}`);
    process.exit(1);
  }

  const info = await ffmpeg.probe(alvo);
  console.info("--- probe ---");
  console.info(`  duração real: ${info.durationSeconds.toFixed(2)}s, ${info.width}x${info.height}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-debug-"));
  const outDir = path.join(tmpDir, "frames");

  console.info("\n--- extractFrames ---");
  console.info(`  duration(param)=${duration}, maxFrames=${maxFrames}`);
  const { frames, skipped } = await ffmpeg.extractFrames(alvo, duration, outDir, maxFrames);
  console.info(`  frames extraídos: ${frames.length}  (descartados por dedupe: ${skipped})`);
  for (const f of frames) {
    console.info(`    - ${f.timestampSeconds}s  ${path.basename(f.path)}  phash=${f.phash}`);
  }

  if (frames.length === 0) {
    console.error("\nNENHUM FRAME sobrou depois do dedupe. É aqui que está o problema.");
    process.exit(0);
  }

  console.info("\n--- OCR por frame (via TesseractVisionProvider) ---");
  const provider = new visionModule.TesseractVisionProvider();
  const result = await provider.analyzeFrames(frames.map((f) => ({ path: f.path, timestampSeconds: f.timestampSeconds })));

  console.info(`  limitations: ${JSON.stringify(result.limitations)}`);
  console.info(`  visibleText (${result.visibleText.length} candidatos após classificação):`);
  for (const c of result.visibleText as any[]) {
    console.info(
      `    [${c.type}] score=${c.score ?? "?"} região=${c.region} conf=${c.ocrConfidence} altura_rel=${c.relativeHeight} t=${c.timestampSeconds}s texto="${c.text}"`,
    );
    if (c.reasons) console.info(`        motivos: ${c.reasons.join(" | ")}`);
  }

  console.info(`\n  existingCta: ${result.existingCta ? JSON.stringify(result.existingCta) : "null"}`);

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

void main();
