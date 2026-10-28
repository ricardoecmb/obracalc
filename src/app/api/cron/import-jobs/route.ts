import { NextRequest, NextResponse } from "next/server";
import { getEnvironment, validateEnvironment } from "@/lib/config/env";
import { isAuthorizedCron } from "@/lib/security/cron";
import { processPendingImportJobs } from "@/lib/services/import-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(request: NextRequest) {
  const env = getEnvironment();
  if (!env.CRON_SECRET) {
    return NextResponse.json(
      { error: "Cron não configurado (CRON_SECRET ausente)." },
      { status: 503 }
    );
  }

  if (!isAuthorizedCron(request.headers.get("authorization"), env.CRON_SECRET)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const validation = validateEnvironment(process.env);
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Configuração inválida.", details: validation.errors },
      { status: 503 }
    );
  }

  try {
    const result = await processPendingImportJobs();
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Erro no cron de importações:", error);
    return NextResponse.json(
      { error: "Erro ao processar a fila de importações." },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
