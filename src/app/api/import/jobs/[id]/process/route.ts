import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { getImportJob, processImportJob } from "@/lib/services/import-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Worker sob demanda para desenvolvimento e para o botão "processar agora".
 * Em produção o cron também processa a fila, garantindo recuperação de jobs
 * criados quando o processo anterior foi interrompido.
 */
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { id } = await context.params;
  const owned = await getImportJob(user.id, id);
  if (!owned) {
    return NextResponse.json({ error: "Job não encontrado." }, { status: 404 });
  }

  const result = await processImportJob(id, { userId: user.id });
  return NextResponse.json(
    { job: result.job, processed: result.processed, message: result.message },
    { headers: { "Cache-Control": "no-store" } }
  );
}
