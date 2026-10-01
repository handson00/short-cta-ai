import { z } from "zod";
import { fail, handleError, json, requireAuth } from "@/lib/api";
import * as repo from "@/lib/repo";
import { aiProvider } from "@/lib/providers/ai";
import { rankHashtags } from "@/lib/pipeline/hashtagRank";
import { AiError } from "@/lib/providers/ai/errors";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** Quantas hashtags novas a IA gera por vídeo. */
const QUANTAS = 2;

const schema = z.object({
  videoIds: z.array(z.string().min(1)).min(1).max(100),
  /** Refazer num vídeo que já tem sugestão da IA. Sem isto, ele é pulado (não gasta chamada). */
  force: z.boolean().default(false),
});

/**
 * Gera hashtags novas com IA para os vídeos indicados.
 *
 * Uma chamada paga (ou de cota, no Gemini) POR VÍDEO. Por isso: vídeo que já
 * tem sugestão é pulado, a menos que o usuário peça de novo; e o relatório diz
 * o que foi gerado, o que foi pulado e o que falhou — um lote pela metade não
 * pode parecer sucesso.
 */
export async function POST(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Dados inválidos.", 422);
    const { videoIds, force } = parsed.data;

    const { publish } = getSettings();
    const gerados: Array<{ videoId: string; hashtags: Array<{ tag: string; reason: string | null }> }> = [];
    const pulados: Array<{ videoId: string; reason: string }> = [];
    const falhas: Array<{ videoId: string; reason: string }> = [];

    for (const videoId of [...new Set(videoIds)]) {
      const video = repo.getVideo(videoId);
      if (!video) {
        pulados.push({ videoId, reason: "Vídeo não encontrado." });
        continue;
      }

      const captured = repo.getVideoHashtags(videoId);
      const temLegendaJp = repo.getJapaneseCaption(videoId) !== null;
      // Pular só quando TUDO que seria gerado já existe: senão, ligar a legenda
      // japonesa depois nunca geraria nada nos vídeos que já têm hashtags.
      const faltaLegendaJp = publish.japaneseCaption && !temLegendaJp;
      if (!force && (captured?.ia.length ?? 0) > 0 && !faltaLegendaJp) {
        pulados.push({ videoId, reason: "Já tem hashtags da IA." });
        continue;
      }

      const analysis = repo.latestSceneAnalysis(videoId);
      const transcript = repo.getTranscript(videoId);
      const work = repo.getWork(videoId);
      const selection = repo.getSelection(videoId);
      const suggestions = repo.listSuggestions(videoId);
      const cta =
        selection.editedText ??
        suggestions.find((s) => s.id === selection.chosenCtaId)?.text ??
        suggestions.find((s) => s.isRecommended)?.text ??
        null;

      // As que o vídeo já usa: as recomendadas entre as capturadas e as que a
      // IA já sugeriu antes. Vão no prompt e no validador, para não repetir.
      const jaTem = [
        ...rankHashtags(captured, { cta, plot: analysis?.plot ?? null, transcript: transcript?.text ?? null }).map(
          (h) => h.tag,
        ),
        ...(captured?.doVideo ?? []),
        ...(captured?.ia.map((h) => h.tag) ?? []),
      ];

      const contexto = {
        cta,
        plot: analysis?.plot ?? null,
        sceneSummary: analysis?.sceneSummary ?? null,
        transcript: transcript?.hasSpeech ? transcript.text : null,
        workTitle: work?.status === "identified" && work.title ? work.title : null,
      };

      try {
        const provider = aiProvider({ videoId });
        let tags = captured?.ia ?? [];
        if (force || tags.length === 0) {
          tags = await provider.generateHashtags(contexto, jaTem, QUANTAS);
          repo.saveAiHashtags(videoId, tags);
        }

        if (publish.japaneseCaption && (force || !temLegendaJp)) {
          const caption = await provider.generateJapaneseCaption(contexto, publish.japaneseHashtag);
          repo.saveJapaneseCaption(videoId, caption, publish.japaneseHashtag);
        }

        gerados.push({ videoId, hashtags: tags });
      } catch (err) {
        const message = err instanceof AiError ? err.message : (err as Error).message;
        falhas.push({ videoId, reason: message });
        // Cota ou credencial: insistir nos outros só queimaria a cota à toa.
        if (err instanceof AiError && ["quota_exhausted", "auth_error", "not_configured"].includes(err.code)) {
          break;
        }
      }
    }

    return json({
      ok: true,
      gerados,
      pulados,
      falhas,
      porVideo: QUANTAS,
      comLegendaJaponesa: publish.japaneseCaption,
    });
  } catch (err) {
    return handleError(err);
  }
}
