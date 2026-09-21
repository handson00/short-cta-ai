import type { Confidence, ExistingCtaDetection, TextKind, TextRegion, VisibleText } from "../types";

/**
 * Classificacao do texto lido por OCR.
 *
 * O objetivo nao e "ler o primeiro frame e chamar de CTA". Um Short costuma
 * carregar quatro tipos de texto sobrepostos: o gancho, a legenda do dialogo,
 * a marca d'agua da plataforma e o @ do perfil. Confundir os quatro produz
 * CTAs sem sentido, entao cada bloco recebe uma classificacao explicita e o
 * gancho so e afirmado quando as evidencias se sustentam.
 */

export interface OcrLine {
  text: string;
  /** Coordenadas em pixels no frame. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** 0..1 */
  confidence: number;
  frameWidth: number;
  frameHeight: number;
  timestampSeconds: number;
}

export interface TextCandidate extends VisibleText {
  score: number;
  reasons: string[];
  occurrences: number;
  persistence?: number;
}

const HANDLE_RE = /(^|\s)@[\w.]{2,}/;
const URL_RE = /(https?:\/\/|www\.|\.com|\.br\b)/i;
const PLATFORM_WORDS = [
  "tiktok",
  "kwai",
  "capcut",
  "shorts",
  "reels",
  "instagram",
  "youtube",
  "inscreva",
  "se inscreva",
  "siga",
  "segue o perfil",
  "curta",
  "compartilhe",
  "parte 1",
  "parte 2",
];
const SUBTITLE_HINTS = /^[-–—]\s|["“”]/;

export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSimilarity(a: string, b: string): number {
  const ta = new Set(a.split(" ").filter(Boolean));
  const tb = new Set(b.split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / Math.max(ta.size, tb.size);
}

export function regionOf(line: OcrLine): TextRegion {
  const center = (line.top + line.height / 2) / Math.max(1, line.frameHeight);
  if (center < 0.34) return "top";
  if (center > 0.66) return "bottom";
  return "middle";
}

interface Group {
  normalized: string;
  displayText: string;
  lines: OcrLine[];
}

/**
 * Une linhas vizinhas do MESMO frame num unico bloco de texto.
 *
 * Um CTA de Short quase nunca cabe em uma linha: "Essa garota esta sendo /
 * perseguida por uma / velha assustadora" chega do OCR como tres linhas
 * separadas. Avaliadas uma a uma, cada pedaco parece curto e baixo demais
 * para ser um titulo - e o conjunto, que e obviamente o gancho, nunca e
 * reconhecido. Unir antes de classificar devolve ao texto o tamanho e a
 * extensao reais que ele tem na tela.
 *
 * So une o que esta visualmente junto: distancia menor que a altura de uma
 * linha e sobreposicao horizontal. Assim uma legenda no rodape nunca gruda
 * no gancho do topo.
 */
export function mergeAdjacentLines(lines: OcrLine[]): OcrLine[] {
  const porFrame = new Map<number, OcrLine[]>();
  for (const line of lines) {
    const atual = porFrame.get(line.timestampSeconds);
    if (atual) atual.push(line);
    else porFrame.set(line.timestampSeconds, [line]);
  }

  const out: OcrLine[] = [];
  for (const doFrame of porFrame.values()) {
    const ordenadas = [...doFrame].sort((a, b) => a.top - b.top);
    let bloco: OcrLine[] = [];

    const fechar = () => {
      if (bloco.length === 0) return;
      out.push(bloco.length === 1 ? bloco[0] : fundirBloco(bloco));
      bloco = [];
    };

    for (const line of ordenadas) {
      if (bloco.length === 0) {
        bloco = [line];
        continue;
      }
      const anterior = bloco[bloco.length - 1];
      const distancia = line.top - (anterior.top + anterior.height);
      const alturaTipica = Math.max(anterior.height, line.height);
      const sobrepoeNaHorizontal =
        Math.min(anterior.left + anterior.width, line.left + line.width) - Math.max(anterior.left, line.left) > 0;

      if (distancia <= alturaTipica * 1.2 && distancia > -alturaTipica && sobrepoeNaHorizontal) {
        bloco.push(line);
      } else {
        fechar();
        bloco = [line];
      }
    }
    fechar();
  }
  return out;
}

function fundirBloco(bloco: OcrLine[]): OcrLine {
  const left = Math.min(...bloco.map((l: any) => l.left));
  const top = Math.min(...bloco.map((l: any) => l.top));
  const right = Math.max(...bloco.map((l: any) => l.left + l.width));
  const bottom = Math.max(...bloco.map((l: any) => l.top + l.height));
  return {
    text: bloco.map((l: any) => l.text.trim()).join(" ").replace(/\s+/g, " ").trim(),
    left,
    top,
    width: right - left,
    height: bottom - top,
    confidence: bloco.reduce((a, l) => a + l.confidence, 0) / bloco.length,
    frameWidth: bloco[0].frameWidth,
    frameHeight: bloco[0].frameHeight,
    timestampSeconds: bloco[0].timestampSeconds,
  };
}

/** Um bloco largo ou centralizado nao e marca d'agua, por menor que seja. */
function pareceMarcaDeCanto(group: Group): boolean {
  const first = group.lines[0];
  const left = Math.min(...group.lines.map((l: any) => l.left));
  const right = Math.max(...group.lines.map((l: any) => l.left + l.width));
  const larguraRelativa = (right - left) / Math.max(1, first.frameWidth);
  const centro = (left + right) / 2 / Math.max(1, first.frameWidth);
  const centralizado = Math.abs(centro - 0.5) < 0.18;
  return !(larguraRelativa >= 0.5 || centralizado);
}

function groupAcrossFrames(lines: OcrLine[]): Group[] {
  const groups: Group[] = [];
  for (const line of lines) {
    const normalized = normalizeText(line.text);
    if (normalized.length < 3) continue;
    const match = groups.find((g: any) => g.normalized === normalized || tokenSimilarity(g.normalized, normalized) >= 0.7);
    if (match) {
      match.lines.push(line);
      // Mantem a leitura com maior confianca como texto literal exibido.
      if (line.confidence > Math.max(...match.lines.map((l: any) => l.confidence)) - 0.001) {
        match.displayText = line.text.trim();
      }
    } else {
      groups.push({ normalized, displayText: line.text.trim(), lines: [line] });
    }
  }
  return groups;
}

function classifyKind(group: Group, region: TextRegion, relativeHeight: number, frameCount: number): {
  kind: TextKind;
  reasons: string[];
} {
  const reasons: string[] = [];
  const text = group.displayText;
  const normalized = group.normalized;
  const words = normalized.split(" ").filter(Boolean);
  const persistence = new Set(group.lines.map((l: any) => l.timestampSeconds)).size;

  if (HANDLE_RE.test(text) || URL_RE.test(text)) {
    return { kind: "possible_handle", reasons: ["Parece perfil ou endereço de site."] };
  }
  const lower = text.toLowerCase();
  if (PLATFORM_WORDS.some((w: any) => lower.includes(w))) {
    return { kind: "possible_watermark", reasons: ["Contém termo típico de marca d'água ou chamada de plataforma."] };
  }
  // Marca d'agua e pequena, curta E encostada numa borda.
  //
  // A versao anterior desta regra classificava como marca d'agua todo texto
  // pequeno presente em todos os frames - mas permanecer o video inteiro e
  // justamente o que DEFINE o CTA fixo. Na pratica isso rebaixava o gancho a
  // marca d'agua e o campo "CTA detectado" ficava vazio mesmo com o texto
  // lido corretamente. Persistencia, sozinha, nunca classifica como marca.
  if (
    relativeHeight < 0.035 &&
    frameCount > 1 &&
    persistence === frameCount &&
    words.length <= 4 &&
    pareceMarcaDeCanto(group)
  ) {
    return { kind: "possible_watermark", reasons: ["Pequeno, curto e encostado na borda em todos os frames."] };
  }
  if (region === "bottom") {
    if (SUBTITLE_HINTS.test(text) || persistence <= 1) {
      reasons.push("Aparece no terço inferior, posição típica de legenda.");
      return { kind: "possible_subtitle", reasons };
    }
    reasons.push("Texto inferior persistente: pode ser legenda fixa ou gancho mal posicionado.");
    return { kind: "possible_subtitle", reasons };
  }
  if (words.length < 2) {
    return { kind: "unknown", reasons: ["Trecho curto demais para ser avaliado como gancho."] };
  }
  return { kind: "possible_hook", reasons };
}

/** Sinais de que a frase funciona como titulo, nao como fala transcrita. */
function hookScore(group: Group, region: TextRegion, relativeHeight: number, frameCount: number): {
  score: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  let score = 0;
  const text = group.displayText;
  const words = group.normalized.split(" ").filter(Boolean);
  const persistence = new Set(group.lines.map((l: any) => l.timestampSeconds)).size;
  const avgConfidence = group.lines.reduce((a, l) => a + l.confidence, 0) / group.lines.length;

  if (region === "top") {
    score += 3;
    reasons.push("Ocupa o terço superior.");
  } else if (region === "middle") {
    score += 1;
  }

  if (relativeHeight >= 0.06) {
    score += 2;
    reasons.push("Texto grande em relação ao quadro.");
  } else if (relativeHeight >= 0.035) {
    score += 1;
  }

  if (frameCount > 1 && persistence >= 2) {
    score += 2;
    reasons.push(`Permanece em ${persistence} frames.`);
  }

  if (words.length >= 4 && words.length <= 16) {
    score += 2;
    reasons.push("Extensão compatível com um título.");
  } else if (words.length > 16) {
    score -= 2;
    reasons.push("Longo demais para um gancho.");
  }

  const upperRatio = upperCaseRatio(text);
  if (upperRatio > 0.7) {
    score += 1;
    reasons.push("Escrito majoritariamente em caixa alta.");
  }
  if (/[!?]/.test(text)) score += 1;

  if (avgConfidence >= 0.8) {
    score += 1;
  } else if (avgConfidence < 0.5) {
    score -= 1;
    reasons.push("Leitura do OCR com baixa confiança.");
  }

  // Um gancho raramente aparece so no fim do video.
  const firstSeen = Math.min(...group.lines.map((l: any) => l.timestampSeconds));
  if (firstSeen <= 3) {
    score += 1;
    reasons.push(`Surge aos ${firstSeen.toFixed(1)}s.`);
  }

  return { score, reasons };
}

function upperCaseRatio(text: string): number {
  const letters = text.replace(/[^A-Za-zÀ-ÿ]/g, "");
  if (!letters) return 0;
  const upper = letters.replace(/[^A-ZÀ-Þ]/g, "");
  return upper.length / letters.length;
}

export function scoreToConfidence(score: number): Confidence {
  if (score >= 9) return "high";
  if (score >= 6) return "medium";
  return "low";
}

export interface ClassificationResult {
  visibleText: TextCandidate[];
  existingCta: ExistingCtaDetection | null;
}

export function classifyDetectedText(lines: OcrLine[], frameCount: number): ClassificationResult {
  // Unir as linhas do mesmo frame ANTES de agrupar entre frames: e o bloco
  // inteiro, nao a linha solta, que deve ser julgado como gancho.
  const groups = groupAcrossFrames(mergeAdjacentLines(lines));
  const candidates: TextCandidate[] = [];

  for (const group of groups) {
    const first = group.lines.reduce((a, b) => (a.timestampSeconds <= b.timestampSeconds ? a : b));
    const region = regionOf(first);
    const relativeHeight =
      Math.max(...group.lines.map((l: any) => l.height)) / Math.max(1, first.frameHeight);
    const { kind, reasons: kindReasons } = classifyKind(group, region, relativeHeight, frameCount);
    const { score, reasons: scoreReasons } = hookScore(group, region, relativeHeight, frameCount);

    candidates.push({
      text: group.displayText,
      timestampSeconds: first.timestampSeconds,
      region,
      type: kind,
      ocrConfidence: round2(group.lines.reduce((a, l) => a + l.confidence, 0) / group.lines.length),
      relativeHeight: round2(relativeHeight),
      persistence: new Set(group.lines.map((l: any) => l.timestampSeconds)).size,
      score: kind === "possible_hook" ? score : score - 4,
      reasons: [...kindReasons, ...scoreReasons],
      occurrences: group.lines.length,
    });
  }

  candidates.sort((a, b) => b.score - a.score);

  // Um CTA fixo aparece em MAIS DE UM instante - e exatamente isso que o separa
  // de uma legenda de dialogo, que troca a cada frame.
  //
  // Medido no acervo real (32 videos, 2026-09-18): os 7 acertos tinham
  // persistencia entre 8 e 12 frames; os 13 falsos positivos tinham todos
  // persistencia 1, sem excecao. Varios deles eram texto perfeitamente legivel
  // ("EU SOU O ARQUEIRO VERDE", "DEVE TER UNS TREZENTOS METROS !") - legenda
  // queimada no video, lida num frame so. Sem esta exigencia, o campo "CTA
  // detectado" se enche de frases que parecem resultado e nao sao.
  const best =
    candidates.find((c: any) => c.type === "possible_hook" && c.score >= 6 && (frameCount <= 1 || (c.persistence ?? 1) >= 2),
    ) ?? null;
  const existingCta: ExistingCtaDetection | null = best
    ? {
        text: best.text,
        confidence: scoreToConfidence(best.score),
        firstSeenAtSeconds: best.timestampSeconds,
        reasons: best.reasons,
      }
    : null;

  return { visibleText: candidates, existingCta };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
