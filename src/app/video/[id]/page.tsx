import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { videoDetail } from "@/lib/view";
import VideoDetailView from "@/components/VideoDetailView";

export const dynamic = "force-dynamic";

export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) redirect("/login");
  const { id } = await params;
  const detail = videoDetail(id);
  if (!detail) notFound();

  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-ink-400 hover:text-ink-100">
        ← Voltar para a fila
      </Link>
      <VideoDetailView initial={detail} />
    </div>
  );
}
