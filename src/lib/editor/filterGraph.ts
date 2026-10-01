import type { EditorTemplateConfig } from "../types";
import { evenDown, evenUp, toPixels, type NormalizedRect } from "./crop";
import { DEFAULT_AUDIO, placeVideoInSlot } from "./template";
import { COLOR_EQ, DEFAULT_EFFECTS, LOUDNORM, outputDuration, zoomRect, type EditorEffects } from "./effects";

/**
 * Monta o filter_complex do FFmpeg (spec §46-§48).
 *
 * E uma funcao pura que devolve texto: nenhuma string vinda do navegador entra
 * aqui, e o resultado da para conferir num teste sem rodar o FFmpeg. Os
 * argumentos sao montados no servidor, sempre em array — nunca linha de shell
 * (§45, §83).
 *
 * REGRA DE DURACAO — cada parte foi medida contra o FFmpeg real:
 * - toda imagem entra em loop (`-loop 1`) e o fundo de cor e infinito;
 * - todo overlay usa `shortest=1`;
 * - o video e a unica fonte finita, entao tudo termina com ele.
 * Sem isso, um overlay so termina quando TODAS as entradas terminam: um video
 * sem trilha de audio exportava para sempre (o fundo nunca acaba), e so o
 * `-shortest` sobre o audio disfarcava o problema nos videos com audio.
 */

/** Entradas depois do vídeo (índice 1 em diante), na ordem dos `-i`. */
export type GraphInput = "background" | "overlay" | "logo" | "text" | "music";

export interface ExportPlan {
  /** Recorte do vídeo de origem. `null` = quadro inteiro. */
  crop: NormalizedRect | null;
  sourceWidth: number;
  sourceHeight: number;
  /**
   * Duração do vídeo de ORIGEM. A de saída (com corte e velocidade) é
   * calculada aqui e é ela que fecha a janela do texto e corta a música.
   */
  durationSeconds: number;
  /**
   * Efeitos do vídeo. O corte de início/fim NÃO entra no grafo: vira -ss/-t na
   * entrada (export.ts), que já entrega ao grafo só o trecho escolhido.
   */
  effects?: EditorEffects | null;
  sourceHasAudio: boolean;
  /** Matriz de cor declarada na origem (`probe().colorSpace`); nula = não declarada. */
  sourceColorSpace: string | null;
  template: EditorTemplateConfig;
  fps: number;
  hasBackgroundImage: boolean;
  hasOverlayImage: boolean;
  hasLogoImage: boolean;
  hasTextLayer: boolean;
}

export interface FilterGraph {
  filterComplex: string;
  /** Rótulo do vídeo final. */
  outputLabel: string;
  /** Rótulo do áudio final; nulo = o arquivo sai sem áudio. */
  audioLabel: string | null;
  /** O chamador passa os `-i` nesta ordem; a entrada 1 é sempre o fundo. */
  inputs: GraphInput[];
  /** Fundo em cor sólida quando não há imagem: vira uma entrada lavfi. */
  colorSource: string | null;
}

/** `#1a1033` → `0x1a1033`: o FFmpeg aceita as duas, mas `#` confunde parsers. */
export function ffmpegColor(hex: string | undefined): string {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return "0x000000";
  return `0x${hex.slice(1)}`;
}

/** Lado par: H.264 em yuv420p recusa dimensão ímpar. */
const even = evenUp;

/** Número para o filtergraph: ponto decimal, sem notação científica. */
const num = (v: number) => (Math.round(v * 1000) / 1000).toFixed(3).replace(/\.?0+$/, "") || "0";

/**
 * COR — tudo e CONVERTIDO para BT.709 antes do overlay, nao so etiquetado.
 *
 * 23 dos 98 videos do acervo vem em BT.601 (smpte170m). Etiquetar a saida como
 * BT.709 sem converter fazia o player decodificar dados 601 com a matriz 709:
 * medido em barras de cor, o verde (14,222,4) saia (0,189,0) e o fundo
 * vermelho saia laranja. Cada entrada passa por `scale` com a matriz de saida
 * explicita e recebe a etiqueta logo em seguida, para a negociacao de cor do
 * FFmpeg nao escolher outra coisa no overlay.
 */
const TO_709 = "out_color_matrix=bt709:out_range=tv";
const TAG_709 = "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv";

/**
 * Matriz assumida quando o arquivo nao declara nenhuma: a convencao dos
 * players, HD em BT.709 e abaixo de 720p em BT.601. Assim a saida fica igual
 * ao que o player mostra da origem.
 */
export function assumedColorSpace(declared: string | null, width: number, height: number): string {
  if (declared) return declared;
  return Math.min(width, height) >= 720 ? "bt709" : "smpte170m";
}

