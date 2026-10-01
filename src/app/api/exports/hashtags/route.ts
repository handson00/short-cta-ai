import { z } from "zod";
import { fail, handleError, json, requireAuth } from "@/lib/api";
import * as repo from "@/lib/repo";
import { aiProvider } from "@/lib/providers/ai";
import { rankHashtags } from "@/lib/pipeline/hashtagRank";
import { AiError } from "@/lib/providers/ai/errors";
import { getSettings } from "@/lib/settings";
import type { PublishContext } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Quantas hashtags novas a IA gera por vídeo, em português. */
const QUANTAS = 2;

const schema = z.object({
  videoIds: z.array(z.string().min(1)).min(1).max(100),
  /**
   * `pt`: legenda em português + 2 hashtags (o botão principal).
   * `ja`: legenda em japonês + 1 hashtag japonesa (o botão ao lado).
   */
  idioma: z.enum(["pt", "ja"]).default("pt"),
  /** Refazer num vídeo que já tem. Sem isto, ele é pulado (não gasta chamada). */
  force: z.boolean().default(false),
});

/**
 * Gera o texto de publicação dos vídeos indicados: uma chamada por vídeo.
 *
 * Os dois idiomas são pedidos separados, porque são dois botões: quem quer só
 * o português não paga pelo japonês. Vídeo que já tem o pacote daquele idioma
 * é pulado, e o relatório diz o que foi gerado, pulado e o que falhou — um
 * lote pela metade não pode parecer sucesso.
 */
export async function POST(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Dados inválidos.", 422);
    const { videoIds, idioma, force } = parsed.data;
    const { publish } = getSettings();

    if (idioma === "ja" && !publish.japaneseCaption) {
      return fail("A legenda em japonês está desligada em Configurações.", 409);
    }

    const gerados: string[] = [];
    const pulados: Array<{ videoId: string; reason: string }> = [];
    const falhas: Array<{ videoId: string; reason: string }> = [];

    for (const videoId of [...new Set(videoIds)]) {
      const video = repo.getVideo(videoId);
      if (!video) {
        pulados.push({ videoId, reason: "Vídeo não encontrado." });
        continue;
      }

      const captions = repo.getCaptions(videoId);
      if (!force && (idioma === "pt" ? captions.pt : captions.ja)) {
        pulados.push({ videoId, reason: `Já tem a legenda em ${idioma === "pt" ? "português" : "japonês"}.` });
        continue;
      }

      const captured = repo.getVideoHashtags(videoId);
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

      const contexto: PublishContext = {
        cta,
        plot: analysis?.plot ?? null,
        sceneSummary: analysis?.sceneSummary ?? null,
        transcript: transcript?.hasSpeech ? transcript.text : null,
        workTitle: work?.status === "identified" && work.title ? work.title : null,
      };

      try {
        const provider = aiProvider({ videoId });

        if (idioma === "pt") {
          // As que o vídeo já usa vão no prompt e no validador, para não repetir.
          const jaTem = [
            ...rankHashtags(captured, { cta, plot: contexto.plot, transcript: transcript?.text ?? null }).map(
              (h) => h.tag,
            ),
            ...(captured?.doVideo ?? []),
            ...(captured?.ia.map((h) => h.tag) ?? []),
          ];
          const pack = await provider.generatePublishPack(contexto, jaTem, QUANTAS);
          repo.saveAiHashtags(videoId, pack.hashtags, "pt");
          if (pack.caption) repo.saveCaptions(videoId, { pt: pack.caption });
        } else {
          const pack = await provider.generateJapanesePack(contexto, publish.japaneseHashtag);
          repo.saveCaptions(videoId, { ja: pack.caption, jaHashtag: publish.japaneseHashtag });
          if (pack.hashtag) repo.saveAiHashtags(videoId, [pack.hashtag], "ja");
        }

        gerados.push(videoId);
      } catch (err) {
        const message = err instanceof AiError ? err.message : (err as Error).message;
        falhas.push({ videoId, reason: message });
        // Cota ou credencial: insistir nos outros só queimaria o resto da cota.
        if (err instanceof AiError && ["quota_exhausted", "auth_error", "not_configured"].includes(err.code)) {
          break;
        }
      }
    }

    return json({ ok: true, idioma, gerados, pulados, falhas, porVideo: idioma === "pt" ? QUANTAS : 1 });
  } catch (err) {
    return handleError(err);
  }
}
