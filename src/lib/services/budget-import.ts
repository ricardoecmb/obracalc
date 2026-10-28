import Decimal from "decimal.js";
import Papa from "papaparse";
import ExcelJS from "exceljs";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { createAuditEntry } from "@/lib/db/audit";
import { defaultUnitConverter } from "@/lib/engine/units";
import type { CostBreakdown } from "@/lib/engine/types";
import { parseBrazilianNumber } from "./import-pipeline";
import { assertRevisionMutable } from "./snapshot";
import { evaluateComposition } from "./composition-cost";
import {
  computeBudgetItemCosting,
  getRevisionRounder,
} from "./revision-costing";

export type BudgetFileType = "CSV" | "XLSX";

export interface BudgetColumnMapping {
  stageCode: string;
  stageTitle?: string;
  code: string;
  description?: string;
  unit?: string;
  quantity: string;
  price?: string;
}

export interface BudgetImportRawRow {
  line: number;
  values: Record<string, string>;
}

export interface ParsedBudgetFile {
  headers: string[];
  delimiter?: string;
  rows: BudgetImportRawRow[];
}

export type BudgetImportResolution =
  | "USE_SYSTEM"
  | "USE_FILE"
  | "CONVERT"
  | "CREATE_CLOSED"
  | "SKIP";

export type BudgetImportConflictKind =
  | "MISSING_STAGE"
  | "UNKNOWN_CODE"
  | "UNIT_MISMATCH"
  | "PRICE_DIVERGENCE"
  | "INVALID_QUANTITY"
  | "MISSING_PRICE";

export interface BudgetImportConflict {
  kind: BudgetImportConflictKind;
  severity: "ERROR" | "WARNING";
  message: string;
  resolutions: BudgetImportResolution[];
}

export interface AnalyzedBudgetRow {
  line: number;
  stageCode: string;
  stageTitle: string;
  code: string;
  description: string;
  unit: string;
  quantity: string | null;
  price: string | null;
  matchedComposition: {
    id: string;
    code: string;
    description: string;
    unit: string;
    type: "ANALYTICAL" | "CLOSED";
  } | null;
  calculatedUnitCost: string | null;
  status: "OK" | "CONFLICT" | "INVALID";
  conflicts: BudgetImportConflict[];
  suggestedResolution: BudgetImportResolution | null;
}

export interface BudgetImportPreview {
  rows: AnalyzedBudgetRow[];
  summary: {
    totalRows: number;
    ready: number;
    conflicts: number;
    invalid: number;
  };
}

const MAPPING_SYNONYMS: Record<keyof BudgetColumnMapping, string[]> = {
  stageCode: ["ETAPA", "COD_ETAPA", "CODIGO_ETAPA", "EAP", "COD_EAP", "GRUPO"],
  stageTitle: ["DESCRICAO_ETAPA", "NOME_ETAPA", "TITULO_ETAPA", "DESC_ETAPA", "ETAPA_DESCRICAO"],
  code: ["CODIGO", "COD", "CODIGO_COMPOSICAO", "COD_COMP", "ITEM", "SERVICO", "CODIGO_SERVICO"],
  description: ["DESCRICAO", "DESC", "DESCRICAO_SERVICO", "NOME", "SERVICO_DESCRICAO"],
  unit: ["UNIDADE", "UN", "UND", "UNID"],
  quantity: ["QUANTIDADE", "QTD", "QUANT", "QTDE"],
  price: ["PRECO", "PRECO_UNITARIO", "CUSTO", "VALOR", "CUSTO_UNITARIO"],
};

