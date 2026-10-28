/**
 * Modelos tabulares canônicos — ObraCalc
 *
 * Um único modelo alimenta XLSX, CSV e PDF. Assim, cabeçalhos, colunas e
 * totais permanecem reconciliados entre os três formatos.
 */

import Decimal from "decimal.js";
import type { ReportBundle, ReportHeaderOptions } from "@/lib/reports/report-input";
import {
  computeStageTotals,
  formatDecimalBRL,
  generateAbcReport,
  generateAnalyticalReport,
  generateAuditReport,
  generateBdiMemoryReport,
  generateResourcesReport,
  generateStageSummaryReport,
  generateSyntheticReport,
  type AnalyticalStage,
  type ReportStage,
} from "@/lib/reports/report-engine";

export type ReportType =
  | "analytical"
  | "synthetic"
  | "resources"
  | "abc"
  | "stage-summary"
  | "bdi"
  | "audit";

export type ReportCellValue = string | number | null;

export type ReportCellFormat =
  | "text"
  | "integer"
  | "number"
  | "currency"
  | "percent";

export type ReportRowKind =
  | "normal"
  | "stage"
  | "item"
  | "subtotal"
  | "total"
  | "error"
  | "warning"
  | "info";

export interface ReportColumn {
  key: string;
  header: string;
  width?: number;
  align?: "left" | "center" | "right";
  format?: ReportCellFormat;
}

export interface ReportRow {
  kind?: ReportRowKind;
  cells: Record<string, ReportCellValue>;
}

export interface ReportSection {
  title?: string;
  columns: ReportColumn[];
  rows: ReportRow[];
}

export interface ReportTableModel {
  reportType: ReportType;
  title: string;
  subtitle: string;
  metadataLines: string[];
  footer: string;
  generatedAt: string;
  source: "SNAPSHOT" | "DATABASE";
  sections: ReportSection[];
  totals: {
    direct: string;
    withBdi: string;
    bdiAmount: string;
    effectiveBdi: string;
  };
}

export const REPORT_TITLES: Record<ReportType, string> = {
  analytical: "ORÇAMENTO ANALÍTICO DE CUSTOS UNITÁRIOS",
  synthetic: "ORÇAMENTO SINTÉTICO POR ETAPAS DA EAP",
  resources: "RELATÓRIO DE INSUMOS E CONSUMOS",
  abc: "CURVA ABC — ANÁLISE DE PARETO",
  "stage-summary": "RESUMO DE ETAPAS DA EAP",
  bdi: "MEMÓRIA DE CÁLCULO DO BDI — ACÓRDÃO TCU 2622/2013",
  audit: "RELATÓRIO DE AUDITORIA DO ORÇAMENTO",
};

function D(value: string | number | Decimal | null | undefined): Decimal {
  if (value instanceof Decimal) return value;
  return new Decimal(value ?? 0);
}

export function formatDecimalValue(
  value: string | number | Decimal | null | undefined,
  decimals = 2
): string {
  if (value === null || value === undefined || value === "") return "";
  try {
    const fixed = D(value).toFixed(decimals);
    const negative = fixed.startsWith("-");
    const unsigned = negative ? fixed.slice(1) : fixed;
    const [integer, fraction] = unsigned.split(".");
    const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    const body = fraction ? `${grouped},${fraction}` : grouped;
    return `${negative ? "-" : ""}${body}`;
  } catch {
    return String(value);
  }
}

export function formatReportCell(
  value: ReportCellValue,
  format: ReportCellFormat = "text"
): string {
  if (value === null || value === undefined) return "";
  switch (format) {
    case "currency":
      return `R$ ${formatDecimalValue(value, 2)}`;
    case "percent":
      return `${formatDecimalValue(value, 2)}%`;
    case "integer":
      return formatDecimalValue(value, 0);
    case "number":
      return formatDecimalValue(value, 4);
    default:
      return String(value);
  }
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pt-BR");
}

function indent(depth: number): string {
  return "  ".repeat(Math.max(depth, 0));
}

