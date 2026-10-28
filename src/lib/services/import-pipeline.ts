import Papa from "papaparse";
import Decimal from "decimal.js";
import { prisma } from "@/lib/db/prisma";
import { createAuditEntry } from "@/lib/db/audit";
import { DatabaseSource, TaxRegime, ResourceCategory, CompositionType } from "@prisma/client";

export interface ColumnMapping {
  code: string;
  description: string;
  unit: string;
  price?: string; // Para insumos e composições fechadas
  category?: string; // Para insumos
  laborChargesIncluded?: string;
  laborChargesRate?: string;
  type?: string; // ANALYTICAL ou CLOSED para composições
  closedTotalPrice?: string;
  closedMaterialPrice?: string;
  closedLaborPrice?: string;
  closedEquipmentPrice?: string;
  closedOtherPrice?: string;
}

export interface ImportContext {
  userId: string;
  source: DatabaseSource;
  state?: string | null;
  referenceMonth: string; // YYYY/MM (ex: "2024/01")
  taxRegime?: TaxRegime | null;
  referenceDatabaseId?: string | null;
}

export interface ImportErrorItem {
  line: number;
  code?: string;
  reason: string;
  rawData?: Record<string, string>;
}

export interface ImportReport {
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  errors: ImportErrorItem[];
}

/**
 * Converte valor monetário ou numérico formatado em português brasileiro
 * ("1.234,56" ou "24,50" ou "24.50") em Decimal do Decimal.js.
 */
export function parseBrazilianNumber(raw: unknown): Decimal | null {
  if (raw === null || raw === undefined) return null;
  let str = String(raw).trim();
  if (!str) return null;

  // Remover R$, espaços e símbolos monetários
  str = str.replace(/R\$\s?/gi, "").replace(/\s/g, "");

  // Se contiver vírgula como separador decimal (ex.: "1.234,56" ou "25,40")
  if (str.includes(",")) {
    // Remove pontos de milhares
    str = str.replace(/\./g, "").replace(",", ".");
  }

  try {
    const num = new Decimal(str);
    if (num.isNaN()) return null;
    return num;
  } catch {
    return null;
  }
}

/**
 * Normaliza categoria de insumo a partir de textos variados (SINAPI, SICRO, etc.)
 */
export function normalizeResourceCategory(raw: string | undefined): ResourceCategory {
  if (!raw) return ResourceCategory.MATERIAL;
  const upper = raw.toUpperCase().trim();

  if (upper.includes("MAO") || upper.includes("MÃO") || upper.includes("LABOR") || upper.includes("MO")) {
    return ResourceCategory.LABOR;
  }
  if (upper.includes("EQUIP") || upper.includes("MAQ")) {
    return ResourceCategory.EQUIPMENT;
  }
  if (upper.includes("OUTR") || upper.includes("SERVIC") || upper.includes("SERVIÇ")) {
    return ResourceCategory.OTHER;
  }
  return ResourceCategory.MATERIAL;
}

/**
 * Prévia de arquivo CSV: detecta delimitador, extrai cabeçalhos e as primeiras N linhas.
 */
export function previewCsvContent(csvString: string, maxRows = 10) {
  // Remover BOM se presente
  const cleanCsv = csvString.replace(/^\uFEFF/, "");

  const parsed = Papa.parse<Record<string, string>>(cleanCsv, {
    header: true,
    skipEmptyLines: "greedy",
    preview: maxRows,
  });

  const headers = parsed.meta.fields || [];

  // Sugestão automática de mapeamento baseada em sinônimos comuns
  const mappingSuggestions: Partial<ColumnMapping> = {};

  for (const h of headers) {
    const norm = h.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    if (!mappingSuggestions.code && (norm.includes("CODIGO") || norm.includes("COD") || norm === "ID")) {
      mappingSuggestions.code = h;
    } else if (
      !mappingSuggestions.description &&
      (norm.includes("DESCRICAO") || norm.includes("DESC") || norm.includes("NOME") || norm.includes("ITEM"))
    ) {
      mappingSuggestions.description = h;
    } else if (!mappingSuggestions.unit && (norm.includes("UNIDADE") || norm === "UN" || norm === "UND")) {
      mappingSuggestions.unit = h;
    } else if (
      !mappingSuggestions.price &&
      (norm.includes("PRECO") || norm.includes("CUSTO") || norm.includes("VALOR") || norm.includes("MEDIANO"))
    ) {
      mappingSuggestions.price = h;
    } else if (!mappingSuggestions.category && (norm.includes("CATEGORIA") || norm.includes("TIPO_INSUMO") || norm.includes("GRUPO"))) {
      mappingSuggestions.category = h;
    }
  }

  return {
    headers,
    delimiter: parsed.meta.delimiter,
    previewRows: parsed.data,
    suggestedMapping: mappingSuggestions,
  };
}

/**
 * Pipeline de importação de Insumos com idempotência e resiliência a arquivos malformados.
 */
