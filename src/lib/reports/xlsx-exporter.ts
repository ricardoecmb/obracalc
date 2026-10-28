/**
 * Exportador XLSX — ObraCalc
 * Gera arquivos Excel profissionais com formatação financeira,
 * cores por categoria e totais automáticos usando ExcelJS.
 */
"use server";

import ExcelJS from "exceljs";
import {
  AnalyticalReport,
  SyntheticReport,
  AbcReport,
  BdiMemoryReport,
  formatDecimalBRL,
  formatDecimalPct,
} from "@/lib/reports/report-engine";
import Decimal from "decimal.js";

// ============================================================================
// HELPERS DE ESTILO
// ============================================================================

const COLORS = {
  headerBlue: "FF1E40AF",
  headerTeal: "FF0F766E",
  headerAmber: "FFB45309",
  headerSlate: "FF334155",
  rowEven: "FFF8FAFC",
  rowOdd: "FFFFFFFF",
  subtotal: "FFE0E7FF",
  total: "FF1E293B",
  abcA: "FFD1FAE5",
  abcB: "FFFEF3C7",
  abcC: "FFFEE2E2",
  stageDepth0: "FFE2E8F0",
  stageDepth1: "FFF1F5F9",
  stageDepth2: "FFFAFAFA",
  success: "FF059669",
  danger: "FFDC2626",
};

const borderThin = {
  style: "thin" as const,
  color: { argb: "FFE2E8F0" },
};

const borders = {
  top: borderThin,
  bottom: borderThin,
  left: borderThin,
  right: borderThin,
};

function headerFont(color = "FFFFFFFF") {
  return { bold: true, color: { argb: color }, size: 9, name: "Calibri" };
}

function boldFont(color = "FF1E293B") {
  return { bold: true, color: { argb: color }, size: 9, name: "Calibri" };
}

function normalFont(color = "FF334155") {
  return { color: { argb: color }, size: 9, name: "Calibri" };
}

function fillSolid(argb: string) {
  return { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } };
}