function normalizeHeader(value: string): string {
  return value
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Sugere o mapeamento de colunas a partir dos cabeçalhos do arquivo.
 * Evita reutilizar a mesma coluna para campos diferentes.
 */
export function suggestBudgetMapping(headers: string[]): Partial<BudgetColumnMapping> {
  const normalized = headers.map((header) => ({
    header,
    key: normalizeHeader(header),
  }));
  const used = new Set<string>();
  const suggestion: Partial<BudgetColumnMapping> = {};

  for (const field of Object.keys(MAPPING_SYNONYMS) as Array<keyof BudgetColumnMapping>) {
    const synonyms = MAPPING_SYNONYMS[field];
    const exact = normalized.find(
      (candidate) => !used.has(candidate.header) && synonyms.includes(candidate.key)
    );
    const partial =
      exact ??
      normalized.find(
        (candidate) =>
          !used.has(candidate.header) &&
          synonyms.some((synonym) => candidate.key.includes(synonym))
      );

    if (partial) {
      suggestion[field] = partial.header;
      used.add(partial.header);
    }
  }

  return suggestion;
}

/**
 * Lê CSV (texto) ou XLSX (base64) e devolve cabeçalhos e linhas normalizadas.
 */
export async function parseBudgetFile(params: {
  content: string;
  fileType: BudgetFileType;
}): Promise<ParsedBudgetFile> {
  if (params.fileType === "CSV") {
    const clean = params.content.replace(/^\uFEFF/, "");
    const parsed = Papa.parse<Record<string, string>>(clean, {
      header: true,
      skipEmptyLines: "greedy",
    });

    const headers = parsed.meta.fields ?? [];
    const rows = parsed.data
      .map((values, index) => ({ line: index + 2, values }))
      .filter((row) => Object.values(row.values).some((value) => String(value ?? "").trim()));

    return { headers, delimiter: parsed.meta.delimiter, rows };
  }

  const workbook = new ExcelJS.Workbook();
  const buffer = Buffer.from(params.content, "base64");
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);

  const worksheet = workbook.worksheets.find((sheet) => sheet.rowCount > 0);
  if (!worksheet) {
    return { headers: [], rows: [] };
  }

  const headerRow = worksheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
    headers[columnNumber - 1] = String(cell.text ?? "").trim();
  });

  const effectiveHeaders = headers.filter((header) => header && header.length > 0);
  const rows: BudgetImportRawRow[] = [];

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;

    const values: Record<string, string> = {};
    let hasValue = false;
    for (let column = 1; column <= effectiveHeaders.length; column++) {
      const header = headers[column - 1];
      if (!header) continue;
      const text = String(row.getCell(column).text ?? "").trim();
      values[header] = text;
      if (text) hasValue = true;
    }

    if (hasValue) rows.push({ line: rowNumber, values });
  });

  return { headers: effectiveHeaders, rows };
}

function readCell(row: BudgetImportRawRow, column?: string): string {
  if (!column) return "";
  return String(row.values[column] ?? "").trim();
}

function normalizeUnit(value: string): string {
  if (!value) return "";
  try {
    return defaultUnitConverter.normalize(value);
  } catch {
    return value.trim().toLowerCase();
  }
}

