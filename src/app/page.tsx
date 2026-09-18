import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import Library from "@/components/Library";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!(await isAuthenticated())) redirect("/login");
  return <Library />;
}
