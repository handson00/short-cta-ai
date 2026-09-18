import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import SettingsForm from "@/components/SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  if (!(await isAuthenticated())) redirect("/login");
  return <SettingsForm />;
}
