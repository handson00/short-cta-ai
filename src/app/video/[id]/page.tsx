import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { getVideo } from "@/lib/repo";
import VideoDetailView from "@/components/VideoDetailView";
import ErrorBoundary from "@/components/ErrorBoundary";

export const dynamic = "force-dynamic";

export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthenticated())) redirect("/login");
  const { id } = await params;
  // Verifica apenas se o vídeo existe; os dados completos são buscados via API no cliente
  // para evitar erros de serialização RSC que causam "Application error" genérico.
  const video = getVideo(id);
  if (!video) notFound();

  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-ink-400 hover:text-ink-100">
        ← Voltar para a fila
      </Link>
      <ErrorBoundary>
        <VideoDetailView videoId={id} />
      </ErrorBoundary>
    </div>
  );
}