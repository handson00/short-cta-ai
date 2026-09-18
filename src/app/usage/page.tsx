import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import UsagePanel from "@/components/UsagePanel";

export const dynamic = "force-dynamic";

export default async function UsagePage() {
  if (!(await isAuthenticated())) redirect("/login");
  return <UsagePanel />;
}