async function findCompositionForCode(userId: string, code: string) {
  return prisma.composition.findFirst({
    where: { userId, code, active: true },
    orderBy: [{ version: "desc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      code: true,
      description: true,
      unit: true,
      type: true,
      closedTotalPrice: true,
      closedMaterialPrice: true,
      closedLaborPrice: true,
      closedEquipmentPrice: true,
      closedOtherPrice: true,
    },
  });
}

/**
 * Analisa o arquivo sem persistir nada. Cada divergência traz as resoluções
 * aceitas, e nenhuma associação é gravada sem confirmação explícita.
 */
export async function analyzeBudgetImport(params: {
  userId: string;
  content: string;
  fileType: BudgetFileType;
  mapping: BudgetColumnMapping;
}): Promise<BudgetImportPreview> {
  const parsed = await parseBudgetFile({
    content: params.content,
    fileType: params.fileType,
  });

  const rows: AnalyzedBudgetRow[] = [];
  const compositionCache = new Map<
    string,
    Awaited<ReturnType<typeof findCompositionForCode>>
  >();

  for (const raw of parsed.rows) {
    const stageCode = readCell(raw, params.mapping.stageCode);
    const stageTitle = readCell(raw, params.mapping.stageTitle);
    const code = readCell(raw, params.mapping.code);
    const description = readCell(raw, params.mapping.description);
    const unit = readCell(raw, params.mapping.unit);
    const rawQuantity = readCell(raw, params.mapping.quantity);
    const rawPrice = readCell(raw, params.mapping.price);

    const quantity = parseBrazilianNumber(rawQuantity);
    const price = parseBrazilianNumber(rawPrice);

    const conflicts: BudgetImportConflict[] = [];
    let matchedComposition: AnalyzedBudgetRow["matchedComposition"] = null;
    let calculatedUnitCost: string | null = null;
    let suggestedResolution: BudgetImportResolution | null = null;

    if (!stageCode) {
      conflicts.push({
        kind: "MISSING_STAGE",
        severity: "ERROR",
        message: "Código da etapa (EAP) ausente.",
        resolutions: ["SKIP"],
      });
    }

    if (!code) {
      conflicts.push({
        kind: "UNKNOWN_CODE",
        severity: "ERROR",
        message: "Código de serviço/composição ausente.",
        resolutions: ["SKIP"],
      });
    }

    if (!quantity || quantity.lessThanOrEqualTo(0)) {
      conflicts.push({
        kind: "INVALID_QUANTITY",
        severity: "ERROR",
        message: `Quantidade inválida: '${rawQuantity}'.`,
        resolutions: ["SKIP"],
      });
    }

    if (code) {
      let composition = compositionCache.get(code);
      if (composition === undefined) {
        composition = await findCompositionForCode(params.userId, code);
        compositionCache.set(code, composition);
      }

      if (!composition) {
        conflicts.push({
          kind: "UNKNOWN_CODE",
          severity: "WARNING",
          message: `Código '${code}' não encontrado no catálogo. Crie uma composição fechada com o preço do arquivo ou ignore a linha.`,
          resolutions:
            price && price.greaterThan(0) && unit ? ["CREATE_CLOSED", "SKIP"] : ["SKIP"],
        });
        if (price && price.greaterThan(0) && unit) suggestedResolution = "CREATE_CLOSED";
        else suggestedResolution = "SKIP";
      } else {
        matchedComposition = {
          id: composition.id,
          code: composition.code,
          description: composition.description,
          unit: composition.unit,
          type: composition.type,
        };

        if (unit && normalizeUnit(unit) !== normalizeUnit(composition.unit)) {
          const compatible = defaultUnitConverter.canConvert(unit, composition.unit);
          conflicts.push({
            kind: "UNIT_MISMATCH",
            severity: compatible ? "WARNING" : "ERROR",
            message: compatible
              ? `Unidade do arquivo (${unit}) difere da composição (${composition.unit}); a quantidade pode ser convertida.`
              : `Unidade do arquivo (${unit}) é incompatível com a composição (${composition.unit}).`,
            resolutions: compatible ? ["CONVERT", "USE_SYSTEM", "SKIP"] : ["SKIP"],
          });
          suggestedResolution = compatible ? "CONVERT" : "SKIP";
        }

        if (composition.type === "CLOSED") {
          calculatedUnitCost = composition.closedTotalPrice?.toString() ?? "0";
        } else {
          const evaluated = await evaluateComposition(composition.id, {
            userId: params.userId,
          });
          calculatedUnitCost = evaluated.unitCost.total.toString();
        }

        if (price) {
          const expected = new Decimal(calculatedUnitCost);
          const divergence = price.minus(expected).abs();
          if (divergence.greaterThan("0.01")) {
            const canUseFile = composition.type === "CLOSED";
            conflicts.push({
              kind: "PRICE_DIVERGENCE",
              severity: "WARNING",
              message: `Preço do arquivo (${price.toString()}) difere do valor do sistema (${expected.toString()}).`,
              resolutions: canUseFile
                ? ["USE_FILE", "USE_SYSTEM", "SKIP"]
                : ["USE_SYSTEM", "SKIP"],
            });
            suggestedResolution = canUseFile ? "USE_FILE" : "USE_SYSTEM";
          }
        }
      }
    }

    const hasError = conflicts.some((conflict) => conflict.severity === "ERROR");
    const status: AnalyzedBudgetRow["status"] = hasError
      ? "INVALID"
      : conflicts.length > 0
        ? "CONFLICT"
        : "OK";

    rows.push({
      line: raw.line,
      stageCode,
      stageTitle,
      code,
      description,
      unit,
      quantity: quantity?.toString() ?? null,
      price: price?.toString() ?? null,
      matchedComposition,
      calculatedUnitCost,
      status,
      conflicts,
      suggestedResolution,
    });
  }

  return {
    rows,
    summary: {
      totalRows: rows.length,
      ready: rows.filter((row) => row.status === "OK").length,
      conflicts: rows.filter((row) => row.status === "CONFLICT").length,
      invalid: rows.filter((row) => row.status === "INVALID").length,
    },
  };
}

export interface ExecuteBudgetImportParams {
  userId: string;
  revisionId: string;
  content: string;
  fileType: BudgetFileType;
  mapping: BudgetColumnMapping;
  /** Resoluções por número de linha do arquivo. */
  resolutions?: Record<string, BudgetImportResolution>;
  /** Confirmação explícita de que os conflitos foram analisados. */
  confirm?: boolean;
}

export interface BudgetImportAppliedRow {
  line: number;
  itemId: string;
  stageCode: string;
  compositionCode: string;
  quantity: string;
}

export interface ExecuteBudgetImportResult {
  success: boolean;
  requiresConfirmation?: boolean;
  preview?: BudgetImportPreview;
  pendingLines?: number[];
  report?: {
    created: number;
    skipped: number;
    stagesCreated: number;
    applied: BudgetImportAppliedRow[];
  };
  error?: string;
}

function buildCostOverride(params: {
  composition: {
    closedMaterialPrice: Decimal | null;
    closedLaborPrice: Decimal | null;
    closedEquipmentPrice: Decimal | null;
    closedOtherPrice: Decimal | null;
  };
  total: Decimal;
}): CostBreakdown {
  const material = params.composition.closedMaterialPrice ?? new Decimal(0);
  const labor = params.composition.closedLaborPrice ?? new Decimal(0);
  const equipment = params.composition.closedEquipmentPrice ?? new Decimal(0);
  const explicitOther = params.composition.closedOtherPrice ?? new Decimal(0);
  const allocated = material.plus(labor).plus(equipment).plus(explicitOther);
  const other = explicitOther.plus(params.total.minus(allocated));

  return { material, labor, equipment, other, total: params.total };
}

/**
 * Executa a importação após confirmação. Qualquer linha com conflito precisa
 * de uma resolução explícita; caso contrário nada é gravado.
 */
export async function executeBudgetImport(
  params: ExecuteBudgetImportParams
): Promise<ExecuteBudgetImportResult> {
  const revision = await prisma.budgetRevision.findFirst({
    where: { id: params.revisionId, budget: { userId: params.userId } },
    include: {
      budget: { select: { id: true, title: true } },
      bdiConfig: true,
      stages: { include: { items: true } },
    },
  });

  if (!revision) {
    return { success: false, error: "Revisão não encontrada." };
  }

  await assertRevisionMutable(revision.id);

  const preview = await analyzeBudgetImport({
    userId: params.userId,
    content: params.content,
    fileType: params.fileType,
    mapping: params.mapping,
  });

  const resolutions = params.resolutions ?? {};
  const conflictingRows = preview.rows.filter((row) => row.status !== "OK");
  const pendingLines = conflictingRows
    .filter((row) => row.status === "CONFLICT" && !resolutions[String(row.line)])
    .map((row) => row.line);

  if (conflictingRows.length > 0 && (!params.confirm || pendingLines.length > 0)) {
    return {
      success: false,
      requiresConfirmation: true,
      preview,
      pendingLines,
      error:
        pendingLines.length > 0
          ? `${pendingLines.length} conflito(s) sem resolução. Resolva-os antes de confirmar a importação.`
          : "A importação possui conflitos e exige confirmação explícita.",
    };
  }

  const rounder = getRevisionRounder(revision);
  const revisionForCosting = { ...revision, bdiConfig: revision.bdiConfig };

  try {
    const result = await prisma.$transaction(async (tx) => {
      const stageByCode = new Map(revision.stages.map((stage) => [stage.code, stage]));
      const sortOrderByStage = new Map(
        revision.stages.map((stage) => [
          stage.id,
          stage.items.reduce((max, item) => Math.max(max, item.sortOrder), 0),
        ])
      );
      const maxStageSort = revision.stages.reduce(
        (max, stage) => Math.max(max, stage.sortOrder),
        0
      );

      let stagesCreated = 0;
      let created = 0;
      let skipped = 0;
      const applied: BudgetImportAppliedRow[] = [];

      const ensureStage = async (code: string, title: string) => {
        const existing = stageByCode.get(code);
        if (existing) return existing;

        const stage = await tx.stage.create({
          data: {
            budgetRevisionId: revision.id,
            parentStageId: null,
            code,
            title: title || `Etapa ${code}`,
            sortOrder: maxStageSort + stagesCreated + 1,
          },
        });
        stageByCode.set(code, stage as unknown as (typeof revision.stages)[number]);
        sortOrderByStage.set(stage.id, 0);
        stagesCreated++;
        return stage;
      };

      for (const row of preview.rows) {
        if (row.status === "INVALID") {
          skipped++;
          continue;
        }

        const resolution =
          row.status === "OK"
            ? "USE_SYSTEM"
            : (resolutions[String(row.line)] as BudgetImportResolution);

        if (!resolution || resolution === "SKIP") {
          skipped++;
          continue;
        }

        const stage = await ensureStage(row.stageCode, row.stageTitle);

        let compositionId = row.matchedComposition?.id ?? null;
        let compositionForCost:
          | (NonNullable<Awaited<ReturnType<typeof findCompositionForCode>>>)
          | null = null;

        if (!compositionId && resolution === "CREATE_CLOSED") {
          if (!row.price || new Decimal(row.price).lessThanOrEqualTo(0)) {
            skipped++;
            continue;
          }

          const createdComposition = await tx.composition.create({
            data: {
              userId: params.userId,
              code: row.code,
              description: row.description || `Serviço ${row.code}`,
              unit: row.unit || "un",
              source: "CUSTOM",
              type: "CLOSED",
              closedTotalPrice: row.price,
              version: 1,
            },
          });
          compositionId = createdComposition.id;
          compositionForCost = {
            id: createdComposition.id,
            code: createdComposition.code,
            description: createdComposition.description,
            unit: createdComposition.unit,
            type: createdComposition.type,
            closedTotalPrice: createdComposition.closedTotalPrice,
            closedMaterialPrice: createdComposition.closedMaterialPrice,
            closedLaborPrice: createdComposition.closedLaborPrice,
            closedEquipmentPrice: createdComposition.closedEquipmentPrice,
            closedOtherPrice: createdComposition.closedOtherPrice,
          };
        } else if (compositionId) {
          compositionForCost = await tx.composition.findUnique({
            where: { id: compositionId },
            select: {
              id: true,
              code: true,
              description: true,
              unit: true,
              type: true,
              closedTotalPrice: true,
              closedMaterialPrice: true,
              closedLaborPrice: true,
              closedEquipmentPrice: true,
              closedOtherPrice: true,
            },
          });
        }

        if (!compositionId || !compositionForCost) {
          skipped++;
          continue;
        }

        let quantity = new Decimal(row.quantity!);
        if (resolution === "CONVERT" && row.unit) {
          quantity = defaultUnitConverter.convert(
            quantity,
            row.unit,
            compositionForCost.unit
          );
        }

        let unitCostOverride: CostBreakdown | undefined;
        if (resolution === "USE_FILE") {
          if (compositionForCost.type !== "CLOSED" || !row.price) {
            skipped++;
            continue;
          }
          unitCostOverride = buildCostOverride({
            composition: compositionForCost,
            total: new Decimal(row.price),
          });
        }

        const costing = await computeBudgetItemCosting({
          userId: params.userId,
          compositionId,
          quantity,
          revision: revisionForCosting,
          rounder,
          db: tx as Prisma.TransactionClient,
          unitCostOverride,
        });

        const sortOrder = (sortOrderByStage.get(stage.id) ?? 0) + 1;
        sortOrderByStage.set(stage.id, sortOrder);

        const item = await tx.budgetItem.create({
          data: {
            stageId: stage.id,
            compositionId,
            sortOrder,
            quantity: costing.quantity.toString(),
            unitCostMaterial: costing.unitCost.material.toString(),
            unitCostLabor: costing.unitCost.labor.toString(),
            unitCostEquipment: costing.unitCost.equipment.toString(),
            unitCostOther: costing.unitCost.other.toString(),
            unitCostTotal: costing.unitCost.total.toString(),
            subtotal: costing.subtotal.toString(),
            bdiRate: costing.bdiRate.toString(),
            subtotalWithBdi: costing.subtotalWithBdi.toString(),
            notes: `Importado do arquivo (linha ${row.line})`,
          },
        });

        created++;
        applied.push({
          line: row.line,
          itemId: item.id,
          stageCode: row.stageCode,
          compositionCode: row.code,
          quantity: costing.quantity.toString(),
        });
      }

      return { created, skipped, stagesCreated, applied };
    });

    await createAuditEntry({
      userId: params.userId,
      entityType: "BudgetRevision",
      entityId: revision.id,
      action: "IMPORT_BUDGET",
      metadata: {
        fileType: params.fileType,
        summary: preview.summary,
        resolutions,
        report: result,
      },
    });

    return { success: true, preview, report: result };
  } catch (error) {
    return {
      success: false,
      preview,
      error:
        error instanceof Error ? error.message : "Erro ao importar orçamento.",
    };
  }
}