function buildMetadataLines(
  bundle: ReportBundle,
  header: ReportHeaderOptions
): string[] {
  const meta = bundle.input.metadata;
  const lines: string[] = [];

  if (header.companyName) {
    lines.push(
      `Empresa: ${header.companyName}${header.cnpj ? ` — CNPJ ${header.cnpj}` : ""}`
    );
  }

  const registration = [header.registrationType, header.registrationNumber]
    .filter(Boolean)
    .join(" ");
  if (header.professionalName) {
    lines.push(
      `Responsável Técnico: ${header.professionalName}${registration ? ` — ${registration}` : ""}`
    );
  }

  lines.push(`Obra: ${meta.projectName} | Cliente: ${meta.clientName ?? "—"}`);
  lines.push(
    `Orçamento: ${meta.budgetTitle} — Revisão ${meta.revisionNumber} | Base: ${formatDate(meta.baseDate)}`
  );
  lines.push(
    `Referência: ${meta.referenceState ?? "BR"} • ${meta.referenceMonth ?? "Geral"} | Regime: ${meta.referenceTaxRegime ?? "—"}`
  );

  if (meta.bdiConfig) {
    lines.push(
      `BDI: ${meta.bdiConfig.name} — ${formatDecimalValue(meta.bdiConfig.bdiRate, 4)}%`
    );
  }

  lines.push(
    `Arredondamento: ${meta.roundingMode} (${meta.roundingTotalDecimals} casas nos totais)`
  );

  if (bundle.source === "SNAPSHOT") {
    lines.push(
      `Fonte dos dados: snapshot imutável da revisão finalizada${bundle.checksum && header.includeChecksum !== false ? ` | SHA-256: ${bundle.checksum}` : ""}`
    );
  } else {
    lines.push("Fonte dos dados: rascunho atual do orçamento");
  }

  lines.push(
    `Reconciliação: ${bundle.reconciliation.reconciled ? "OK" : "DIVERGENTE"} | Δ custo direto: R$ ${formatDecimalValue(bundle.reconciliation.directDifference, 2)} | Δ total: R$ ${formatDecimalValue(bundle.reconciliation.withBdiDifference, 2)}`
  );

  return lines;
}

function analyticalRows(stages: AnalyticalStage[]): ReportRow[] {
  const rows: ReportRow[] = [];

  const visit = (stage: AnalyticalStage, depth: number) => {
    rows.push({
      kind: "stage",
      cells: {
        code: stage.code,
        description: `${indent(depth)}${stage.title}`,
        unit: "",
        quantity: "",
        material: stage.subtotalMaterial.toFixed(2),
        labor: stage.subtotalLabor.toFixed(2),
        equipment: stage.subtotalEquipment.toFixed(2),
        other: stage.subtotalOther.toFixed(2),
        unitTotal: "",
        subtotal: stage.subtotalDirect.toFixed(2),
        bdi: stage.bdiEffective.toFixed(2),
        total: stage.subtotalWithBdi.toFixed(2),
        weight: stage.weightInBudget.toFixed(2),
        bdiConfig: "",
      },
    });

    stage.items.forEach((item) => {
      rows.push({
        kind: "item",
        cells: {
          code: item.compositionCode,
          description: `${indent(depth + 1)}${item.compositionDescription}`,
          unit: item.unit,
          quantity: item.quantity.toString(),
          material: item.unitCostMaterial.toFixed(4),
          labor: item.unitCostLabor.toFixed(4),
          equipment: item.unitCostEquipment.toFixed(4),
          other: item.unitCostOther.toFixed(4),
          unitTotal: item.unitCostTotal.toFixed(4),
          subtotal: item.subtotal.toFixed(2),
          bdi: item.bdiRate.toFixed(2),
          total: item.subtotalWithBdi.toFixed(2),
          weight: item.weightInBudget.toFixed(2),
          bdiConfig: item.bdiConfigName ?? "",
        },
      });
    });

    stage.childStages.forEach((child) => visit(child, depth + 1));
  };

  stages.forEach((stage) => visit(stage, 0));
  return rows;
}

function totalRow(cells: Record<string, ReportCellValue>): ReportRow {
  return { kind: "total", cells };
}