function tagAs(colorSpace: string): string {
  return colorSpace === "bt709"
    ? TAG_709
    : `setparams=color_primaries=smpte170m:color_trc=smpte170m:colorspace=smpte170m:range=tv`;
}

export function buildFilterGraph(plan: ExportPlan): FilterGraph {
  const t = plan.template;
  const canvasW = even(t.canvasWidth);
  const canvasH = even(t.canvasHeight);

  const fx = plan.effects ?? DEFAULT_EFFECTS;
  // Duração do arquivo que sai: é nela que o texto e a música são medidos.
  const outDur = outputDuration(plan.durationSeconds, fx);
  // Zoom = recorte menor em volta do centro; o preview faz a mesma conta.
  const src = toPixels(zoomRect(plan.crop, fx.zoom), plan.sourceWidth, plan.sourceHeight);
  const placement = placeVideoInSlot(src.width / src.height, t);

  // Em FILL o vídeo estoura o slot; recorta-se o que passa, e a sobra some.
  // Em FIT o encaixe já cabe, e esta conta vira um recorte de tudo.
  const visibleX = Math.max(0, Math.round(t.videoX - placement.x));
  const visibleY = Math.max(0, Math.round(t.videoY - placement.y));
  // evenDown: o recorte não pode crescer além do slot nem do vídeo escalado.
  const visibleW = evenDown(Math.min(t.videoWidth, placement.width));
  const visibleH = evenDown(Math.min(t.videoHeight, placement.height));
  const drawX = Math.round(Math.max(t.videoX, placement.x));
  const drawY = Math.round(Math.max(t.videoY, placement.y));

  const steps: string[] = [];
  const inputs: GraphInput[] = ["background"];
  const indexOf = (kind: GraphInput) => inputs.indexOf(kind) + 1;

  // 1. Vídeo: recorta a origem, escala para o encaixe (convertendo para
  // BT.709), recorta ao slot. Origem sem matriz declarada é etiquetada antes,
  // senão a conversão partiria do padrão do FFmpeg, não da convenção dos players.
  const sourceTag = plan.sourceColorSpace
    ? []
    : [tagAs(assumedColorSpace(null, plan.sourceWidth, plan.sourceHeight))];
  steps.push(
    `[0:v]${[
      ...sourceTag,
      `crop=${src.width}:${src.height}:${src.x}:${src.y}`,
      // Espelho depois do recorte: inverte a região escolhida, não o quadro inteiro.
      ...(fx.mirror ? ["hflip"] : []),
      ...(fx.enhanceColor ? [`eq=contrast=${COLOR_EQ.contrast}:saturation=${COLOR_EQ.saturation}`] : []),
      `scale=${even(placement.width)}:${even(placement.height)}:${TO_709}`,
      `crop=${visibleW}:${visibleH}:${visibleX}:${visibleY}`,
      "format=yuv420p",
      TAG_709,
      // Velocidade: o vídeo encurta; o áudio acompanha com atempo, abaixo.
      ...(fx.speed !== 1 ? [`setpts=PTS/${num(fx.speed)}`] : []),
    ].join(",")}[vid]`,
  );

  // 2. Fundo: imagem enviada (em loop) ou cor sólida. Sempre é a entrada 1.
  const colorSource = plan.hasBackgroundImage
    ? null
    : `color=c=${ffmpegColor(t.backgroundColor)}:s=${canvasW}x${canvasH}`;
  steps.push(`[1:v]scale=${canvasW}:${canvasH}:${TO_709},format=yuv420p,${TAG_709},setsar=1[bg]`);

  let last = "bg";
  let stage = 0;
  const layer = (secondary: string, position: string, extra = "") => {
    const out = `s${++stage}`;
    steps.push(`[${last}][${secondary}]overlay=${position}:shortest=1${extra}[${out}]`);
    last = out;
  };

  // 3. Camadas, na ordem da §28: vídeo → overlay → logo → texto.
  layer("vid", `${drawX}:${drawY}`);

  if (plan.hasOverlayImage) {
    inputs.push("overlay");
    steps.push(`[${indexOf("overlay")}:v]scale=${canvasW}:${canvasH}:${TO_709},format=yuva420p,${TAG_709}[ov]`);
    layer("ov", "0:0");
  }

  if (plan.hasLogoImage) {
    inputs.push("logo");
    const lw = even(t.logoWidth ?? 240);
    const lh = even(t.logoHeight ?? 240);
    const lx = Math.round(t.logoX ?? 0);
    const ly = Math.round(t.logoY ?? 0);
    // `force_original_aspect_ratio=decrease` cabe a logo dentro da caixa sem
    // deformar, e a expressão com overlay_w/overlay_h a centraliza — as
    // dimensões reais só existem em tempo de execução. O preview usa
    // `object-contain`, que faz o mesmo (§86).
    steps.push(
      `[${indexOf("logo")}:v]scale=${lw}:${lh}:force_original_aspect_ratio=decrease:${TO_709},format=yuva420p,${TAG_709}[logo]`,
    );
    layer("logo", `${lx}+(${lw}-overlay_w)/2:${ly}+(${lh}-overlay_h)/2`);
  }

  if (plan.hasTextLayer && t.text?.enabled) {
    inputs.push("text");
    const tx = t.text;
    const end = tx.end ?? outDur;
    // A camada já vem no tamanho da caixa; o scale só protege contra uma
    // camada desenhada antes de a caixa mudar de tamanho. yuva420p guarda o
    // alfa em resolução cheia, e é nele que os fades trabalham.
    const chain = [`scale=${Math.round(tx.width)}:${Math.round(tx.height)}:${TO_709}`, "format=yuva420p"];
    if (tx.fadeIn > 0) chain.push(`fade=t=in:st=${num(tx.start)}:d=${num(tx.fadeIn)}:alpha=1`);
    if (tx.fadeOut > 0 && end > 0) {
      chain.push(`fade=t=out:st=${num(Math.max(0, end - tx.fadeOut))}:d=${num(tx.fadeOut)}:alpha=1`);
    }
    chain.push(TAG_709);
    steps.push(`[${indexOf("text")}:v]${chain.join(",")}[txt]`);
    // Aspas simples: dentro do filtergraph elas protegem as vírgulas do between().
    const windowed = tx.start > 0 || tx.end !== null;
    layer(
      "txt",
      `${Math.round(tx.x)}:${Math.round(tx.y)}`,
      windowed ? `:enable='between(t,${num(tx.start)},${num(end)})'` : "",
    );
  }

  // 4. Saída: fps fixo e yuv420p, sem os quais o MP4 não toca em todo lugar.
  // Tudo já chega aqui convertido para BT.709; o `setparams` final garante a
  // etiqueta em cada frame — só as flags de saída não bastavam no QSV.
  steps.push(`[${last}]fps=${plan.fps},format=yuv420p,${TAG_709}[out]`);

  // 5. Áudio (§36-§37, §48).
  const audio = t.audio ?? DEFAULT_AUDIO;
  let audioLabel: string | null = null;
  const withMusic = (audio.mode === "replace" || audio.mode === "mix") && Boolean(audio.music);
  if (withMusic) inputs.push("music");
  // A música entra em loop; o corte pela duração do vídeo é o que a faz parar.
  const musicTrim = outDur > 0 ? `,atrim=duration=${num(outDur)},asetpts=N/SR/TB` : "";
  // O áudio original acompanha a velocidade sem mudar o tom (atempo); a
  // música não: ela é cortada na duração final, não acelerada.
  const tempo = fx.speed !== 1 ? `atempo=${num(fx.speed)},` : "";
  // "Melhorar áudio" vale para o que sai, depois da mistura: corte de ronco
  // abaixo de 80 Hz e volume padronizado em -14 LUFS.
  const tail = fx.enhanceAudio ? `highpass=f=80,${LOUDNORM},aresample=48000` : "aresample=48000";

  if (audio.mode === "original" && plan.sourceHasAudio) {
    steps.push(`[0:a]${tempo}volume=${num(audio.originalVolume)},${tail}[aout]`);
    audioLabel = "aout";
  } else if (withMusic && (audio.mode === "replace" || !plan.sourceHasAudio)) {
    // Misturar num vídeo sem áudio é o mesmo que substituir.
    steps.push(`[${indexOf("music")}:a]volume=${num(audio.musicVolume)}${musicTrim},${tail}[aout]`);
    audioLabel = "aout";
  } else if (withMusic && audio.mode === "mix") {
    // normalize=0: sem ele o amix divide cada entrada pelo número de entradas
    // e o volume configurado não seria o que sai.
    steps.push(`[0:a]${tempo}volume=${num(audio.originalVolume)}[a0]`);
    steps.push(`[${indexOf("music")}:a]volume=${num(audio.musicVolume)}${musicTrim}[a1]`);
    steps.push(`[a0][a1]amix=inputs=2:duration=first:normalize=0,${tail}[aout]`);
    audioLabel = "aout";
  }
  // "mute", ou "original" num vídeo sem áudio: o arquivo sai sem trilha.

  return {
    filterComplex: steps.join(";"),
    outputLabel: "out",
    audioLabel,
    inputs,
    colorSource,
  };
}
