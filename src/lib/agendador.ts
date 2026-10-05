import crypto from "node:crypto";
import { db } from "./db";
import { env } from "./env";
import { timingSafeEqual } from "./crypto";

/**
 * Integração com a extensão "Agendador IG" (a parte que toca segredo e banco).
 *
 * O vídeo não atravessa a página: a extensão baixa o MP4 direto do servidor.
 * Ela não tem o cookie desta aplicação, então recebe um **ingresso**: um link
 * assinado que serve UM vídeo por poucos minutos. Mesmo raciocínio do token de
 * comentários (HANDOFF §10), mas descartável — não há segredo fixo para vazar.
 */

/** Tempo para a extensão começar o download depois do clique. */
export const INGRESSO_VALIDADE_MS = 15 * 60 * 1000;

function segredo(): string {
  // Sem segredo fixo não há ingresso: o segredo efêmero de `auth.ts` muda por
  // cópia do módulo (HANDOFF §3, armadilha 6), e a rota que assina não seria a
  // mesma que confere.
  if (!env.sessionSecret) {
    throw new Error("APP_SESSION_SECRET não está definida no .env.local; sem ela não dá para gerar o link do vídeo.");
  }
  return env.sessionSecret;
}

function assinar(jobId: string, expira: number): string {
  // O prefixo separa este uso do cookie de sessão: uma assinatura de um não
  // vale como a do outro, mesmo com o mesmo segredo.
  return crypto.createHmac("sha256", segredo()).update(`agendador:${jobId}:${expira}`).digest("base64url");
}

export function emitirIngresso(jobId: string, agora = Date.now()): string {
  const expira = agora + INGRESSO_VALIDADE_MS;
  return `${jobId}.${expira}.${assinar(jobId, expira)}`;
}

/** O id do job que o ingresso libera, ou nulo se for falso, adulterado ou vencido. */
export function conferirIngresso(ingresso: string | null, agora = Date.now()): string | null {
  if (!ingresso) return null;
  const partes = ingresso.split(".");
  if (partes.length !== 3) return null;
  const [jobId, expiraTxt, assinatura] = partes;
  const expira = Number(expiraTxt);
  if (!jobId || !Number.isFinite(expira) || expira <= agora) return null;
  return timingSafeEqual(assinar(jobId, expira), assinatura) ? jobId : null;
}

export interface EnvioAgendador {
  exportJobId: string;
  videoId: string;
  extPostId: string;
  data: string | null;
  hora: string | null;
  texto: string;
  enviadoEm: string;
}

interface EnvioRow {
  export_job_id: string;
  video_id: string;
  ext_post_id: string;
  slot_date: string | null;
  slot_time: string | null;
  texto: string;
  enviado_em: string;
}

const mapear = (r: EnvioRow): EnvioAgendador => ({
  exportJobId: r.export_job_id,
  videoId: r.video_id,
  extPostId: r.ext_post_id,
  data: r.slot_date,
  hora: r.slot_time,
  texto: r.texto,
  enviadoEm: r.enviado_em,
});

/** Reenviar substitui o recibo: vale o último post que a extensão recebeu. */
export function registrarEnvio(e: Omit<EnvioAgendador, "enviadoEm">, agora = new Date()): EnvioAgendador {
  const enviadoEm = agora.toISOString();
  db()
    .prepare(
      `INSERT INTO agendador_envios (export_job_id, video_id, ext_post_id, slot_date, slot_time, texto, enviado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(export_job_id) DO UPDATE SET
         ext_post_id = excluded.ext_post_id, slot_date = excluded.slot_date, slot_time = excluded.slot_time,
         texto = excluded.texto, enviado_em = excluded.enviado_em`,
    )
    .run(e.exportJobId, e.videoId, e.extPostId, e.data, e.hora, e.texto, enviadoEm);
  return { ...e, enviadoEm };
}

export function buscarEnvio(exportJobId: string): EnvioAgendador | null {
  const row = db().prepare("SELECT * FROM agendador_envios WHERE export_job_id = ?").get(exportJobId) as
    | EnvioRow
    | undefined;
  return row ? mapear(row) : null;
}
