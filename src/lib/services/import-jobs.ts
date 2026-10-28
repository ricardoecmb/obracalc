import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import Papa from "papaparse";
import { prisma } from "@/lib/db/prisma";
import { createAuditEntry } from "@/lib/db/audit";
import { getEnvironment } from "@/lib/config/env";
import { sanitizeFileName } from "@/lib/security/paths";
import {
  buildImportObjectKey,
  computeSha256,
  getStorage,
  StorageObjectNotFoundError,
  type StorageDriverName,
} from "@/lib/storage";
import {
  importCompositionsCsv,
  importResourcesCsv,
  type ColumnMapping,
  type ImportContext,
  type ImportReport,
} from "@/lib/services/import-pipeline";
import {
  executeBudgetImport,
  type BudgetColumnMapping,
  type BudgetImportResolution,
  type BudgetFileType,
} from "@/lib/services/budget-import";

export const IMPORT_DATA_TYPES = ["RESOURCES", "COMPOSITIONS", "BUDGET"] as const;
export type ImportDataType = (typeof IMPORT_DATA_TYPES)[number];

export const IMPORT_JOB_STATUSES = [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
] as const;
export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];

const DATABASE_SOURCES = ["SINAPI", "SICRO", "CUSTOM", "SUPPLIER"] as const;
const TAX_REGIMES = ["DESONERADO", "NAO_DESONERADO"] as const;

export type ImportJobContextInput = Omit<ImportContext, "userId"> & {
  fileType?: BudgetFileType;
  revisionId?: string;
  resolutions?: Record<string, BudgetImportResolution>;
  confirm?: boolean;
};

export interface CreateImportJobParams {
  userId: string;
  fileName: string;
  content: Buffer;
  dataType: ImportDataType;
  mapping: Record<string, string | undefined>;
  context: ImportJobContextInput;
  idempotencyKey?: string;
  profileId?: string | null;
}

