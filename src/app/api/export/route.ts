import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api";
import { buildExportJson, buildExportRows, toCsv } from "@/lib/export";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await requireAuth();
  if (denied) return denied;

  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "json" ? "json" : "csv";
  const ids = url.searchParams.get("ids")?.split(",").filter(Boolean);
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "json") {
    return NextResponse.json(buildExportJson(ids) as object, {
      headers: { "content-disposition": `attachment; filename="short-cta-ai-${stamp}.json"` },
    });
  }

  return new NextResponse(toCsv(buildExportRows(ids)), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="short-cta-ai-${stamp}.csv"`,
    },
  });
}
