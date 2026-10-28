/**
 * Exportador XLSX genérico — ObraCalc
 *
 * Consome o modelo tabular canônico e aplica formatação financeira. Como CSV e
 * PDF usam o mesmo modelo, as colunas e os totais permanecem reconciliados.
 */

import ExcelJS from "exceljs";
import {
  formatReportCell,
  type ReportCellValue,
  type ReportColumn,
  type ReportTableModel,
} from "@/lib/reports/report-tables";

const COLORS = {
  header: {
    analytical: "FF1E40AF",
    synthetic: "FF0F766E",
    resources: "FF7C2D12",
    abc: "FFB45309",
    "stage-summary": "FF4338CA",
    bdi: "FF6D28D9",
    audit: "FF334155",
  },
  rowEven: "FFF8FAFC",
  rowOdd: "FFFFFFFF",
  stage: "FFE2E8F0",
  total: "FF1E293B",
  error: "FFFEE2E2",
  warning: "FFFEF3C7",
  info: "FFD1FAE5",
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

function fillSolid(argb: string) {
  return { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } };
}

function numericValue(value: ReportCellValue, format?: ReportColumn["format"]): number | string {
  if (value === null || value === undefined || value === "") return "";
  if (format === "currency" || format === "number" || format === "integer" || format === "percent") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return format === "percent" ? numeric / 100 : numeric;
    }
  }
  return String(value);
}

function applyNumFmt(cell: ExcelJS.Cell, column: ReportColumn) {
  switch (column.format) {
    case "currency":
      cell.numFmt = '"R$"#,##0.00';
      break;
    case "number":
      cell.numFmt = "#,##0.0000";
      break;
    case "integer":
      cell.numFmt = "#,##0";
      break;
    case "percent":
      cell.numFmt = "0.00%";
      break;
    default:
      break;
  }
}

export async function exportReportXlsx(model: ReportTableModel): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ObraCalc";
  workbook.created = new Date(model.generatedAt);
  workbook.lastModifiedBy = "ObraCalc";

  const sheetName = model.title
    .replace(/[\\/*?:[\]]/g, "")
    .slice(0, 31) || "Relatório";
  const worksheet = workbook.addWorksheet(sheetName, {
    pageSetup: {
      orientation: "landscape",
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
    views: [{ state: "frozen", ySplit: 1 }],
  });

  const maxColumns = model.sections.reduce(
    (max, section) => Math.max(max, section.columns.length),
    1
  );

  const widths: number[] = new Array(maxColumns).fill(12);
  model.sections.forEach((section) => {
    section.columns.forEach((column, index) => {
      widths[index] = Math.max(widths[index] ?? 12, column.width ?? 12);
    });
  });
  worksheet.columns = widths.map((width) => ({ width }));

  const pushMergedRow = (text: string, font: Partial<ExcelJS.Font>, fill?: string) => {
    const row = worksheet.addRow([text]);
    worksheet.mergeCells(row.number, 1, row.number, maxColumns);
    const cell = row.getCell(1);
    cell.font = font;
    cell.alignment = { vertical: "middle", wrapText: true };
    if (fill) cell.fill = fillSolid(fill);
    return row;
  };

  // Cabeçalho do relatório
  pushMergedRow(model.title, {
    bold: true,
    size: 14,
    color: { argb: "FF1E3A8A" },
    name: "Calibri",
  }, "FFDBEAFE");
  pushMergedRow(model.subtitle, {
    bold: true,
    size: 10,
    color: { argb: "FF334155" },
    name: "Calibri",
  });

  model.metadataLines.forEach((metadata) => {
    pushMergedRow(metadata, {
      size: 9,
      color: { argb: "FF475569" },
      name: "Calibri",
    });
  });

  worksheet.addRow([]);

  let rowCounter = 0;

  model.sections.forEach((section, sectionIndex) => {
    if (sectionIndex > 0) worksheet.addRow([]);

    if (section.title) {
      pushMergedRow(section.title, {
        bold: true,
        size: 10,
        color: { argb: "FF1E293B" },
        name: "Calibri",
      }, "FFF1F5F9");
    }

    const header = worksheet.addRow(
      section.columns.map((column) => column.header)
    );
    header.height = 28;
    header.eachCell((cell, index) => {
      cell.font = { bold: true, size: 9, color: { argb: "FFFFFFFF" }, name: "Calibri" };
      cell.fill = fillSolid(COLORS.header[model.reportType]);
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = borders;
      const column = section.columns[index - 1];
      if (column) applyNumFmt(cell, column);
    });

    section.rows.forEach((row) => {
      rowCounter += 1;
      const values = section.columns.map((column) =>
        numericValue(row.cells[column.key] ?? null, column.format)
      );
      const excelRow = worksheet.addRow(values);

      const kind = row.kind ?? "normal";
      let fill = rowCounter % 2 === 0 ? COLORS.rowEven : COLORS.rowOdd;
      if (kind === "stage") fill = COLORS.stage;
      if (kind === "total") fill = COLORS.total;
      if (kind === "error") fill = COLORS.error;
      if (kind === "warning") fill = COLORS.warning;
      if (kind === "info") fill = COLORS.info;

      excelRow.eachCell((cell, index) => {
        const column = section.columns[index - 1];
        cell.border = borders;
        cell.fill = fillSolid(fill);
        cell.font =
          kind === "total"
            ? { bold: true, size: 9, color: { argb: "FFFFFFFF" }, name: "Calibri" }
            : kind === "stage"
              ? { bold: true, size: 9, color: { argb: "FF1E293B" }, name: "Calibri" }
              : { size: 9, color: { argb: "FF334155" }, name: "Calibri" };

        if (column) {
          applyNumFmt(cell, column);
          if (column.align) {
            cell.alignment = {
              horizontal: column.align,
              vertical: "middle",
              wrapText: column.key === "description" || column.key === "message",
            };
          }
        }
      });
    });
  });

  worksheet.addRow([]);
  pushMergedRow(model.footer, {
    italic: true,
    size: 8,
    color: { argb: "FF64748B" },
    name: "Calibri",
  });

  worksheet.autoFilter = undefined;

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

/** Compatibilidade: exporta qualquer célula já formatada (usado em testes). */
export function formatXlsxCell(
  value: ReportCellValue,
  column: ReportColumn
): string {
  return formatReportCell(value, column.format);
}
