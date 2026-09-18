/**
 * Recalcula a origem dos vídeos já importados.
 *
 * Os vídeos que entraram antes da detecção de plataforma ficaram com
 * platform, platform_video_id e original_url em branco. Este script relê o
 * nome do arquivo e a pasta de origem de cada um e preenche o que der.
 *
 *   npm run backfill:source            # só os que estão sem plataforma
 *   npm run backfill:source -- --todos # recalcula todos
 *   npm run backfill:source -- --seco  # mostra o que faria, sem gravar
 */
import { config } from "dotenv";
import { db } from "../src/lib/db";
import { buildVideoSource } from "../src/lib/source";

config({ path: ".env.local" });
config({ path: ".env" });

const todos = process.argv.includes("--todos");
const seco = process.argv.includes("--seco");

interface Row {
  id: string;
  original_name: string;
  source_folder: string | null;
  platform: string | null;
  original_url: string | null;
}

const database = db();
const rows = database
  .prepare(
    todos
      ? "SELECT id, original_name, source_folder, platform, original_url FROM videos"
      : "SELECT id, original_name, source_folder, platform, original_url FROM videos WHERE platform IS NULL OR original_url IS NULL",
  )
  .all() as Row[];

const update = database.prepare(
  `UPDATE videos SET tiktok_username = ?, video_date = ?, platform = ?, platform_video_id = ?, original_url = ?
   WHERE id = ?`,
);

let identificados = 0;
let semLink = 0;
const porPlataforma: Record<string, number> = {};

const aplicar = database.transaction((lista: Row[]) => {
  for (const row of lista) {
    const source = buildVideoSource(row.original_name, row.source_folder);
    if (source.identified) {
      identificados += 1;
      porPlataforma[source.platform ?? "?"] = (porPlataforma[source.platform ?? "?"] ?? 0) + 1;
    } else {
      semLink += 1;
    }
    if (!seco) {
      update.run(
        source.username,
        source.videoDate,
        source.platform,
        source.platformVideoId,
        source.originalUrl,
        row.id,
      );
    }
  }
});

aplicar(rows);

console.info(`\nVídeos examinados: ${rows.length}`);
console.info(`  com link: ${identificados}`);
for (const [plataforma, total] of Object.entries(porPlataforma)) {
  console.info(`    ${plataforma}: ${total}`);
}
console.info(`  sem origem identificável: ${semLink}`);
console.info(seco ? "\nModo seco: nada foi gravado.\n" : "\nBanco atualizado.\n");
