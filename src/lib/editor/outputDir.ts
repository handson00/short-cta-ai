import fs from "node:fs";
import path from "node:path";
import { env } from "../env";
import { getSettings } from "../settings";

/**
 * Pasta onde os MP4 exportados são gravados.
 *
 * Fica em Configurações porque é escolha da máquina de quem usa (uma pasta do
 * Windows, um HD externo), não do projeto. Vazio = a pasta padrão
 * (`EDITOR_OUTPUT_DIR` ou `data/output`), que continua valendo para quem nunca
 * configurou nada.
 */
export function outputDir(): string {
  const configured = getSettings().paths.outputDir.trim();
  return configured || env.outputDir;
}

/**
 * Motivo pelo qual a pasta não serve, ou nulo.
 *
 * Confere ESCREVENDO um arquivo, não só olhando se existe: pasta em disco
 * removível, de rede ou sem permissão aceita `existsSync` e falha na hora de
 * gravar — no meio do lote, com o vídeo já renderizado.
 */
export function validateOutputDir(dir: string): string | null {
  const clean = dir.trim();
  if (!clean) return null; // vazio = usa a padrão

  if (!path.isAbsolute(clean)) {
    return "Informe o caminho completo da pasta (por exemplo E:\\Videos\\Exportados).";
  }

  try {
    if (fs.existsSync(clean)) {
      if (!fs.statSync(clean).isDirectory()) return "Esse caminho é um arquivo, não uma pasta.";
    } else {
      fs.mkdirSync(clean, { recursive: true });
    }
    const probe = path.join(clean, `.short-cta-teste-${Date.now()}`);
    fs.writeFileSync(probe, "");
    fs.unlinkSync(probe);
    return null;
  } catch (err) {
    return `Não consegui gravar nessa pasta: ${(err as Error).message}`;
  }
}
