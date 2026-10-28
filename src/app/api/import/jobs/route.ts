import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import { getEnvironment, type AppEnv } from "@/lib/config/env";
import {
  createImportJob,
  IMPORT_DATA_TYPES,
  listImportJobs,
  type ImportDataType,
  type ImportJobContextInput,
} from "@/lib/services/import-jobs";
import { sanitizeFileName } from "@/lib/security/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function unauthorized() {
  return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 20);
  const jobs = await listImportJobs(
    user.id,
    Number.isFinite(limit) ? limit : 20
  );

  return NextResponse.json({ jobs }, { headers: { "Cache-Control": "no-store" } });
}

function parseJsonObject(value: FormDataEntryValue | null, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Campo ${field} é obrigatório.`);
  }
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("objeto");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`Campo ${field} deve ser um JSON de objeto válido.`);
  }
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  let env: AppEnv;
  try {
    env = getEnvironment();
  } catch {
    return NextResponse.json(
      { error: "Configuração de ambiente inválida no servidor." },
      { status: 503 }
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Envie o arquivo como multipart/form-data." },
      { status: 400 }
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Arquivo não enviado." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "Arquivo vazio." }, { status: 400 });
  }
  if (file.size > env.IMPORT_MAX_FILE_BYTES) {
    return NextResponse.json(
      {
        error: `Arquivo excede o limite de ${Math.round(
          env.IMPORT_MAX_FILE_BYTES / 1024 / 1024
        )} MB.`,
      },
      { status: 413 }
    );
  }

  const dataType = String(form.get("dataType") ?? "") as ImportDataType;
  if (!IMPORT_DATA_TYPES.includes(dataType)) {
    return NextResponse.json(
      { error: "Tipo de importação inválido." },
      { status: 400 }
    );
  }

  try {
    const mapping = parseJsonObject(form.get("mapping"), "mapping");
    const context = parseJsonObject(form.get("context"), "context") as unknown as
      ImportJobContextInput;

    if (dataType === "BUDGET" && !context.fileType) {
      context.fileType = file.name.toLowerCase().endsWith(".xlsx") ? "XLSX" : "CSV";
    }

    const content = Buffer.from(await file.arrayBuffer());
    const formKey = form.get("idempotencyKey");
    const result = await createImportJob({
      userId: user.id,
      fileName: sanitizeFileName(file.name),
      content,
      dataType,
      mapping: mapping as Record<string, string | undefined>,
      context,
      idempotencyKey:
        request.headers.get("Idempotency-Key") ??
        (typeof formKey === "string" && formKey.trim() ? formKey : undefined),
      profileId: form.get("profileId") ? String(form.get("profileId")) : null,
    });

    return NextResponse.json(
      { job: result.job, reused: result.reused },
      {
        status: result.reused ? 200 : 201,
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erro ao criar job de importação.";
    const status = /excede o limite|vazio/i.test(message) ? 413 : 400;
    console.error("Erro ao criar job de importação:", message);
    return NextResponse.json({ error: message }, { status });
  }
}
