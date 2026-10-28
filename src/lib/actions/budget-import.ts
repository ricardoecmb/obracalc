"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth-utils";
import {
  analyzeBudgetImport,
  executeBudgetImport,
  parseBudgetFile,
  suggestBudgetMapping,
  type BudgetColumnMapping,
  type BudgetFileType,
  type BudgetImportPreview,
  type BudgetImportResolution,
  type ExecuteBudgetImportResult,
} from "@/lib/services/budget-import";

function safeRevalidatePath(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // Fora do contexto HTTP do Next.js (testes) a revalidação é ignorada.
  }
}

export interface PreviewBudgetImportResult {
  success: boolean;
  headers?: string[];
  delimiter?: string;
  suggestedMapping?: Partial<BudgetColumnMapping>;
  preview?: BudgetImportPreview;
  error?: string;
}

/**
 * Lê o arquivo, sugere o mapeamento e devolve a prévia com conflitos.
 * Nada é persistido nesta etapa.
 */
export async function previewBudgetImportAction(params: {
  revisionId?: string;
  content: string;
  fileType: BudgetFileType;
  mapping?: BudgetColumnMapping;
}): Promise<PreviewBudgetImportResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Não autorizado" };

  if (!params.content || !params.content.trim()) {
    return { success: false, error: "Arquivo vazio ou ilegível." };
  }

  try {
    const parsed = await parseBudgetFile({
      content: params.content,
      fileType: params.fileType,
    });
    const mapping = params.mapping ?? suggestBudgetMapping(parsed.headers);

    if (!mapping.stageCode || !mapping.code || !mapping.quantity) {
      return {
        success: true,
        headers: parsed.headers,
        delimiter: parsed.delimiter,
        suggestedMapping: mapping,
        error:
          "Mapeie as colunas obrigatórias: etapa, código de serviço e quantidade.",
      };
    }

    const preview = await analyzeBudgetImport({
      userId: user.id,
      content: params.content,
      fileType: params.fileType,
      mapping: mapping as BudgetColumnMapping,
    });

    return {
      success: true,
      headers: parsed.headers,
      delimiter: parsed.delimiter,
      suggestedMapping: mapping,
      preview,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Falha ao analisar o arquivo de orçamento.",
    };
  }
}

export async function executeBudgetImportAction(params: {
  revisionId: string;
  content: string;
  fileType: BudgetFileType;
  mapping: BudgetColumnMapping;
  resolutions?: Record<string, BudgetImportResolution>;
  confirm?: boolean;
}): Promise<ExecuteBudgetImportResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Não autorizado" };

  try {
    const result = await executeBudgetImport({
      userId: user.id,
      revisionId: params.revisionId,
      content: params.content,
      fileType: params.fileType,
      mapping: params.mapping,
      resolutions: params.resolutions,
      confirm: params.confirm,
    });

    if (result.success) {
      safeRevalidatePath("/budgets");
      safeRevalidatePath(`/budgets/${params.revisionId}`);
      safeRevalidatePath("/dashboard");
    }

    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao importar orçamento.",
    };
  }
}