export async function importResourcesCsv(
  csvContent: string,
  mapping: ColumnMapping,
  context: ImportContext
): Promise<ImportReport> {
  const cleanCsv = csvContent.replace(/^\uFEFF/, "");
  const parsed = Papa.parse<Record<string, string>>(cleanCsv, {
    header: true,
    skipEmptyLines: "greedy",
  });

  const report: ImportReport = {
    totalRows: parsed.data.length,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  const rows = parsed.data;

  // Processamento linha a linha com isolamento de erros
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const lineNumber = i + 2; // +1 cabeçalho, +1 index base 1

    const rawCode = mapping.code ? row[mapping.code]?.trim() : "";
    const rawDesc = mapping.description ? row[mapping.description]?.trim() : "";
    const rawUnit = mapping.unit ? row[mapping.unit]?.trim() : "";
    const rawPrice = mapping.price ? row[mapping.price] : "";

    // Validação de colunas obrigatórias
    if (!rawCode) {
      report.errors.push({
        line: lineNumber,
        reason: "Código do insumo ausente ou vazio.",
        rawData: row,
      });
      report.skipped++;
      continue;
    }

    if (!rawDesc) {
      report.errors.push({
        line: lineNumber,
        code: rawCode,
        reason: "Descrição do insumo ausente.",
        rawData: row,
      });
      report.skipped++;
      continue;
    }

    const priceDecimal = parseBrazilianNumber(rawPrice);
    if (!priceDecimal || priceDecimal.isNegative()) {
      report.errors.push({
        line: lineNumber,
        code: rawCode,
        reason: `Preço inválido ou não numérico: '${rawPrice}'`,
        rawData: row,
      });
      report.skipped++;
      continue;
    }

    const category = mapping.category
      ? normalizeResourceCategory(row[mapping.category])
      : ResourceCategory.MATERIAL;

    const laborIncluded = mapping.laborChargesIncluded
      ? row[mapping.laborChargesIncluded]?.toLowerCase().includes("s") ||
        row[mapping.laborChargesIncluded]?.toLowerCase().includes("true") ||
        row[mapping.laborChargesIncluded] === "1"
      : false;

    const laborChargesRate = mapping.laborChargesRate
      ? parseBrazilianNumber(row[mapping.laborChargesRate])
      : null;

    try {
      // Idempotência por chave contextual composta:
      // [userId, code, source, sourceState, sourceMonth, sourceTaxRegime]
      const existing = await prisma.resource.findFirst({
        where: {
          userId: context.userId,
          code: rawCode,
          source: context.source,
          sourceState: context.state?.toUpperCase().trim() || null,
          sourceMonth: context.referenceMonth.trim(),
          sourceTaxRegime: context.taxRegime || null,
        },
      });

      if (existing) {
        const priceChanged = !existing.price.equals(priceDecimal);

        await prisma.resource.update({
          where: { id: existing.id },
          data: {
            description: rawDesc,
            unit: rawUnit || existing.unit,
            category,
            price: priceDecimal,
            priceDate: new Date(),
            laborChargesIncluded: laborIncluded,
            laborChargesRate: laborChargesRate ? laborChargesRate : existing.laborChargesRate,
            referenceDatabaseId: context.referenceDatabaseId ?? existing.referenceDatabaseId,
          },
        });

        if (priceChanged) {
          await prisma.resourcePriceHistory.create({
            data: {
              resourceId: existing.id,
              price: priceDecimal,
              source: `IMPORT_${context.source}`,
              reason: `Atualização via importação CSV (${context.referenceMonth})`,
              author: context.userId,
              effectiveDate: new Date(),
            },
          });
        }

        report.updated++;
      } else {
        const created = await prisma.resource.create({
          data: {
            userId: context.userId,
            referenceDatabaseId: context.referenceDatabaseId || null,
            code: rawCode,
            description: rawDesc,
            unit: rawUnit || "un",
            category,
            source: context.source,
            sourceState: context.state?.toUpperCase().trim() || null,
            sourceMonth: context.referenceMonth.trim(),
            sourceTaxRegime: context.taxRegime || null,
            price: priceDecimal,
            priceDate: new Date(),
            laborChargesIncluded: laborIncluded,
            laborChargesRate: laborChargesRate ? laborChargesRate : null,
          },
        });

        await prisma.resourcePriceHistory.create({
          data: {
            resourceId: created.id,
            price: priceDecimal,
            source: `IMPORT_${context.source}`,
            reason: `Carga inicial via importação CSV (${context.referenceMonth})`,
            author: context.userId,
            effectiveDate: new Date(),
          },
        });

        report.created++;
      }
    } catch (err) {
      report.errors.push({
        line: lineNumber,
        code: rawCode,
        reason: err instanceof Error ? err.message : "Erro desconhecido ao salvar insumo.",
        rawData: row,
      });
      report.skipped++;
    }
  }

  // Registrar auditoria da importação
  await createAuditEntry({
    userId: context.userId,
    entityType: "Resource",
    entityId: context.referenceDatabaseId || "BATCH_IMPORT",
    action: "IMPORT_CSV",
    metadata: {
      source: context.source,
      state: context.state,
      month: context.referenceMonth,
      taxRegime: context.taxRegime,
      report,
    },
  });

  return report;
}

