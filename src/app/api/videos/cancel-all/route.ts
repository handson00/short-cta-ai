import { handleError, json, requireAuth } from "@/lib/api";
import { cancelQueuedAndActiveJobs } from "@/lib/queue";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;

  try {
    const { canceled } = cancelQueuedAndActiveJobs();
    return json({ canceled });
  } catch (err) {
    return handleError(err);
  }
}
