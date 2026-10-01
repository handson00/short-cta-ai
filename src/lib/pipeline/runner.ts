import fs from "node:fs";
import path from "node:path";
import { env } from "../env";
import { AI_PROVIDER_LABEL, getSettings, resolveAiProfile } from "../settings";
import { AiError, aiConfigured, aiProvider } from "../providers/ai";
import { detailedMessage } from "../providers/ai/errors";
import { transcriptionProvider } from "../providers/transcription";
import { visionProvider } from "../providers/vision";
import { extractAudio, extractFrames, extractThumbnail, probe } from "../media/ffmpeg";
import { PROMPT_VERSION } from "../prompts";
import { analysisInputHash, generationInputHash } from "./aiCache";
import { transcriptFailure } from "./speechBasis";
import { logAiRequest } from "../aiLog";
import { searchProvider } from "../providers/search";
import * as repo from "../repo";
import { heartbeat, setStage, releaseJob, type ClaimedJob } from "./jobControl";
import type { CtaOptions, CtaStyle, SceneContext, WorkIdentification } from "../types";

class Cancelled extends Error {
  constructor() {
    super("Processamento cancelado pelo usuário.");
    this.name = "Cancelled";
  }
}

const UNIDENTIFIED: WorkIdentification = {
  title: null,
  originalTitle: null,
  year: null,
  mediaType: null,
  confidence: "low",
  evidence: [],
  sources: [],
  status: "not_identified_safely",
};

function ensureNotCancelled(jobId: string): void {
  if (repo.isCancelRequested(jobId)) throw new Cancelled();
}

/**
 * A parte local já rodou e serve: há transcrição, leitura do texto na tela e
 * frames. Transcrição que FALHOU não serve — gerar CTAs sobre ela seria pagar
 * pela IA para escrever sem ouvir a fala, exatamente o que se quer evitar.
 */
function hasLocalEvidence(videoId: string): boolean {
  const transcript = repo.getTranscript(videoId);
  return (
    transcript !== null &&
    transcriptFailure(transcript) === null &&
    repo.getVisualAnalysis(videoId) !== null &&
    repo.listFrames(videoId).length > 0
  );
}

/** Registra a chamada que NÃO foi feita: a economia aparece em "Uso da IA". */
function logCacheHit(operation: string, videoId: string, jobId: string, model: string): void {
  logAiRequest({
    provider: getSettings().ai.provider,
    videoId,
    jobId,
    operation,
    model,
    status: "cache",
    durationMs: 0,
    promptVersion: PROMPT_VERSION,
  });
}

export async function runJob(job: ClaimedJob): Promise<void> {
  const settings = getSettings();
  const video = repo.getVideo(job.videoId);

  if (!video) {
    repo.setJobStatus(job.id, "error", {
      errorCode: "video_missing",
      errorMessage: "O vídeo não está mais disponível.",
      retryable: false,
    });
    releaseJob(job.id);
    return;
  }

  try {
    ensureNotCancelled(job.id);

    // A parte local (mídia, fala, texto na tela) não custa chamada paga. Um job
    // "ai" a pula quando ela já existe; sem ela (vídeo nunca processado), faz
    // antes — a IA não pode trabalhar sobre evidência que não foi extraída.
    const needsLocal = !job.reuseScene && (job.mode !== "ai" || !hasLocalEvidence(video.id));
    if (needsLocal) {
      await stageExtractMedia(job, video, settings.limits);
      ensureNotCancelled(job.id);

      await transcribeAndReadText(job, video);
      ensureNotCancelled(job.id);
    }

    // Importação: para aqui. Os CTAs esperam o usuário escolher os vídeos.
    if (job.mode === "local") {
      repo.setJobStatus(job.id, "awaiting_ai");
      return;
    }

    if (!job.reuseScene) {
      await stageAnalyzeScene(job, video);
      ensureNotCancelled(job.id);

      await stageIdentifyWork(job, video);
      ensureNotCancelled(job.id);
    }

    await stageGenerateCtas(job, video);
    ensureNotCancelled(job.id);

    repo.setJobStatus(job.id, "done");
  } catch (err) {
    if (err instanceof Cancelled || repo.isCancelRequested(job.id)) {
      repo.setJobStatus(job.id, "canceled");
      releaseJob(job.id);
      return;
    }

    const aiErr = err instanceof AiError ? err : null;
    const code = aiErr?.code ?? (err as { code?: string }).code ?? "pipeline_error";
    const retryable = aiErr ? aiErr.retryable : !(err as { fatal?: boolean }).fatal;
    // Para erro de IA, inclui o corpo que o servico devolveu (sem cabecalhos
    // nem credencial): e o que diferencia, por exemplo, "chave sem escopo de
    // API" de "IP fora da lista liberada" atras de um 403 generico.
    const message = aiErr ? detailedMessage(aiErr) : ((err as Error).message ?? "Falha desconhecida");

    if (retryable && job.attempts < job.maxAttempts) {
      // Devolve a fila: a proxima tentativa recomeca do inicio do pipeline.
      repo.setJobStatus(job.id, "queued", { errorCode: code, errorMessage: message, retryable: true });
      releaseJob(job.id);
      return;
    }

    repo.setJobStatus(job.id, "error", { errorCode: code, errorMessage: message, retryable });
  } finally {
    releaseJob(job.id);
  }
}

