import { describe, expect, it } from "vitest";
import { exportReportCsv } from "@/lib/reports/csv-exporter";
import { exportReportPdf } from "@/lib/reports/pdf-exporter";
import { exportReportXlsx } from "@/lib/reports/xlsx-table-exporter";
import type { ReportTableModel } from "@/lib/reports/report-tables";

const model: ReportTableModel = {
  reportType: "synthetic",
  title: "ORÇAMENTO SINTÉTICO POR ETAPAS DA EAP",
  subtitle: "Obra de homologação — Etapa 12",
  metadataLines: [
    "Cliente: Construtora Homologação",
    "Revisão: 1",
    "Fonte: SNAPSHOT",
  ],
  footer: "Documento gerado para verificação de exportação.",
  generatedAt: "2026-10-28T12:00:00.000Z",
  source: "SNAPSHOT",
  sections: [
    {
      title: "Etapa 1 — Serviços preliminares",
      columns: [
        { key: "item", header: "Item", width: 12 },
        { key: "description", header: "Descrição", width: 60 },
        { key: "quantity", header: "Quantidade", format: "number" },
        { key: "unit", header: "Un.", width: 8 },
        { key: "total", header: "Total (R$)", format: "currency" },
      ],
      rows: [
        {
          kind: "item",
          cells: {
            item: "1.1",
            description: "Instalação de canteiro",
            quantity: "1,00",
            unit: "vb",
            total: "1.250,00",
          },
        },
      ],
    },
    {
      columns: [
        { key: "label", header: "Resumo" },
        { key: "value", header: "Valor (R$)", format: "currency" },
      ],
      rows: [
        {
          kind: "subtotal",
          cells: { label: "Custo direto", value: "1.250,00" },
        },
        { kind: "total", cells: { label: "TOTAL COM BDI", value: "1.562,50" } },
      ],
    },
  ],
  totals: {
    direct: "1250.00",
    withBdi: "1562.50",
    bdiAmount: "312.50",
    effectiveBdi: "25.0000",
  },
};

describe("Etapa 12 — verificação dos relatórios", () => {
  it("exporta CSV com BOM, separador brasileiro e totais reconciliados", () => {
    const buffer = exportReportCsv(model);
    expect(buffer[0]).toBe(0xef);
    expect(buffer[1]).toBe(0xbb);
    expect(buffer[2]).toBe(0xbf);

    const content = buffer.toString("utf8");
    expect(content).toContain(";");
    expect(content).toContain("\r\n");
    expect(content).toContain("TOTAL COM BDI");
    expect(content).toContain("1.562,50");
  });

  it("exporta XLSX válido", async () => {
    const buffer = await exportReportXlsx(model);
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
  });

  it("exporta PDF válido", async () => {
    const buffer = await exportReportPdf(model);
    expect(buffer.length).toBeGreaterThan(500);
    expect(buffer.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });
});
