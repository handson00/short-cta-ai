import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import EditorShell from "@/components/editor/EditorShell";

export const dynamic = "force-dynamic";

export default async function EditorPage() {
  if (!(await isAuthenticated())) redirect("/login");
  return <EditorShell />;
}