// ------------------------------ 1. Extracao ---------------------------------

async function stageExtractMedia(
  job: ClaimedJob,
  video: repo.VideoRecord,
  limits: { maxDurationSeconds: number; maxFramesPerVideo: number },
): Promise<void> {
  setStage(job.id, "extracting_media");

  if (!fs.existsSync(video.path)) {
    throw Object.assign(new Error("Arquivo do vídeo não encontrado no armazenamento."), { fatal: true });
  }

  const media = await probe(video.path);
  if (!media.hasVideo) {
    throw Object.assign(new Error("O arquivo não contém trilha de vídeo."), { fatal: true });
  }
  if (media.durationSeconds > limits.maxDurationSeconds) {
    throw Object.assign(
      new Error(
        `Duração de ${media.durationSeconds.toFixed(0)}s acima do limite configurado (${limits.maxDurationSeconds}s).`,
      ),
      { fatal: true },
    );
  }

  const artifactDir = path.join(env.artifactsDir, video.id);
  fs.mkdirSync(artifactDir, { recursive: true });

  const thumbnail = await extractThumbnail(
    video.path,
    path.join(artifactDir, "thumb.jpg"),
    Math.min(0.3, media.durationSeconds / 2),
  );

  repo.updateVideoMedia(video.id, {
    container: media.container,
    durationSeconds: media.durationSeconds,
    width: media.width,
    height: media.height,
    aspectRatio: media.aspectRatio,
    hasAudio: media.hasAudio,
    thumbnailPath: thumbnail,
  });

  heartbeat(job.id);

  const { frames } = await extractFrames(
    video.path,
    media.durationSeconds,
    path.join(artifactDir, "frames"),
    limits.maxFramesPerVideo,
  );
  repo.replaceFrames(video.id, frames);

  if (media.hasAudio) {
    await extractAudio(video.path, path.join(artifactDir, "audio.wav"));
  }
}

// ------------------------- 2 e 3. Fala e texto na tela ----------------------

/**
 * A transcrição lê o áudio; o OCR lê os frames. Nenhum depende do outro, então
 * rodam juntos e o OCR some dentro do tempo da transcrição. A etapa mostrada é
 * a que ainda falta: "Transcrevendo" enquanto a fala não sai, "Lendo texto"
 * só se o OCR passar da transcrição.
 */
async function transcribeAndReadText(job: ClaimedJob, video: repo.VideoRecord): Promise<void> {
  setStage(job.id, "transcribing");
  let readingDone = false;
  const reading = stageReadText(video).finally(() => {
    readingDone = true;
  });
  const transcribing = stageTranscribe(video).then(() => {
    if (!readingDone) setStage(job.id, "reading_text");
  });
  // Espera os dois mesmo se um falhar: nenhuma escrita pode sobrar rodando
  // depois que o job já foi dado como encerrado.
  for (const r of await Promise.allSettled([transcribing, reading])) {
    if (r.status === "rejected") throw r.reason;
  }
}

