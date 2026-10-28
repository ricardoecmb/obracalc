/**
 * Exportador PDF — ObraCalc
 *
 * Renderiza o modelo tabular canônico em PDF A4 paisagem, com cabeçalho
 * personalizável, tabelas e rodapé. Usa @react-pdf/renderer no servidor.
 */

import React from "react";
import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import {
  formatReportCell,
  type ReportRowKind,
  type ReportTableModel,
} from "@/lib/reports/report-tables";

const styles = StyleSheet.create({
  page: {
    size: "A4",
    orientation: "landscape",
    paddingTop: 26,
    paddingBottom: 30,
    paddingHorizontal: 22,
    fontFamily: "Helvetica",
    fontSize: 7,
    color: "#1e293b",
  },
  title: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: "#1e3a8a",
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#334155",
    marginBottom: 4,
  },
  metadata: {
    fontSize: 6.5,
    color: "#475569",
    marginBottom: 1.5,
  },
  sectionTitle: {
    marginTop: 8,
    marginBottom: 3,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#1e293b",
    backgroundColor: "#f1f5f9",
    padding: 3,
  },
  table: {
    width: "100%",
    borderWidth: 0.5,
    borderColor: "#cbd5e1",
  },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 0.4,
    borderBottomColor: "#e2e8f0",
    minHeight: 13,
  },
  th: {
    backgroundColor: "#1e40af",
    color: "#ffffff",
    fontFamily: "Helvetica-Bold",
    fontSize: 6.2,
    padding: 2.5,
    borderRightWidth: 0.4,
    borderRightColor: "#93c5fd",
  },
  td: {
    padding: 2.3,
    fontSize: 6.2,
    borderRightWidth: 0.4,
    borderRightColor: "#e2e8f0",
  },
  stage: {
    backgroundColor: "#e2e8f0",
    fontFamily: "Helvetica-Bold",
  },
  total: {
    backgroundColor: "#1e293b",
    color: "#ffffff",
    fontFamily: "Helvetica-Bold",
  },
  error: {
    backgroundColor: "#fee2e2",
  },
  warning: {
    backgroundColor: "#fef3c7",
  },
  info: {
    backgroundColor: "#d1fae5",
  },
  subtotal: {
    backgroundColor: "#f8fafc",
  },
  footer: {
    position: "absolute",
    bottom: 12,
    left: 22,
    right: 22,
    fontSize: 5.6,
    color: "#64748b",
    borderTopWidth: 0.4,
    borderTopColor: "#e2e8f0",
    paddingTop: 3,
  },
  pageNumber: {
    position: "absolute",
    bottom: 12,
    right: 22,
    fontSize: 5.6,
    color: "#64748b",
  },
});

function rowStyle(kind: ReportRowKind | undefined) {
  switch (kind) {
    case "stage":
      return styles.stage;
    case "total":
      return styles.total;
    case "error":
      return styles.error;
    case "warning":
      return styles.warning;
    case "info":
      return styles.info;
    case "subtotal":
      return styles.subtotal;
    default:
      return undefined;
  }
}

function buildDocument(model: ReportTableModel) {
  return (
    <Document
      title={model.title}
      author="ObraCalc"
      subject={model.subtitle}
      creator="ObraCalc"
      producer="ObraCalc"
    >
      <Page size="A4" orientation="landscape" style={styles.page} wrap>
        <Text style={styles.title}>{model.title}</Text>
        <Text style={styles.subtitle}>{model.subtitle}</Text>
        {model.metadataLines.map((metadata, index) => (
          <Text key={`meta-${index}`} style={styles.metadata}>
            {metadata}
          </Text>
        ))}

        {model.sections.map((section, sectionIndex) => (
          <View key={`section-${sectionIndex}`} wrap={false}>
            {section.title ? (
              <Text style={styles.sectionTitle}>{section.title}</Text>
            ) : null}

            <View style={styles.table}>
              <View style={styles.tr} fixed>
                {section.columns.map((column) => (
                  <Text
                    key={`h-${column.key}`}
                    style={[
                      styles.th,
                      {
                        flexGrow: column.width ?? 10,
                        textAlign: column.align ?? "left",
                      },
                    ]}
                  >
                    {column.header}
                  </Text>
                ))}
              </View>

              {section.rows.map((row, rowIndex) => (
                <View
                  key={`r-${sectionIndex}-${rowIndex}`}
                  style={[styles.tr, rowStyle(row.kind)]}
                  wrap={false}
                >
                  {section.columns.map((column) => (
                    <Text
                      key={`c-${column.key}`}
                      style={[
                        styles.td,
                        {
                          flexGrow: column.width ?? 10,
                          textAlign: column.align ?? "left",
                        },
                      ]}
                    >
                      {formatReportCell(row.cells[column.key] ?? null, column.format)}
                    </Text>
                  ))}
                </View>
              ))}
            </View>
          </View>
        ))}

        <Text style={styles.footer}>{model.footer}</Text>
        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) => `${pageNumber}/${totalPages}`}
          fixed
        />
      </Page>
    </Document>
  );
}

export async function exportReportPdf(model: ReportTableModel): Promise<Buffer> {
  return renderToBuffer(buildDocument(model));
}
