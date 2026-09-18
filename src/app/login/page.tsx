import { redirect } from "next/navigation";
import { authMode, isAuthenticated } from "@/lib/auth";
import LoginForm from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await isAuthenticated()) redirect("/");

  if (authMode() === "locked") {
    return (
      <div className="card mx-auto max-w-md p-6">
        <h1 className="text-lg font-semibold">Configuração pendente</h1>
        <p className="mt-2 text-sm text-ink-300">
          Defina <code className="text-accent-soft">APP_PASSWORD</code> no arquivo de ambiente antes de usar a
          aplicação em produção.
        </p>
      </div>
    );
  }

  return <LoginForm />;
}