async function stageTranscribe(video: repo.VideoRecord): Promise<void> {
  const audioPath = path.join(env.artifactsDir, video.id, "audio.wav");
  const provider = transcriptionProvider();

  if (!fs.existsSync(audioPath)) {
    repo.saveTranscript(video.id, {
      provider: provider.name,
      language: null,
      text: "",
      segments: [],
      hasSpeech: false,
      lowConfidence: false,
      warnings: ["O vídeo não tem trilha de áudio utilizável."],
    });
    return;
  }

  try {
    const transcript = await provider.transcribe(audioPath);
    repo.saveTranscript(video.id, transcript);
  } catch (err) {
    // Sem fala reconhecida o processamento continua com as evidencias visuais.
    repo.saveTranscript(video.id, {
      provider: provider.name,
      language: null,
      text: "",
      segments: [],
      hasSpeech: false,
      lowConfidence: false,
      warnings: [`Transcrição indisponível: ${(err as Error).message}`],
    });
  }
}

async function stageReadText(video: repo.VideoRecord): Promise<void> {
  const frames = repo.listFrames(video.id);
  const provider = visionProvider();

  try {
    const analysis = await provider.analyzeFrames(
      frames.map((f: any) => ({ path: f.path, timestampSeconds: f.timestampSeconds })),
    );
    repo.saveVisualAnalysis(video.id, analysis);
  } catch (err) {
    repo.saveVisualAnalysis(video.id, {
      provider: provider.name,
      visibleText: [],
      sceneDescription: null,
      visualClues: [],
      existingCta: null,
      limitations: [`Leitura de texto falhou: ${(err as Error).message}`],
    });
  }
}

// ---------------------------- 4. Analise da cena ----------------------------

export function buildSceneContext(video: repo.VideoRecord): SceneContext {
  const settings = getSettings();
  const transcript = repo.getTranscript(video.id);
  const visual = repo.getVisualAnalysis(video.id);
  const existingCta = repo.effectiveExistingCta(visual);

  const limitations: string[] = [];
  if (visual) limitations.push(...visual.limitations);
  else limitations.push("Nenhuma análise visual foi executada.");
  if (transcript?.warnings?.length) limitations.push(...transcript.warnings);
  if (!transcript?.hasSpeech) limitations.push("Sem transcrição de fala disponível.");
  if (!settings.toggles.identifyWork) limitations.push("Identificação de obra desativada nas configurações.");

  return {
    durationSeconds: video.durationSeconds ?? 0,
    aspectRatio: video.aspectRatio,
    transcript,
    visual,
    existingCta,
    limitations: Array.from(new Set(limitations)),
    styleExamples: repo.listStyleExamples().map((e: any) => e.text),
    language: settings.generation.language,
  };
}

async function stageAnalyzeScene(job: ClaimedJob, video: repo.VideoRecord): Promise<void> {
  setStage(job.id, "analyzing_scene");
  requireAi();

  const settings = getSettings();
  const context = buildSceneContext(video);
  const model = resolveAiProfile(settings).analysisModel;

  // Mesmo texto para o mesmo modelo = mesma pergunta. A análise salva vale.
  const allowSearch = settings.toggles.identifyWork && settings.toggles.externalSearch && searchProvider().available;
  const inputHash = analysisInputHash(context, model, allowSearch);
  if (repo.latestSceneAnalysis(video.id)?.inputHash === inputHash) {
    logCacheHit("analyze_scene", video.id, job.id, model);
    return;
  }

  const provider = aiProvider({ videoId: video.id, jobId: job.id });
  const analysis = await provider.analyzeScene(context);

  if (!settings.toggles.analyzeExistingCta && analysis.existingCta) {
    analysis.existingCta = { ...analysis.existingCta, strength: null, possibleImprovement: null };
  }

  repo.saveSceneAnalysis(video.id, analysis, {
    promptVersion: PROMPT_VERSION,
    model,
    inputHash,
  });
}

// --------------------------- 5. Identificacao -------------------------------