/**
 * Pipeline de importação de Composições (Analíticas ou Fechadas) com idempotência.
 */
export async function importCompositionsCsv(
  csvContent: string,
  mapping: ColumnMapping,
  context: ImportContext
): Promise<ImportReport> {
  const cleanCsv = csvContent.replace(/^\uFEFF/, "");
  const parsed = Papa.parse<Record<string, string>>(cleanCsv, {
    header: true,
    skipEmptyLines: "greedy",
  });

  const report: ImportReport = {
    totalRows: parsed.data.length,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  const rows = parsed.data;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const lineNumber = i + 2;

    const rawCode = mapping.code ? row[mapping.code]?.trim() : "";
    const rawDesc = mapping.description ? row[mapping.description]?.trim() : "";
    const rawUnit = mapping.unit ? row[mapping.unit]?.trim() : "";

    if (!rawCode) {
      report.errors.push({
        line: lineNumber,
        reason: "Código da composição ausente ou vazio.",
        rawData: row,
      });
      report.skipped++;
      continue;
    }

    if (!rawDesc) {
      report.errors.push({
        line: lineNumber,
        code: rawCode,
        reason: "Descrição da composição ausente.",
        rawData: row,
      });
      report.skipped++;
      continue;
    }

    // Detecção de tipo: CLOSED vs ANALYTICAL
    let compType: CompositionType = CompositionType.CLOSED; // Padrão de tabelas sintetizadas de referência
    if (mapping.type && row[mapping.type]) {
      const typeStr = row[mapping.type].toUpperCase();
      if (typeStr.includes("ANALIT") || typeStr === "ANALYTICAL") {
        compType = CompositionType.ANALYTICAL;
      }
    }

    const closedTotal = mapping.closedTotalPrice || mapping.price
      ? parseBrazilianNumber(row[mapping.closedTotalPrice || mapping.price || ""])
      : null;

    const closedMaterial = mapping.closedMaterialPrice
      ? parseBrazilianNumber(row[mapping.closedMaterialPrice])
      : null;

    const closedLabor = mapping.closedLaborPrice
      ? parseBrazilianNumber(row[mapping.closedLaborPrice])
      : null;

    const closedEquipment = mapping.closedEquipmentPrice
      ? parseBrazilianNumber(row[mapping.closedEquipmentPrice])
      : null;

    try {
      const existing = await prisma.composition.findFirst({
        where: {
          userId: context.userId,
          code: rawCode,
          source: context.source,
          sourceState: context.state?.toUpperCase().trim() || null,
          sourceMonth: context.referenceMonth.trim(),
          sourceTaxRegime: context.taxRegime || null,
          version: 1,
        },
      });

      if (existing) {
        await prisma.composition.update({
          where: { id: existing.id },
          data: {
            description: rawDesc,
            unit: rawUnit || existing.unit,
            type: compType,
            closedTotalPrice: closedTotal ?? existing.closedTotalPrice,
            closedMaterialPrice: closedMaterial ?? existing.closedMaterialPrice,
            closedLaborPrice: closedLabor ?? existing.closedLaborPrice,
            closedEquipmentPrice: closedEquipment ?? existing.closedEquipmentPrice,
            referenceDatabaseId: context.referenceDatabaseId ?? existing.referenceDatabaseId,
          },
        });
        report.updated++;
      } else {
        await prisma.composition.create({
          data: {
            userId: context.userId,
            referenceDatabaseId: context.referenceDatabaseId || null,
            code: rawCode,
            description: rawDesc,
            unit: rawUnit || "un",
            source: context.source,
            sourceState: context.state?.toUpperCase().trim() || null,
            sourceMonth: context.referenceMonth.trim(),
            sourceTaxRegime: context.taxRegime || null,
            type: compType,
            closedTotalPrice: closedTotal,
            closedMaterialPrice: closedMaterial,
            closedLaborPrice: closedLabor,
            closedEquipmentPrice: closedEquipment,
            version: 1,
          },
        });
        report.created++;
      }
    } catch (err) {
      report.errors.push({
        line: lineNumber,
        code: rawCode,
        reason: err instanceof Error ? err.message : "Erro desconhecido ao salvar composição.",
        rawData: row,
      });
      report.skipped++;
    }
  }

  // Registrar auditoria
  await createAuditEntry({
    userId: context.userId,
    entityType: "Composition",
    entityId: context.referenceDatabaseId || "BATCH_IMPORT",
    action: "IMPORT_CSV",
    metadata: {
      source: context.source,
      state: context.state,
      month: context.referenceMonth,
      taxRegime: context.taxRegime,
      report,
    },
  });

  return report;
}