function addMetadataHeader(ws: ExcelJS.Worksheet, report: { metadata: any }, title: string) {
  const meta = report.metadata;
  ws.addRow([title]);
  ws.lastRow!.eachCell((cell) => {
    cell.font = { bold: true, size: 13, color: { argb: "FF1E3A8A" }, name: "Calibri" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDBEAFE" } };
  });

  ws.addRow([`Obra: ${meta.projectName} | Cliente: ${meta.clientName ?? "—"}`]);
  ws.addRow([`Orçamento: ${meta.budgetTitle} — Rev. ${meta.revisionNumber} | Base: ${meta.referenceState ?? "BR"} • ${meta.referenceMonth ?? "Geral"}`]);
  ws.addRow([`Resp. Técnico: ${meta.technicalResponsible ?? "—"} | Regime: ${meta.referenceTaxRegime ?? "—"} | Arredondamento: ${meta.roundingMode}`]);
  if (meta.snapshotChecksum) {
    const finalRow = ws.addRow([`🔒 SHA-256: ${meta.snapshotChecksum}`]);
    finalRow.eachCell((cell) => {
      cell.font = { bold: true, size: 8, color: { argb: "FF065F46" }, name: "Calibri" };
    });
  }
  ws.addRow([]);
}

// ============================================================================
// 1. EXPORTAÇÃO — RELATÓRIO ANALÍTICO
// ============================================================================

export async function exportAnalyticalXlsx(report: AnalyticalReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ObraCalc";
  wb.created = new Date();

  const ws = wb.addWorksheet("Orçamento Analítico", {
    pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1 },
  });

  // Larguras das colunas
  ws.columns = [
    { width: 8 },   // Código
    { width: 55 },  // Descrição
    { width: 6 },   // Unidade
    { width: 10 },  // Quantidade
    { width: 13 },  // PU Material
    { width: 13 },  // PU M.O.
    { width: 13 },  // PU Equip.
    { width: 13 },  // PU Outros
    { width: 13 },  // PU Total
    { width: 13 },  // Subtotal Direto
    { width: 8 },   // BDI %
    { width: 13 },  // Total c/ BDI
    { width: 7 },   // % na Etapa
    { width: 7 },   // % no Orçamento
  ];

  addMetadataHeader(ws, report, "ORÇAMENTO ANALÍTICO DE CUSTOS UNITÁRIOS");

  // Cabeçalho da tabela
  const hRow = ws.addRow([
    "Código", "Descrição do Serviço", "Und.", "Quant.",
    "PU Mat. (R$)", "PU M.O. (R$)", "PU Equip. (R$)", "PU Outros (R$)", "PU Total (R$)",
    "Subtotal Direto", "BDI %", "Total c/ BDI",
    "% Etapa", "% Orça.",
  ]);
  hRow.eachCell((cell) => {
    cell.font = headerFont();
    cell.fill = fillSolid(COLORS.headerBlue);
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = borders;
  });
  hRow.height = 28;

  // Renderização recursiva das etapas
  let rowIdx = 0;

  const renderStage = (stage: any, depth: number) => {
    // Linha da Etapa
    const stRow = ws.addRow([
      stage.code,
      `${"  ".repeat(depth)}${stage.title}`,
      "", "", "", "", "", "", "",
      stage.subtotalDirect.toNumber(),
      stage.bdiEffective.toFixed(2) + "%",
      stage.subtotalWithBdi.toNumber(),
      "", `${stage.weightInBudget.toFixed(1)}%`,
    ]);

    const stageBg =
      depth === 0 ? COLORS.stageDepth0 : depth === 1 ? COLORS.stageDepth1 : COLORS.stageDepth2;

    stRow.eachCell((cell, colNum) => {
      cell.font = boldFont(depth === 0 ? "FF1E293B" : "FF334155");
      cell.fill = fillSolid(stageBg);
      cell.border = borders;
      if (colNum >= 10 && colNum !== 11) {
        cell.numFmt = '"R$"#,##0.00';
        cell.alignment = { horizontal: "right" };
      }
      if (colNum === 11) {
        cell.alignment = { horizontal: "center" };
      }
    });
    stRow.height = 18;

    // Itens diretos da etapa
    stage.items.forEach((it: any, iIdx: number) => {
      rowIdx++;
      const bg = rowIdx % 2 === 0 ? COLORS.rowEven : COLORS.rowOdd;
      const iRow = ws.addRow([
        it.compositionCode,
        `${"     ".repeat(depth + 1)}${it.compositionDescription}${it.bdiConfigName ? " *" : ""}`,
        it.unit,
        it.quantity.toNumber(),
        it.unitCostMaterial.toNumber(),
        it.unitCostLabor.toNumber(),
        it.unitCostEquipment.toNumber(),
        it.unitCostOther.toNumber(),
        it.unitCostTotal.toNumber(),
        it.subtotal.toNumber(),
        it.bdiRate.toFixed(2) + "%",
        it.subtotalWithBdi.toNumber(),
        `${it.weightInStage.toFixed(1)}%`,
        `${it.weightInBudget.toFixed(1)}%`,
      ]);

      iRow.eachCell((cell, colNum) => {
        cell.font = normalFont();
        cell.fill = fillSolid(bg);
        cell.border = borders;
        if ([4].includes(colNum)) {
          cell.numFmt = "#,##0.0000";
          cell.alignment = { horizontal: "right" };
        }
        if ([5, 6, 7, 8, 9, 10, 12].includes(colNum)) {
          cell.numFmt = '"R$"#,##0.0000';
          cell.alignment = { horizontal: "right" };
        }
        if (colNum === 11) {
          cell.alignment = { horizontal: "center" };
        }
        if ([13, 14].includes(colNum)) {
          cell.alignment = { horizontal: "center" };
        }
      });
      iRow.height = 14;
    });

    // Subetapas filhas
    stage.childStages?.forEach((child: any) => renderStage(child, depth + 1));
  };

  report.rootStages.forEach((root) => renderStage(root, 0));

  // Linha de Total Geral
  const totRow = ws.addRow([
    "", "TOTAL GERAL DO ORÇAMENTO", "", "", "", "", "", "", "",
    report.totals.direct.toNumber(),
    report.totals.effectiveBdi.toFixed(2) + "%",
    report.totals.withBdi.toNumber(),
    "", "100%",
  ]);
  totRow.eachCell((cell, colNum) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10, name: "Calibri" };
    cell.fill = fillSolid(COLORS.total);
    cell.border = borders;
    if ([10, 12].includes(colNum)) {
      cell.numFmt = '"R$"#,##0.00';
      cell.alignment = { horizontal: "right" };
    }
  });
  totRow.height = 20;

  // Totais por Categoria
  ws.addRow([]);
  const catHdr = ws.addRow(["", "DECOMPOSIÇÃO POR CATEGORIA DE CUSTO DIRETO", "", "", "Material", "Mão de Obra", "Equipamento", "Outros", "TOTAL"]);
  catHdr.eachCell((cell) => {
    cell.font = headerFont("FF1E293B");
    cell.fill = fillSolid(COLORS.stageDepth0);
    cell.border = borders;
    if ([5, 6, 7, 8, 9].includes(catHdr.getCell(1).col as unknown as number)) {
      cell.numFmt = '"R$"#,##0.00';
    }
  });

  ws.addRow([
    "", "Custo Direto Total",
    "", "",
    report.totals.material.toNumber(),
    report.totals.labor.toNumber(),
    report.totals.equipment.toNumber(),
    report.totals.other.toNumber(),
    report.totals.direct.toNumber(),
  ]).eachCell((cell, col) => {
    cell.font = boldFont();
    if (col >= 5) {
      cell.numFmt = '"R$"#,##0.00';
      cell.alignment = { horizontal: "right" };
    }
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ============================================================================
// 2. EXPORTAÇÃO — RELATÓRIO SINTÉTICO
// ============================================================================

export async function exportSyntheticXlsx(report: SyntheticReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ObraCalc";
  wb.created = new Date();

  const ws = wb.addWorksheet("Orçamento Sintético");
  ws.columns = [
    { width: 8 }, { width: 50 }, { width: 15 }, { width: 10 }, { width: 15 }, { width: 10 },
  ];

  addMetadataHeader(ws, report, "ORÇAMENTO SINTÉTICO POR ETAPAS DA EAP");

  const hRow = ws.addRow(["Código", "Etapa / Macroserviço", "Custo Direto (R$)", "BDI Médio (%)", "Total c/ BDI (R$)", "% no Orçamento"]);
  hRow.eachCell((cell) => {
    cell.font = headerFont();
    cell.fill = fillSolid(COLORS.headerTeal);
    cell.alignment = { horizontal: "center", wrapText: true };
    cell.border = borders;
  });
  hRow.height = 24;

  report.stages.forEach((st, idx) => {
    const bg = idx % 2 === 0 ? COLORS.rowEven : COLORS.rowOdd;
    const row = ws.addRow([
      st.code,
      st.title,
      st.subtotalDirect.toNumber(),
      st.bdiEffective.toFixed(2) + "%",
      st.subtotalWithBdi.toNumber(),
      st.weightInBudget.toFixed(2) + "%",
    ]);
    row.eachCell((cell, col) => {
      cell.font = normalFont();
      cell.fill = fillSolid(bg);
      cell.border = borders;
      if (col === 3 || col === 5) {
        cell.numFmt = '"R$"#,##0.00';
        cell.alignment = { horizontal: "right" };
      }
      if (col === 4 || col === 6) {
        cell.alignment = { horizontal: "center" };
      }
    });
    row.height = 16;
  });

  // Total
  const totRow = ws.addRow([
    "", "TOTAL", report.totals.direct.toNumber(),
    report.totals.effectiveBdi.toFixed(2) + "%",
    report.totals.withBdi.toNumber(), "100%",
  ]);
  totRow.eachCell((cell, col) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10, name: "Calibri" };
    cell.fill = fillSolid(COLORS.total);
    cell.border = borders;
    if (col === 3 || col === 5) {
      cell.numFmt = '"R$"#,##0.00';
      cell.alignment = { horizontal: "right" };
    }
    if (col === 4 || col === 6) {
      cell.alignment = { horizontal: "center" };
    }
  });
  totRow.height = 20;

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ============================================================================
// 3. EXPORTAÇÃO — CURVA ABC
// ============================================================================

export async function exportAbcXlsx(report: AbcReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ObraCalc";
  wb.created = new Date();

  const ws = wb.addWorksheet("Curva ABC");
  ws.columns = [
    { width: 6 }, { width: 8 }, { width: 50 }, { width: 6 }, { width: 12 },
    { width: 13 }, { width: 8 }, { width: 13 }, { width: 13 }, { width: 10 }, { width: 10 }, { width: 5 },
  ];

  addMetadataHeader(ws, report, "CURVA ABC — ANÁLISE DE PARETO (80/20)");

  const hRow = ws.addRow([
    "Rank", "Código", "Descrição do Serviço", "Und.", "Quantidade",
    "PU Total (R$)", "BDI %", "Total c/ BDI (R$)",
    "Acumulado (R$)", "% Indiv.", "% Acum.", "Classe",
  ]);
  hRow.eachCell((cell) => {
    cell.font = headerFont();
    cell.fill = fillSolid(COLORS.headerAmber);
    cell.alignment = { horizontal: "center", wrapText: true };
    cell.border = borders;
  });
  hRow.height = 28;

  report.items.forEach((it) => {
    const classBg = it.abcClass === "A" ? COLORS.abcA : it.abcClass === "B" ? COLORS.abcB : COLORS.abcC;
    const row = ws.addRow([
      it.rank,
      it.compositionCode,
      it.compositionDescription,
      it.unit,
      it.quantity.toNumber(),
      it.unitCostTotal.toNumber(),
      it.bdiRate.toFixed(2) + "%",
      it.subtotalWithBdi.toNumber(),
      it.cumulativeWithBdi.toNumber(),
      it.percentageIndividual.toFixed(2) + "%",
      it.percentageCumulative.toFixed(2) + "%",
      it.abcClass,
    ]);

    row.eachCell((cell, col) => {
      cell.font = normalFont();
      cell.fill = col === 12 ? fillSolid(classBg) : fillSolid(col % 2 === 0 ? COLORS.rowEven : COLORS.rowOdd);
      cell.border = borders;
      if ([6, 8, 9].includes(col)) {
        cell.numFmt = '"R$"#,##0.00';
        cell.alignment = { horizontal: "right" };
      }
      if ([5].includes(col)) {
        cell.numFmt = "#,##0.0000";
        cell.alignment = { horizontal: "right" };
      }
      if ([10, 11].includes(col)) {
        cell.alignment = { horizontal: "center" };
      }
      if (col === 12) {
        cell.font = { bold: true, color: { argb: "FF1E293B" }, size: 9, name: "Calibri" };
        cell.alignment = { horizontal: "center" };
      }
    });
    row.height = 14;
  });

  // Resumo ABC
  ws.addRow([]);
  const summaryHdr = ws.addRow(["RESUMO", "Classe", "Qtd. Itens", "% Itens", "Total (R$)"]);
  summaryHdr.eachCell((cell) => {
    cell.font = boldFont();
    cell.fill = fillSolid(COLORS.stageDepth0);
    cell.border = borders;
  });

  const total = report.totals.withBdi;
  [
    ["A", report.totals.countA, report.totals.percentA, COLORS.abcA],
    ["B", report.totals.countB, report.totals.percentB, COLORS.abcB],
    ["C", report.totals.countC, report.totals.percentC, COLORS.abcC],
  ].forEach(([cls, cnt, pct, bg]) => {
    const items = report.items.filter((i) => i.abcClass === cls);
    const totalCls = items.reduce((acc, i) => acc.plus(i.subtotalWithBdi), new Decimal(0));
    const sRow = ws.addRow(["", String(cls), Number(cnt), `${(pct as Decimal).toFixed(1)}%`, totalCls.toNumber()]);
    sRow.eachCell((cell, col) => {
      cell.fill = fillSolid(bg as string);
      cell.font = { bold: true, size: 9, name: "Calibri" };
      cell.border = borders;
      if (col === 5) {
        cell.numFmt = '"R$"#,##0.00';
        cell.alignment = { horizontal: "right" };
      }
    });
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ============================================================================
// 4. EXPORTAÇÃO — MEMÓRIA DE BDI
// ============================================================================

export async function exportBdiMemoryXlsx(report: BdiMemoryReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ObraCalc";
  wb.created = new Date();

  const ws = wb.addWorksheet("Memória BDI");
  ws.columns = [
    { width: 8 }, { width: 8 }, { width: 45 }, { width: 14 }, { width: 14 },
  ];

  addMetadataHeader(ws, report, "MEMÓRIA DE CÁLCULO DO BDI — ACÓRDÃO TCU 2622/2013");

  // Fórmula
  ws.addRow(["FÓRMULA:", report.formula]);
  ws.lastRow!.getCell(1).font = boldFont();
  ws.lastRow!.getCell(2).font = { italic: true, size: 10, name: "Courier New", color: { argb: "FF1E3A8A" } };
  ws.addRow([]);

  // Numerador
  const numHdr = ws.addRow(["", "Símbolo", "Componente (Numerador)", "Valor Decimal", "Percentual (%)"]);
  numHdr.eachCell((cell) => {
    cell.font = headerFont();
    cell.fill = fillSolid(COLORS.headerBlue);
    cell.border = borders;
  });

  const numItems = [
    report.numerator.ac, report.numerator.s, report.numerator.g,
    report.numerator.cf, report.numerator.mi,
  ];
  numItems.forEach((line, idx) => {
    const bg = idx % 2 === 0 ? COLORS.rowEven : COLORS.rowOdd;
    const r = ws.addRow(["", line.symbol, line.label, line.value.toNumber(), line.percentFormatted]);
    r.eachCell((cell, col) => {
      cell.font = normalFont();
      cell.fill = fillSolid(bg);
      cell.border = borders;
      if (col === 4) { cell.numFmt = "0.00000"; cell.alignment = { horizontal: "right" }; }
      if (col === 5) { cell.alignment = { horizontal: "center" }; }
    });
  });

  const numSubRow = ws.addRow(["", "∑", "Numerador = (1 + ΣAC+S+G+CF+MI)",
    report.numerator.numeratorSubtotal.toNumber(), ""]);
  numSubRow.eachCell((cell) => {
    cell.font = boldFont();
    cell.fill = fillSolid(COLORS.subtotal);
    cell.border = borders;
  });

  ws.addRow([]);

  // Denominador
  const denHdr = ws.addRow(["", "Símbolo", "Componente (Denominador)", "Valor Decimal", "Percentual (%)"]);
  denHdr.eachCell((cell) => {
    cell.font = headerFont();
    cell.fill = fillSolid(COLORS.headerTeal);
    cell.border = borders;
  });

  const denItems = [report.denominator.tm, report.denominator.te, report.denominator.tf, report.denominator.l];
  denItems.forEach((line, idx) => {
    const bg = idx % 2 === 0 ? COLORS.rowEven : COLORS.rowOdd;
    const r = ws.addRow(["", line.symbol, line.label, line.value.toNumber(), line.percentFormatted]);
    r.eachCell((cell, col) => {
      cell.font = normalFont();
      cell.fill = fillSolid(bg);
      cell.border = borders;
      if (col === 4) { cell.numFmt = "0.00000"; cell.alignment = { horizontal: "right" }; }
      if (col === 5) { cell.alignment = { horizontal: "center" }; }
    });
  });

  const denSubRow = ws.addRow(["", "∑", "Denominador = (1 - ISS-TE-TF-L)",
    report.denominator.denominatorSubtotal.toNumber(), ""]);
  denSubRow.eachCell((cell) => {
    cell.font = boldFont();
    cell.fill = fillSolid(COLORS.subtotal);
    cell.border = borders;
  });

  ws.addRow([]);

  // Resultado
  const resultHdr = ws.addRow(["", "", "RESULTADO DO BDI CALCULADO", "Valor (%)", "Verificação"]);
  resultHdr.eachCell((cell) => {
    cell.font = headerFont("FF1E293B");
    cell.fill = fillSolid(COLORS.stageDepth0);
    cell.border = borders;
  });

  const calcRow = ws.addRow(["", "BDI", "BDI Calculado (Acórdão TCU)",
    report.calculatedBdiRate.toFixed(4) + "%", ""]);
  calcRow.eachCell((cell) => {
    cell.font = boldFont("FF1E3A8A");
    cell.fill = fillSolid(COLORS.rowEven);
    cell.border = borders;
  });

  const storedRow = ws.addRow(["", "BDI", "BDI Armazenado na Configuração",
    report.storedBdiRate.toFixed(4) + "%", ""]);
  storedRow.eachCell((cell) => {
    cell.font = normalFont();
    cell.fill = fillSolid(COLORS.rowOdd);
    cell.border = borders;
  });

  const discRow = ws.addRow(["", "Δ", "Discrepância |Calculado − Armazenado|",
    report.discrepancy.toFixed(4) + "%",
    report.isConsistent ? "✓ Consistente" : "⚠ Verificar"]);
  discRow.eachCell((cell, col) => {
    const isOk = report.isConsistent;
    cell.font = { bold: true, color: { argb: isOk ? "FF059669" : "FFDC2626" }, size: 9, name: "Calibri" };
    cell.fill = fillSolid(isOk ? COLORS.abcA : COLORS.abcC);
    cell.border = borders;
    if (col === 5) { cell.alignment = { horizontal: "center" }; }
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
