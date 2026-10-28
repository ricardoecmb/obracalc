"use server";

import { getCurrentUser } from "@/lib/auth-utils";
import {
  previewCsvContent,
  importResourcesCsv,
  importCompositionsCsv,
  type ColumnMapping,
  type ImportReport,
} from "@/lib/services/import-pipeline";
import { DatabaseSource, TaxRegime } from "@prisma/client";
import { revalidatePath } from "next/cache";

export interface PreviewCsvResult {
  success: boolean;
  headers?: string[];
  delimiter?: string;
  previewRows?: Record<string, string>[];
  suggestedMapping?: Partial<ColumnMapping>;
  error?: string;
}

export async function previewCsvAction(csvContent: string): Promise<PreviewCsvResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  if (!csvContent || !csvContent.trim()) {
    return { success: false, error: "Arquivo CSV vazio ou ilegível." };
  }

  try {
    const preview = previewCsvContent(csvContent);
    return {
      success: true,
      headers: preview.headers,
      delimiter: preview.delimiter,
      previewRows: preview.previewRows,
      suggestedMapping: preview.suggestedMapping,
    };
  } catch (err) {
    console.error("Erro ao gerar prévia do CSV:", err);
    return { success: false, error: "Falha ao analisar a estrutura do arquivo CSV." };
  }
}

export interface ExecuteImportParams {
  csvContent: string;
  dataType: "RESOURCES" | "COMPOSITIONS";
  mapping: ColumnMapping;
  source: DatabaseSource;
  state?: string | null;
  referenceMonth: string;
  taxRegime?: TaxRegime | null;
}

export interface ExecuteImportResult {
  success: boolean;
  report?: ImportReport;
  error?: string;
}

export async function executeImportAction(params: ExecuteImportParams): Promise<ExecuteImportResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  if (!params.csvContent || !params.csvContent.trim()) {
    return { success: false, error: "Conteúdo do CSV ausente." };
  }

  if (!params.referenceMonth) {
    return { success: false, error: "Competência (mês/ano) é obrigatória." };
  }

  const context = {
    userId: user.id,
    source: params.source,
    state: params.state || null,
    referenceMonth: params.referenceMonth.trim(),
    taxRegime: params.taxRegime || null,
  };

  try {
    let report: ImportReport;

    if (params.dataType === "RESOURCES") {
      report = await importResourcesCsv(params.csvContent, params.mapping, context);
      revalidatePath("/resources");
    } else {
      report = await importCompositionsCsv(params.csvContent, params.mapping, context);
      revalidatePath("/compositions");
    }

    revalidatePath("/dashboard");
    return { success: true, report };
  } catch (err) {
    console.error("Erro na execução da importação:", err);
    return { success: false, error: "Erro crítico ao processar importação." };
  }
}