export function buildReportTableModel(params: {
  type: ReportType;
  bundle: ReportBundle;
  header?: ReportHeaderOptions;
  generatedAt?: string;
}): ReportTableModel {
  const header = params.header ?? {};
  const bundle = params.bundle;
  const meta = bundle.input.metadata;
  const stageTotals = computeStageTotals(bundle.input.stages);
  const title = header.customTitle?.trim() || REPORT_TITLES[params.type];

  const metadataLines = buildMetadataLines(bundle, header);
  const subtitle = `${meta.budgetTitle} — Revisão ${meta.revisionNumber} — ${meta.projectName}`;

  let sections: ReportSection[] = [];

  switch (params.type) {
    case "analytical": {
      const report = generateAnalyticalReport(bundle.input);
      sections = [
        {
          columns: [
            { key: "code", header: "Código", width: 10 },
            { key: "description", header: "Descrição do Serviço", width: 48 },
            { key: "unit", header: "Und.", width: 7, align: "center" },
            { key: "quantity", header: "Quant.", width: 10, align: "right", format: "number" },
            { key: "material", header: "PU Mat. (R$)", width: 12, align: "right", format: "currency" },
            { key: "labor", header: "PU M.O. (R$)", width: 12, align: "right", format: "currency" },
            { key: "equipment", header: "PU Equip. (R$)", width: 12, align: "right", format: "currency" },
            { key: "other", header: "PU Outros (R$)", width: 12, align: "right", format: "currency" },
            { key: "unitTotal", header: "PU Total (R$)", width: 12, align: "right", format: "currency" },
            { key: "subtotal", header: "Subtotal Direto (R$)", width: 14, align: "right", format: "currency" },
            { key: "bdi", header: "BDI %", width: 8, align: "right", format: "percent" },
            { key: "total", header: "Total c/ BDI (R$)", width: 14, align: "right", format: "currency" },
            { key: "weight", header: "% Orça.", width: 8, align: "right", format: "percent" },
            { key: "bdiConfig", header: "BDI específico", width: 16 },
          ],
          rows: [
            ...analyticalRows(report.rootStages),
            totalRow({
              description: "TOTAL GERAL DO ORÇAMENTO",
              subtotal: report.totals.direct.toFixed(2),
              bdi: report.totals.effectiveBdi.toFixed(2),
              total: report.totals.withBdi.toFixed(2),
              weight: "100.00",
            }),
          ],
        },
        {
          title: "DECOMPOSIÇÃO POR CATEGORIA DE CUSTO DIRETO",
          columns: [
            { key: "category", header: "Categoria", width: 28 },
            { key: "value", header: "Valor (R$)", width: 18, align: "right", format: "currency" },
            { key: "weight", header: "% do Custo Direto", width: 16, align: "right", format: "percent" },
          ],
          rows: [
            {
              cells: {
                category: "Material",
                value: report.totals.material.toFixed(2),
                weight: report.totals.direct.gt(0)
                  ? report.totals.material.dividedBy(report.totals.direct).times(100).toFixed(2)
                  : "0.00",
              },
            },
            {
              cells: {
                category: "Mão de Obra",
                value: report.totals.labor.toFixed(2),
                weight: report.totals.direct.gt(0)
                  ? report.totals.labor.dividedBy(report.totals.direct).times(100).toFixed(2)
                  : "0.00",
              },
            },
            {
              cells: {
                category: "Equipamento",
                value: report.totals.equipment.toFixed(2),
                weight: report.totals.direct.gt(0)
                  ? report.totals.equipment.dividedBy(report.totals.direct).times(100).toFixed(2)
                  : "0.00",
              },
            },
            {
              cells: {
                category: "Outros",
                value: report.totals.other.toFixed(2),
                weight: report.totals.direct.gt(0)
                  ? report.totals.other.dividedBy(report.totals.direct).times(100).toFixed(2)
                  : "0.00",
              },
            },
            totalRow({
              category: "Custo Direto Total",
              value: report.totals.direct.toFixed(2),
              weight: "100.00",
            }),
          ],
        },
      ];
      break;
    }

    case "synthetic": {
      const report = generateSyntheticReport(bundle.input);
      sections = [
        {
          columns: [
            { key: "code", header: "Código", width: 10 },
            { key: "title", header: "Etapa / Macroserviço", width: 56 },
            { key: "direct", header: "Custo Direto (R$)", width: 16, align: "right", format: "currency" },
            { key: "bdi", header: "BDI Médio (%)", width: 12, align: "right", format: "percent" },
            { key: "total", header: "Total c/ BDI (R$)", width: 16, align: "right", format: "currency" },
            { key: "weight", header: "% no Orçamento", width: 14, align: "right", format: "percent" },
          ],
          rows: [
            ...report.stages.map((stage) => ({
              cells: {
                code: stage.code,
                title: stage.title,
                direct: stage.subtotalDirect.toFixed(2),
                bdi: stage.bdiEffective.toFixed(2),
                total: stage.subtotalWithBdi.toFixed(2),
                weight: stage.weightInBudget.toFixed(2),
              },
            })),
            totalRow({
              title: "TOTAL",
              direct: report.totals.direct.toFixed(2),
              bdi: report.totals.effectiveBdi.toFixed(2),
              total: report.totals.withBdi.toFixed(2),
              weight: "100.00",
            }),
          ],
        },
      ];
      break;
    }

    case "resources": {
      const report = generateResourcesReport(bundle.input);
      sections = [
        {
          columns: [
            { key: "code", header: "Código", width: 14 },
            { key: "description", header: "Descrição do Insumo", width: 52 },
            { key: "unit", header: "Und.", width: 7, align: "center" },
            { key: "category", header: "Categoria", width: 12, align: "center" },
            { key: "quantity", header: "Quantidade", width: 14, align: "right", format: "number" },
            { key: "price", header: "Preço Médio Ponderado (R$)", width: 18, align: "right", format: "currency" },
            { key: "total", header: "Total (R$)", width: 16, align: "right", format: "currency" },
            { key: "weight", header: "% Custo Direto", width: 13, align: "right", format: "percent" },
            { key: "origin", header: "Origem", width: 18 },
          ],
          rows: [
            ...report.lines.map((line) => ({
              kind: line.synthetic ? ("subtotal" as const) : undefined,
              cells: {
                code: line.code,
                description: line.description,
                unit: line.unit,
                category: line.category,
                quantity: line.quantity.toString(),
                price: line.weightedPrice.toFixed(4),
                total: line.total.toFixed(2),
                weight: line.percentage.toFixed(2),
                origin: line.synthetic
                  ? "Composição fechada"
                  : line.compositionCode ?? "",
              },
            })),
            totalRow({
              description: "TOTAL DO CUSTO DIRETO",
              total: report.totals.direct.toFixed(2),
              weight: "100.00",
            }),
          ],
        },
        {
          title: "RESUMO POR CATEGORIA DE INSUMO",
          columns: [
            { key: "category", header: "Categoria", width: 28 },
            { key: "total", header: "Total (R$)", width: 18, align: "right", format: "currency" },
            { key: "weight", header: "% do Custo Direto", width: 16, align: "right", format: "percent" },
          ],
          rows: [
            ...report.categories.map((category) => ({
              cells: {
                category: category.category,
                total: category.total.toFixed(2),
                weight: category.percentage.toFixed(2),
              },
            })),
            totalRow({
              category: "Custo Direto Total",
              total: report.totals.direct.toFixed(2),
              weight: "100.00",
            }),
          ],
        },
      ];
      break;
    }

    case "abc": {
      const report = generateAbcReport(bundle.input);
      sections = [
        {
          columns: [
            { key: "rank", header: "Rank", width: 7, align: "center", format: "integer" },
            { key: "code", header: "Código", width: 12 },
            { key: "description", header: "Descrição do Serviço", width: 50 },
            { key: "unit", header: "Und.", width: 7, align: "center" },
            { key: "quantity", header: "Quantidade", width: 12, align: "right", format: "number" },
            { key: "price", header: "PU Total (R$)", width: 14, align: "right", format: "currency" },
            { key: "bdi", header: "BDI %", width: 8, align: "right", format: "percent" },
            { key: "total", header: "Total c/ BDI (R$)", width: 15, align: "right", format: "currency" },
            { key: "cumulative", header: "Acumulado (R$)", width: 15, align: "right", format: "currency" },
            { key: "individual", header: "% Indiv.", width: 9, align: "right", format: "percent" },
            { key: "cumulativePct", header: "% Acum.", width: 9, align: "right", format: "percent" },
            { key: "class", header: "Classe", width: 8, align: "center" },
          ],
          rows: [
            ...report.items.map((item) => ({
              cells: {
                rank: item.rank,
                code: item.compositionCode,
                description: item.compositionDescription,
                unit: item.unit,
                quantity: item.quantity.toString(),
                price: item.unitCostTotal.toFixed(4),
                bdi: item.bdiRate.toFixed(2),
                total: item.subtotalWithBdi.toFixed(2),
                cumulative: item.cumulativeWithBdi.toFixed(2),
                individual: item.percentageIndividual.toFixed(2),
                cumulativePct: item.percentageCumulative.toFixed(2),
                class: item.abcClass,
              },
            })),
            totalRow({
              description: "TOTAL",
              total: report.totals.withBdi.toFixed(2),
              cumulative: report.totals.withBdi.toFixed(2),
              cumulativePct: "100.00",
            }),
          ],
        },
        {
          title: "RESUMO POR CLASSE ABC",
          columns: [
            { key: "class", header: "Classe", width: 12, align: "center" },
            { key: "count", header: "Qtd. Itens", width: 12, align: "right", format: "integer" },
            { key: "percent", header: "% Itens", width: 12, align: "right", format: "percent" },
            { key: "total", header: "Total (R$)", width: 16, align: "right", format: "currency" },
          ],
          rows: (
            [
              ["A", report.totals.countA, report.totals.percentA],
              ["B", report.totals.countB, report.totals.percentB],
              ["C", report.totals.countC, report.totals.percentC],
            ] as Array<[string, number, Decimal]>
          ).map(([cls, count, percent]) => {
            const classTotal = report.items
              .filter((item) => item.abcClass === cls)
              .reduce((acc, item) => acc.plus(item.subtotalWithBdi), new Decimal(0));
            return {
              cells: {
                class: cls,
                count,
                percent: percent.toFixed(2),
                total: classTotal.toFixed(2),
              },
            };
          }),
        },
      ];
      break;
    }

    case "stage-summary": {
      const report = generateStageSummaryReport(bundle.input);
      sections = [
        {
          columns: [
            { key: "code", header: "Código", width: 10 },
            { key: "title", header: "Etapa da EAP", width: 52 },
            { key: "level", header: "Nível", width: 8, align: "center", format: "integer" },
            { key: "parent", header: "Etapa Pai", width: 12 },
            { key: "direct", header: "Custo Direto (R$)", width: 16, align: "right", format: "currency" },
            { key: "bdi", header: "BDI Efetivo (%)", width: 12, align: "right", format: "percent" },
            { key: "total", header: "Total c/ BDI (R$)", width: 16, align: "right", format: "currency" },
            { key: "weight", header: "% no Orçamento", width: 14, align: "right", format: "percent" },
            { key: "items", header: "Itens", width: 9, align: "right", format: "integer" },
          ],
          rows: [
            ...report.rows.map((row) => ({
              kind: row.level === 0 ? ("stage" as const) : ("item" as const),
              cells: {
                code: row.code,
                title: `${indent(row.level)}${row.title}`,
                level: row.level,
                parent: row.parentCode ?? "—",
                direct: row.direct.toFixed(2),
                bdi: row.bdiEffective.toFixed(2),
                total: row.withBdi.toFixed(2),
                weight: row.percentage.toFixed(2),
                items: row.itemsCount,
              },
            })),
            totalRow({
              title: "TOTAL GERAL",
              direct: report.totals.direct.toFixed(2),
              bdi: report.totals.effectiveBdi.toFixed(2),
              total: report.totals.withBdi.toFixed(2),
              weight: "100.00",
              items: report.totals.itemsCount,
            }),
          ],
        },
      ];
      break;
    }

    case "bdi": {
      const report = generateBdiMemoryReport(bundle.input);
      sections = [
        {
          title: "FÓRMULA CANÔNICA",
          columns: [{ key: "formula", header: "Equação", width: 120 }],
          rows: [{ cells: { formula: report.formula } }],
        },
        {
          title: "NUMERADOR",
          columns: [
            { key: "symbol", header: "Símbolo", width: 10, align: "center" },
            { key: "label", header: "Componente", width: 46 },
            { key: "value", header: "Valor Decimal", width: 16, align: "right", format: "number" },
            { key: "percent", header: "Percentual", width: 14, align: "right" },
          ],
          rows: [
            ...[
              report.numerator.ac,
              report.numerator.s,
              report.numerator.g,
              report.numerator.cf,
              report.numerator.mi,
            ].map((line) => ({
              cells: {
                symbol: line.symbol,
                label: line.label,
                value: line.value.toString(),
                percent: line.percentFormatted,
              },
            })),
            totalRow({
              symbol: "∑",
              label: "Numerador = (1 + AC + S + G + CF + MI)",
              value: report.numerator.numeratorSubtotal.toString(),
              percent: "",
            }),
          ],
        },
        {
          title: "DENOMINADOR",
          columns: [
            { key: "symbol", header: "Símbolo", width: 10, align: "center" },
            { key: "label", header: "Componente", width: 46 },
            { key: "value", header: "Valor Decimal", width: 16, align: "right", format: "number" },
            { key: "percent", header: "Percentual", width: 14, align: "right" },
          ],
          rows: [
            ...[
              report.denominator.tm,
              report.denominator.te,
              report.denominator.tf,
              report.denominator.l,
            ].map((line) => ({
              cells: {
                symbol: line.symbol,
                label: line.label,
                value: line.value.toString(),
                percent: line.percentFormatted,
              },
            })),
            totalRow({
              symbol: "∑",
              label: "Denominador = (1 - ISS - TE - TF - L)",
              value: report.denominator.denominatorSubtotal.toString(),
              percent: "",
            }),
          ],
        },
        {
          title: "RESULTADO E VERIFICAÇÃO",
          columns: [
            { key: "label", header: "Descrição", width: 46 },
            { key: "value", header: "Valor", width: 18, align: "right" },
            { key: "check", header: "Verificação", width: 24, align: "center" },
          ],
          rows: [
            {
              cells: {
                label: "BDI Calculado (Acórdão TCU)",
                value: `${report.calculatedBdiRate.toFixed(4)}%`,
                check: "",
              },
            },
            {
              cells: {
                label: "BDI Armazenado na Configuração",
                value: `${report.storedBdiRate.toFixed(4)}%`,
                check: "",
              },
            },
            {
              kind: report.isConsistent ? "info" : "error",
              cells: {
                label: "Discrepância |Calculado − Armazenado|",
                value: `${report.discrepancy.toFixed(4)}%`,
                check: report.isConsistent ? "Consistente" : "Verificar",
              },
            },
          ],
        },
      ];
      break;
    }

    case "audit": {
      const report = generateAuditReport(bundle.input);
      sections = [
        {
          title: "RESUMO DA AUDITORIA",
          columns: [
            { key: "label", header: "Indicador", width: 34 },
            { key: "value", header: "Valor", width: 18, align: "right" },
          ],
          rows: [
            { cells: { label: "Erros críticos", value: String(report.summary.errors) } },
            { cells: { label: "Alertas", value: String(report.summary.warnings) } },
            { cells: { label: "Informações", value: String(report.summary.infos) } },
            {
              kind: report.summary.blocking ? "error" : "info",
              cells: {
                label: "Situação",
                value: report.summary.blocking ? "BLOQUEANTE" : "SEM BLOQUEIO",
              },
            },
          ],
        },
        {
          title: "ACHADOS POR TIPO",
          columns: [
            { key: "type", header: "Tipo", width: 32 },
            { key: "count", header: "Quantidade", width: 14, align: "right", format: "integer" },
          ],
          rows: report.byType.map((entry) => ({
            cells: { type: entry.type, count: entry.count },
          })),
        },
        {
          title: "ACHADOS DETALHADOS",
          columns: [
            { key: "severity", header: "Severidade", width: 12, align: "center" },
            { key: "code", header: "Código", width: 20 },
            { key: "type", header: "Tipo", width: 22 },
            { key: "message", header: "Mensagem", width: 60 },
            { key: "entity", header: "Entidade", width: 16 },
            { key: "field", header: "Campo", width: 22 },
            { key: "justification", header: "Justificativa", width: 28 },
          ],
          rows: report.findings.map((finding) => ({
            kind:
              finding.severity === "ERROR"
                ? ("error" as const)
                : finding.severity === "WARNING"
                  ? ("warning" as const)
                  : ("info" as const),
            cells: {
              severity: finding.severity,
              code: finding.code,
              type: finding.type,
              message: finding.message,
              entity: finding.entityType ?? "—",
              field: finding.field ?? "—",
              justification: finding.justification ?? "",
            },
          })),
        },
        {
          title: "TOTAIS DO ORÇAMENTO AUDITADO",
          columns: [
            { key: "label", header: "Indicador", width: 34 },
            { key: "value", header: "Valor (R$)", width: 18, align: "right", format: "currency" },
          ],
          rows: [
            { cells: { label: "Custo Direto", value: report.totals.direct.toFixed(2) } },
            { cells: { label: "Total com BDI", value: report.totals.withBdi.toFixed(2) } },
            { cells: { label: "Itens auditados", value: String(report.totals.itemsCount) } },
          ],
        },
      ];
      break;
    }
  }

  const generatedAt = params.generatedAt ?? new Date().toISOString();
  const footer =
    header.footer?.trim() ||
    `Gerado por ObraCalc em ${new Date(generatedAt).toLocaleString("pt-BR")} | ` +
      `Fonte: ${bundle.source === "SNAPSHOT" ? "snapshot imutável" : "rascunho"} | ` +
      `Totais conferidos: ${bundle.reconciliation.reconciled ? "sim" : "não"}`;

  // O total do modelo é sempre o total da fonte selecionada. Nos insumos, a
  // reconciliação garante que a soma das linhas seja idêntica ao custo direto.
  const totalsForModel = stageTotals;

  return {
    reportType: params.type,
    title,
    subtitle,
    metadataLines,
    footer,
    generatedAt,
    source: bundle.source,
    sections,
    totals: {
      direct: totalsForModel.direct.toFixed(2),
      withBdi: totalsForModel.withBdi.toFixed(2),
      bdiAmount: totalsForModel.bdiAmount.toFixed(2),
      effectiveBdi: totalsForModel.effectiveBdi.toFixed(2),
    },
  };
}

/** Cabeçalho textual usado no CSV e no PDF. */
export function reportHeaderText(model: ReportTableModel): string {
  return [model.title, model.subtitle, ...model.metadataLines].join("\n");
}

/** Formata um total para exibição em qualquer exportador. */
export function formatReportTotal(value: string): string {
  return formatDecimalBRL(new Decimal(value));
}

/** Lista de etapas de um bundle, útil para seletores e testes. */
export function flattenStages(stages: ReportStage[]): ReportStage[] {
  const result: ReportStage[] = [];
  const byParent = new Map<string | null, ReportStage[]>();
  stages.forEach((stage) => {
    const parent = stage.parentStageId ?? null;
    const list = byParent.get(parent) ?? [];
    list.push(stage);
    byParent.set(parent, list);
  });
  byParent.forEach((list) => list.sort((a, b) => a.sortOrder - b.sortOrder));

  const visit = (stage: ReportStage) => {
    result.push(stage);
    (byParent.get(stage.id) ?? []).forEach(visit);
  };
  (byParent.get(null) ?? []).forEach(visit);

  stages.forEach((stage) => {
    if (!result.includes(stage)) result.push(stage);
  });

  return result;
}
