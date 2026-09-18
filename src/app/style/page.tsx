import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import StylePanel from "@/components/StylePanel";

export const dynamic = "force-dynamic";

export default async function StylePage() {
  if (!(await isAuthenticated())) redirect("/login");
  return <StylePanel />;
}