export interface ImportJobView {
  id: string;
  dataType: ImportDataType;
  status: ImportJobStatus;
  fileName: string;
  fileSizeBytes: number;
  checksum: string;
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  errorMessage: string | null;
  errors: unknown;
  report: unknown;
  attempts: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateImportJobResult {
  job: ImportJobView;
  reused: boolean;
}

export interface ProcessImportJobResult {
  job: ImportJobView;
  processed: boolean;
  message?: string;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(",")}}`;
}

function assertDataType(value: string): ImportDataType {
  if (!IMPORT_DATA_TYPES.includes(value as ImportDataType)) {
    throw new Error(`Tipo de importação inválido: ${value}`);
  }
  return value as ImportDataType;
}

function assertContext(context: ImportJobContextInput, dataType: ImportDataType): void {
  if (!context || typeof context !== "object") {
    throw new Error("Contexto da importação ausente.");
  }

  if (!DATABASE_SOURCES.includes(context.source as (typeof DATABASE_SOURCES)[number])) {
    throw new Error("Fonte de dados inválida.");
  }

  if (!context.referenceMonth || !/^\d{4}\/\d{2}$/.test(context.referenceMonth)) {
    throw new Error("Competência inválida. Use o formato AAAA/MM.");
  }

  if (
    context.taxRegime &&
    !TAX_REGIMES.includes(context.taxRegime as (typeof TAX_REGIMES)[number])
  ) {
    throw new Error("Regime tributário inválido.");
  }

  if (dataType === "BUDGET") {
    if (!context.revisionId) {
      throw new Error("Revisão de orçamento é obrigatória para importar orçamento.");
    }
    if (context.fileType && !["CSV", "XLSX"].includes(context.fileType)) {
      throw new Error("Formato de arquivo de orçamento inválido.");
    }
  }
}

function countCsvRows(content: string, maxRows: number): number {
  const parsed = Papa.parse<Record<string, string>>(content.replace(/^\uFEFF/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    preview: maxRows + 1,
  });

  if (parsed.data.length > maxRows) {
    throw new Error(
      `O arquivo excede o limite de ${maxRows.toLocaleString("pt-BR")} linhas por importação.`
    );
  }
  return parsed.data.length;
}

export function serializeImportJob(job: {
  id: string;
  dataType: string;
  status: string;
  fileName: string;
  fileSizeBytes: bigint;
  checksum: string;
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  errorMessage: string | null;
  errors: Prisma.JsonValue | null;
  report: Prisma.JsonValue | null;
  attempts: number;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ImportJobView {
  return {
    id: job.id,
    dataType: job.dataType as ImportDataType,
    status: job.status as ImportJobStatus,
    fileName: job.fileName,
    fileSizeBytes: Number(job.fileSizeBytes),
    checksum: job.checksum,
    totalRows: job.totalRows,
    createdCount: job.createdCount,
    updatedCount: job.updatedCount,
    skippedCount: job.skippedCount,
    errorMessage: job.errorMessage,
    errors: job.errors,
    report: job.report,
    attempts: job.attempts,
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

export async function findImportJobByIdempotencyKey(
  userId: string,
  idempotencyKey: string
) {
  return prisma.importJob.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey } },
  });
}

/**
 * Cria um job durável. O arquivo é enviado ao storage persistente antes do
 * registro no banco; a chave de idempotência evita duplicidade em retries.
 */
export async function createImportJob(
  params: CreateImportJobParams
): Promise<CreateImportJobResult> {
  const env = getEnvironment();
  const dataType = assertDataType(params.dataType);
  assertContext(params.context, dataType);

  if (!params.content || params.content.byteLength === 0) {
    throw new Error("Arquivo vazio.");
  }
  if (params.content.byteLength > env.IMPORT_MAX_FILE_BYTES) {
    throw new Error(
      `Arquivo excede o limite de ${Math.round(env.IMPORT_MAX_FILE_BYTES / 1024 / 1024)} MB.`
    );
  }

  const checksum = computeSha256(params.content);
  const fileName = sanitizeFileName(params.fileName);
  const idempotencyKey =
    params.idempotencyKey?.trim() ||
    `auto-${computeSha256(
      stableJson({
        checksum,
        dataType,
        mapping: params.mapping,
        context: params.context,
      })
    ).slice(0, 40)}`;

  if (idempotencyKey.length > 200) {
    throw new Error("Chave de idempotência muito longa.");
  }

  const existing = await findImportJobByIdempotencyKey(params.userId, idempotencyKey);
  if (existing) {
    return { job: serializeImportJob(existing), reused: true };
  }

  const jobId = randomUUID();
  const storage = getStorage();
  const fileKey = buildImportObjectKey({
    userId: params.userId,
    jobId,
    fileName,
  });

  await storage.put(fileKey, params.content, {
    contentType:
      dataType === "BUDGET" && params.context.fileType === "XLSX"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "text/csv; charset=utf-8",
  });

  try {
    const job = await prisma.importJob.create({
      data: {
        id: jobId,
        userId: params.userId,
        profileId: params.profileId ?? null,
        dataType,
        status: "PENDING",
        fileName,
        fileKey,
        fileSizeBytes: BigInt(params.content.byteLength),
        checksum,
        idempotencyKey,
        storageDriver: storage.name,
        mapping: params.mapping as Prisma.InputJsonValue,
        context: params.context as unknown as Prisma.InputJsonValue,
      },
    });

    await createAuditEntry({
      userId: params.userId,
      entityType: "ImportJob",
      entityId: job.id,
      action: "IMPORT_JOB_CREATED",
      metadata: {
        dataType,
        fileName,
        fileSizeBytes: params.content.byteLength,
        checksum,
        storageDriver: storage.name,
      },
    });

    return { job: serializeImportJob(job), reused: false };
  } catch (error) {
    await storage.delete(fileKey).catch(() => undefined);
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const concurrent = await findImportJobByIdempotencyKey(
        params.userId,
        idempotencyKey
      );
      if (concurrent) {
        return { job: serializeImportJob(concurrent), reused: true };
      }
    }
    throw error;
  }
}

async function runJob(
  job: Awaited<ReturnType<typeof prisma.importJob.findUnique>>
): Promise<ImportReport> {
  if (!job) throw new Error("Job de importação não encontrado.");

  const env = getEnvironment();
  const storage = getStorage(job.storageDriver as StorageDriverName);
  let content: Buffer;
  try {
    content = await storage.get(job.fileKey);
  } catch (error) {
    if (error instanceof StorageObjectNotFoundError) {
      throw new Error("Arquivo do job não encontrado no armazenamento persistente.");
    }
    throw error;
  }

  const checksum = computeSha256(content);
  if (checksum !== job.checksum) {
    throw new Error("Checksum do arquivo não confere com o registro do job.");
  }

  const dataType = assertDataType(job.dataType);
  const context = job.context as unknown as ImportJobContextInput;
  assertContext(context, dataType);
  const mapping = job.mapping as Record<string, string | undefined>;

  if (dataType === "BUDGET") {
    const fileType = context.fileType ?? "CSV";
    const encoded =
      fileType === "XLSX" ? content.toString("base64") : content.toString("utf8");
    if (fileType === "CSV") {
      countCsvRows(encoded, env.IMPORT_MAX_ROWS);
    }

    const result = await executeBudgetImport({
      userId: job.userId,
      revisionId: context.revisionId!,
      content: encoded,
      fileType,
      mapping: mapping as unknown as BudgetColumnMapping,
      resolutions: context.resolutions,
      confirm: context.confirm ?? true,
    });

    if (!result.success || !result.report) {
      throw new Error(result.error || "Falha ao importar orçamento.");
    }

    return {
      totalRows: result.preview?.summary.totalRows ?? result.report.created,
      created: result.report.created,
      updated: 0,
      skipped: result.report.skipped,
      errors: [],
    };
  }

  const text = content.toString("utf8");
  countCsvRows(text, env.IMPORT_MAX_ROWS);

  if (dataType === "RESOURCES") {
    return importResourcesCsv(
      text,
      mapping as unknown as ColumnMapping,
      { ...context, userId: job.userId }
    );
  }

  return importCompositionsCsv(
    text,
    mapping as unknown as ColumnMapping,
    { ...context, userId: job.userId }
  );
}

function truncate(value: string, max = 2000): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Reivindica e processa um job. Retorna o estado final sem relançar erros. */
export async function processImportJob(
  jobId: string,
  options?: { userId?: string; force?: boolean }
): Promise<ProcessImportJobResult> {
  const env = getEnvironment();
  const job = await prisma.importJob.findUnique({ where: { id: jobId } });

  if (!job) {
    throw new Error("Job de importação não encontrado.");
  }
  if (options?.userId && job.userId !== options.userId) {
    throw new Error("Job de importação não encontrado.");
  }
  if (job.status === "COMPLETED") {
    return {
      job: serializeImportJob(job),
      processed: false,
      message: "Job já concluído.",
    };
  }

  const claim = await prisma.importJob.updateMany({
    where: {
      id: jobId,
      status: { in: options?.force ? ["PENDING", "FAILED", "RUNNING"] : ["PENDING", "FAILED"] },
      attempts: options?.force ? undefined : { lt: env.IMPORT_JOB_MAX_ATTEMPTS },
    },
    data: {
      status: "RUNNING",
      startedAt: new Date(),
      completedAt: null,
      errorMessage: null,
      attempts: { increment: 1 },
    },
  });

  if (claim.count === 0) {
    const current = await prisma.importJob.findUnique({ where: { id: jobId } });
    return {
      job: serializeImportJob(current ?? job),
      processed: false,
      message: "Job já está em processamento ou esgotou as tentativas.",
    };
  }

  const running = await prisma.importJob.findUnique({ where: { id: jobId } });
  if (!running) {
    throw new Error("Job de importação não encontrado após reivindicação.");
  }

  try {
    const report = await runJob(running);
    const limitedErrors = report.errors.slice(0, 500);
    const storedReport = { ...report, errors: limitedErrors };

    const completed = await prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        totalRows: report.totalRows,
        createdCount: report.created,
        updatedCount: report.updated,
        skippedCount: report.skipped,
        errors: limitedErrors as unknown as Prisma.InputJsonValue,
        report: storedReport as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
        errorMessage: null,
      },
    });

    await createAuditEntry({
      userId: completed.userId,
      entityType: "ImportJob",
      entityId: completed.id,
      action: "IMPORT_JOB_COMPLETED",
      metadata: {
        dataType: completed.dataType,
        totalRows: completed.totalRows,
        created: completed.createdCount,
        updated: completed.updatedCount,
        skipped: completed.skippedCount,
        checksum: completed.checksum,
      },
    });

    return { job: serializeImportJob(completed), processed: true };
  } catch (error) {
    const message = truncate(
      error instanceof Error ? error.message : "Erro desconhecido ao processar importação."
    );

    const failed = await prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        errorMessage: message,
        completedAt: new Date(),
      },
    });

    await createAuditEntry({
      userId: failed.userId,
      entityType: "ImportJob",
      entityId: failed.id,
      action: "IMPORT_JOB_FAILED",
      metadata: { dataType: failed.dataType, error: message },
    });

    return {
      job: serializeImportJob(failed),
      processed: false,
      message,
    };
  }
}

export interface ProcessPendingResult {
  recovered: number;
  processed: number;
  completed: number;
  failed: number;
  jobs: Array<{ id: string; status: ImportJobStatus; message?: string }>;
}

/** Recupera jobs travados e processa a fila em lote (usado pelo cron). */
export async function processPendingImportJobs(options?: {
  limit?: number;
}): Promise<ProcessPendingResult> {
  const env = getEnvironment();
  const staleBefore = new Date(
    Date.now() - env.IMPORT_JOB_STALE_MINUTES * 60 * 1000
  );

  const recovered = await prisma.importJob.updateMany({
    where: { status: "RUNNING", startedAt: { lt: staleBefore } },
    data: {
      status: "PENDING",
      errorMessage: "Reprocessado após interrupção/timeout do worker anterior.",
    },
  });

  const pending = await prisma.importJob.findMany({
    where: {
      status: "PENDING",
      attempts: { lt: env.IMPORT_JOB_MAX_ATTEMPTS },
    },
    orderBy: { createdAt: "asc" },
    take: options?.limit ?? env.IMPORT_CRON_BATCH_SIZE,
    select: { id: true },
  });

  const result: ProcessPendingResult = {
    recovered: recovered.count,
    processed: 0,
    completed: 0,
    failed: 0,
    jobs: [],
  };

  for (const item of pending) {
    const processed = await processImportJob(item.id);
    result.processed++;
    if (processed.job.status === "COMPLETED") result.completed++;
    if (processed.job.status === "FAILED") result.failed++;
    result.jobs.push({
      id: processed.job.id,
      status: processed.job.status,
      message: processed.message,
    });
  }

  return result;
}

export async function listImportJobs(userId: string, limit = 20) {
  const jobs = await prisma.importJob.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
  });
  return jobs.map(serializeImportJob);
}

export async function getImportJob(userId: string, jobId: string) {
  const job = await prisma.importJob.findFirst({
    where: { id: jobId, userId },
  });
  return job ? serializeImportJob(job) : null;
}
