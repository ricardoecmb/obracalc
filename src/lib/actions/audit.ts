"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/auth-utils";
import {
  justifyAuditResult,
  runRevisionAudit,
  type AuditFinding,
} from "@/lib/services/audit-rules";

export interface AuditResultDto {
  id: string;
  type: string;
  severity: "ERROR" | "WARNING" | "INFO";
  code: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  field: string | null;
  justification: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface RunRevisionAuditActionResult {
  success: boolean;
  findings?: AuditFinding[];
  results?: AuditResultDto[];
  summary?: { errors: number; warnings: number; infos: number };
  error?: string;
}

function serializeAuditResult(result: {
  id: string;
  type: string;
  severity: string;
  code: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  field: string | null;
  justification: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}): AuditResultDto {
  return {
    id: result.id,
    type: result.type,
    severity: result.severity as AuditResultDto["severity"],
    code: result.code,
    message: result.message,
    entityType: result.entityType,
    entityId: result.entityId,
    field: result.field,
    justification: result.justification,
    resolvedAt: result.resolvedAt?.toISOString() ?? null,
    createdAt: result.createdAt.toISOString(),
  };
}

export async function runRevisionAuditAction(
  revisionId: string
): Promise<RunRevisionAuditActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Não autorizado" };

  try {
    const outcome = await runRevisionAudit({ revisionId, userId: user.id });
    const results = await prisma.auditResult.findMany({
      where: { budgetRevisionId: revisionId },
      orderBy: [{ severity: "asc" }, { type: "asc" }],
    });

    try {
      revalidatePath(`/budgets`);
    } catch {
      // Ignora fora do contexto HTTP.
    }

    return {
      success: true,
      findings: outcome.findings,
      results: results.map(serializeAuditResult),
      summary: {
        errors: outcome.errors,
        warnings: outcome.warnings,
        infos: outcome.infos,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao auditar revisão.",
    };
  }
}

export async function getRevisionAuditAction(
  revisionId: string
): Promise<RunRevisionAuditActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Não autorizado" };

  try {
    const revision = await prisma.budgetRevision.findFirst({
      where: { id: revisionId, budget: { userId: user.id } },
      select: { id: true },
    });

    if (!revision) return { success: false, error: "Revisão não encontrada." };

    const results = await prisma.auditResult.findMany({
      where: { budgetRevisionId: revisionId },
      orderBy: [{ severity: "asc" }, { type: "asc" }],
    });

    return {
      success: true,
      results: results.map(serializeAuditResult),
      summary: {
        errors: results.filter((result) => result.severity === "ERROR").length,
        warnings: results.filter((result) => result.severity === "WARNING").length,
        infos: results.filter((result) => result.severity === "INFO").length,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao consultar auditoria.",
    };
  }
}

export async function justifyAuditResultAction(params: {
  auditResultId: string;
  justification: string;
}): Promise<{ success: boolean; result?: AuditResultDto; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Não autorizado" };

  try {
    const updated = await justifyAuditResult({
      auditResultId: params.auditResultId,
      userId: user.id,
      justification: params.justification,
    });

    return { success: true, result: serializeAuditResult(updated) };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao justificar alerta.",
    };
  }
}
