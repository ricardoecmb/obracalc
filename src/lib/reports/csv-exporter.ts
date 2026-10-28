/**
 * Exportador CSV — ObraCalc
 *
 * Codificação UTF-8 com BOM, separador ponto e vírgula e quebras CRLF para
 * compatibilidade com Excel pt-BR. O conteúdo deriva do modelo tabular
 * canônico, garantindo as mesmas colunas e totais do XLSX/PDF.
 */

import {
  formatReportCell,
  type ReportTableModel,
} from "@/lib/reports/report-tables";

const BOM = "\uFEFF";
const DELIMITER = ";";
const CRLF = "\r\n";

function escapeCsv(value: string): string {
  if (value.includes('"')) {
    value = value.replace(/"/g, '""');
  }
  if (
    value.includes(DELIMITER) ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value}"`;
  }
  return value;
}

function line(values: string[]): string {
  return values.map(escapeCsv).join(DELIMITER);
}

export function exportReportCsv(model: ReportTableModel): Buffer {
  const output: string[] = [];

  output.push(line([model.title]));
  output.push(line([model.subtitle]));
  model.metadataLines.forEach((metadata) => output.push(line([metadata])));
  output.push("");

  model.sections.forEach((section) => {
    if (section.title) {
      output.push(line([section.title]));
    }
    output.push(line(section.columns.map((column) => column.header)));

    section.rows.forEach((row) => {
      output.push(
        line(
          section.columns.map((column) =>
            formatReportCell(row.cells[column.key] ?? null, column.format)
          )
        )
      );
    });

    output.push("");
  });

  output.push(line([model.footer]));

  return Buffer.from(BOM + output.join(CRLF) + CRLF, "utf8");
}
