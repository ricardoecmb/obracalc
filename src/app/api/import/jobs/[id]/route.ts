import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { getImportJob } from "@/lib/services/import-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { id } = await context.params;
  const job = await getImportJob(user.id, id);
  if (!job) {
    return NextResponse.json({ error: "Job não encontrado." }, { status: 404 });
  }

  return NextResponse.json({ job }, { headers: { "Cache-Control": "no-store" } });
}
