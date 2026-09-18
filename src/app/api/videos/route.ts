import path from "node:path";
import { fail, handleError, json, requireAuth } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import * as repo from "@/lib/repo";
import { listSummaries, queueOverview } from "@/lib/view";
import { safeDisplayName, sha256, storeUpload, validateBuffer } from "@/lib/upload";
import { buildVideoSource } from "@/lib/source";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  return json({ videos: listSummaries(), queue: queueOverview() });
}

interface UploadOutcome {
  file: string;
  status: "queued" | "duplicate" | "rejected";
  videoId?: string;
  reason?: string;
}

export async function POST(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const form = await request.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    // skip: ignora duplicados; reanalyze: enfileira o video ja existente de novo.
    const onDuplicate = String(form.get("onDuplicate") ?? "skip") === "reanalyze" ? "reanalyze" : "skip";
    // Nome da pasta de origem (ex.: "@resumosmovies") -> username do TikTok.
    const sourceFolderRaw = form.get("sourceFolder");
    const sourceFolder = typeof sourceFolderRaw === "string" && sourceFolderRaw.trim().length > 0
      ? sourceFolderRaw.trim()
      : null;

    if (files.length === 0) return fail("Nenhum arquivo recebido.");

    const settings = getSettings();
    const maxBytes = settings.limits.maxFileSizeMb * 1024 * 1024;
    const results: UploadOutcome[] = [];

    for (const file of files) {
      const displayName = safeDisplayName(file.name);
      const buffer = Buffer.from(await file.arrayBuffer());

      const validation = validateBuffer(buffer, displayName, maxBytes);
      if (!validation.ok) {
        results.push({ file: displayName, status: "rejected", reason: validation.reason });
        continue;
      }

      const hash = sha256(buffer);
      const existing = repo.findVideoByHash(hash);
      if (existing) {
        if (onDuplicate === "skip") {
          results.push({ file: displayName, status: "duplicate", videoId: existing.id, reason: "Arquivo idêntico já importado." });
          continue;
        }
        repo.createJob(existing.id);
        results.push({ file: displayName, status: "queued", videoId: existing.id, reason: "Duplicado reenfileirado." });
        continue;
      }

      const extension = path.extname(displayName).toLowerCase();
      const stored = storeUpload(buffer, extension);
      const source = buildVideoSource(displayName, sourceFolder);
      const video = repo.createVideo({
        originalName: displayName,
        storedName: stored.storedName,
        path: stored.absolutePath,
        hash,
        bytes: buffer.length,
        mime: file.type || null,
        source: {
          sourceFolder,
          tiktokUsername: source.username,
          videoDate: source.videoDate,
          platform: source.platform,
          platformVideoId: source.platformVideoId,
          originalUrl: source.originalUrl,
        },
      });
      repo.createJob(video.id);
      results.push({ file: displayName, status: "queued", videoId: video.id });
    }

    return json({ results, queue: queueOverview() });
  } catch (err) {
    return handleError(err);
  }
}