async function stageIdentifyWork(job: ClaimedJob, video: repo.VideoRecord): Promise<void> {
  setStage(job.id, "identifying_work");
  const settings = getSettings();

  if (!settings.toggles.identifyWork) {
    repo.saveWork(video.id, UNIDENTIFIED);
    return;
  }

  const existing = repo.getWork(video.id);
  if (existing?.manuallyCorrected) return;

  const analysis = repo.latestSceneAnalysis(video.id);
  const work = analysis?.work ?? UNIDENTIFIED;

  // Sem titulo nao existe identificacao, qualquer que seja a confianca alegada.
  repo.saveWork(video.id, work.title ? work : UNIDENTIFIED);
}

// ---------------------------- 6. Geracao de CTAs ----------------------------

async function stageGenerateCtas(job: ClaimedJob, video: repo.VideoRecord): Promise<void> {
  setStage(job.id, "generating_ctas");
  requireAi();

  const settings = getSettings();
  const stored = repo.latestSceneAnalysis(video.id);
  if (!stored) {
    throw Object.assign(new Error("Não há análise de cena salva para reaproveitar."), { fatal: true });
  }

  const options: CtaOptions = {
    count: settings.generation.ctaCount,
    language: settings.generation.language,
    creativity: settings.generation.creativity,
    avoidSpoilers: settings.toggles.spoilerPrevention,
    useExistingCtaAsReference: settings.toggles.useExistingCtaAsReference,
    styleExamples: repo.listStyleExamples().map((e: any) => e.text),
  };

  // A transcrição vai direto para a geração: quem escreve o gancho lê as falas,
  // não só o resumo que a análise fez delas. Vale também para "Regenerar CTAs",
  // que reaproveita uma análise antiga mas lê a transcrição atual.
  const transcript = repo.getTranscript(video.id);
  const model = resolveAiProfile(settings).generationModel;
  const inputHash = generationInputHash(stored, options, transcript, model);

  // Mesmas entradas = mesmos CTAs: reaproveita e, de quebra, mantém o CTA que
  // o usuário escolheu na Fila (gerar de novo apagaria a escolha). "Regenerar
  // CTAs" (reuseScene) é pedido explícito de sugestões novas e sempre chama.
  if (!job.reuseScene && stored.ctasInputHash === inputHash && repo.listSuggestions(video.id).length > 0) {
    logCacheHit("generate_ctas", video.id, job.id, model);
    return;
  }

  const provider = aiProvider({ videoId: video.id, jobId: job.id });
  const result = await provider.generateCtas(stored, options, transcript);

  const items: {
    text: string;
    style: CtaStyle;
    reason: string | null;
    isRecommended: boolean;
    origin: "generated" | "original" | "manual";
  }[] = result.suggestions.map((s: any) => ({
    text: s.text,
    style: s.style,
    reason: s.text === result.recommendedCta.text ? result.recommendedCta.reason : (s.reason ?? null),
    isRecommended: s.text === result.recommendedCta.text,
    origin: "generated" as const,
  }));

  // Ordena com o recomendado a frente, sem perder as demais.
  items.sort((a, b) => Number(b.isRecommended) - Number(a.isRecommended));

  // O CTA original entra como opcao quando foi lido com confianca suficiente,
  // mas nunca e promovido a recomendado por antiguidade.
  const visual = repo.getVisualAnalysis(video.id);
  const existing = repo.effectiveExistingCta(visual);
  if (existing && existing.confidence !== "low" && !items.some((i: any) => i.text === existing.text)) {
    items.push({
      text: existing.text,
      style: "curiosidade",
      reason: "Texto já presente no vídeo, mantido como opção.",
      isRecommended: false,
      origin: "original" as const,
    });
  }

  repo.replaceSuggestions(video.id, stored.id, items);
  repo.updateSceneRecommendation(stored.id, result.recommendedCta);
  repo.setCtasInputHash(stored.id, inputHash);
}

function requireAi(): void {
  if (!aiConfigured()) {
    const label = AI_PROVIDER_LABEL[getSettings().ai.provider];
    throw new AiError("not_configured", `Configure a chave do ${label} em Configurações antes de gerar CTAs.`);
  }
}
