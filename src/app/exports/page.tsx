import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import ExportsPanel from "@/components/ExportsPanel";

export const dynamic = "force-dynamic";

export default async function ExportsPage() {
  if (!(await isAuthenticated())) redirect("/login");
  return <ExportsPanel />;
}
