/**
 * API Route — Geração e Download de Relatórios
 *
 * GET /api/reports?budgetId=<id>&revisionId=<id>
 *     &type=<analytical|synthetic|resources|abc|stage-summary|bdi|audit>
 *     &format=<xlsx|csv|pdf>
 *
 * Cabeçalhos personalizáveis (todos opcionais e sobrepostos aos dados do
 * ProfessionalProfile):
 *   company, cnpj, responsible, registrationType, registrationNumber,
 *   customTitle, footer, checksum=0|1
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { loadReportBundle } from "@/lib/reports/report-input";
import {
  buildReportTableModel,
  type ReportType,
} from "@/lib/reports/report-tables";
import { exportReportCsv } from "@/lib/reports/csv-exporter";
import { exportReportXlsx } from "@/lib/reports/xlsx-table-exporter";
import { exportReportPdf } from "@/lib/reports/pdf-exporter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const REPORT_TYPES: ReportType[] = [
  "analytical",
  "synthetic",
  "resources",
  "abc",
  "stage-summary",
  "bdi",
  "audit",
];

const FORMATS = ["xlsx", "csv", "pdf"] as const;
type ExportFormat = (typeof FORMATS)[number];

const FILE_LABELS: Record<ReportType, string> = {
  analytical: "Analitico",
  synthetic: "Sintetico",
  resources: "Insumos",
  abc: "CurvaABC",
  "stage-summary": "ResumoEtapas",
  bdi: "MemoriaBDI",
  audit: "Auditoria",
};

const CONTENT_TYPES: Record<ExportFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
  pdf: "application/pdf",
};

function headerValue(value: string | null): string | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function slug(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "orcamento"
  );
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const budgetId = searchParams.get("budgetId");
  const revisionId = searchParams.get("revisionId");
  const type = (searchParams.get("type") || "analytical") as ReportType;
  const format = (searchParams.get("format") || "xlsx") as ExportFormat;

  if (!budgetId || !revisionId) {
    return NextResponse.json(
      { error: "budgetId e revisionId são obrigatórios" },
      { status: 400 }
    );
  }

  if (!REPORT_TYPES.includes(type)) {
    return NextResponse.json(
      { error: `Tipo inválido. Use: ${REPORT_TYPES.join(", ")}` },
      { status: 400 }
    );
  }

  if (!FORMATS.includes(format)) {
    return NextResponse.json(
      { error: `Formato inválido. Use: ${FORMATS.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    const bundle = await loadReportBundle({
      userId: session.user.id,
      budgetId,
      revisionId,
    });

    const checksumParam = searchParams.get("checksum");
    const includeChecksum =
      checksumParam === null
        ? bundle.headerDefaults.includeChecksum !== false
        : !["0", "false", "nao", "não"].includes(checksumParam.toLowerCase());

    const model = buildReportTableModel({
      type,
      bundle,
      header: {
        companyName:
          headerValue(searchParams.get("company")) ?? bundle.headerDefaults.companyName,
        cnpj: headerValue(searchParams.get("cnpj")) ?? bundle.headerDefaults.cnpj,
        professionalName:
          headerValue(searchParams.get("responsible")) ??
          bundle.headerDefaults.professionalName,
        registrationType:
          headerValue(searchParams.get("registrationType")) ??
          bundle.headerDefaults.registrationType,
        registrationNumber:
          headerValue(searchParams.get("registrationNumber")) ??
          bundle.headerDefaults.registrationNumber,
        customTitle: headerValue(searchParams.get("customTitle")),
        footer: headerValue(searchParams.get("footer")),
        includeChecksum,
      },
    });

    let buffer: Buffer;
    switch (format) {
      case "csv":
        buffer = exportReportCsv(model);
        break;
      case "pdf":
        buffer = await exportReportPdf(model);
        break;
      default:
        buffer = await exportReportXlsx(model);
        break;
    }

    const baseName = `${FILE_LABELS[type]}_${slug(bundle.budgetTitle)}_Rev${bundle.revisionNumber}.${format}`;
    const utf8Name = encodeURIComponent(baseName);

    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": CONTENT_TYPES[format],
        "Content-Disposition": `attachment; filename="${baseName}"; filename*=UTF-8''${utf8Name}`,
        "Cache-Control": "no-store",
        "X-Report-Source": bundle.source,
        "X-Report-Reconciled": bundle.reconciliation.reconciled ? "true" : "false",
      },
    });
  } catch (error) {
    console.error("Erro ao gerar relatório:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erro interno ao gerar relatório",
      },
      { status: 500 }
    );
  }
}
