import { describe, it, expect, beforeEach, vi } from "vitest";
import Decimal from "decimal.js";
import { prisma } from "@/lib/db/prisma";
import { expandCompositionResources } from "@/lib/reports/resource-expansion";
import {
  generateResourcesReport,
  generateStageSummaryReport,
  reconcileReportTotals,
  type ReportStage,
} from "@/lib/reports/report-engine";
import {
  buildReportTableModel,
  REPORT_TITLES,
  type ReportType,
} from "@/lib/reports/report-tables";
import { exportReportCsv } from "@/lib/reports/csv-exporter";
import { exportReportXlsx } from "@/lib/reports/xlsx-table-exporter";
import { loadReportBundle, type ReportBundle } from "@/lib/reports/report-input";
import { createBudget, addBudgetItem, finalizeRevision } from "../budgets";
import type { CompositionInput } from "@/lib/engine/types";

let testUserId: string;
let sequence = 0;

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth-utils", () => ({
  getCurrentUser: vi.fn(async () => ({
    id: testUserId,
    email: "test.etapa10@obracalc.com",
    name: "Engenheiro Etapa 10",
    role: "ADMIN",
  })),
}));

const ALL_TYPES: ReportType[] = [
  "analytical",
  "synthetic",
  "resources",
  "abc",
  "stage-summary",
  "bdi",
  "audit",
];

// ============================================================================
// FIXTURES PUROS
// ============================================================================

function resource(
  id: string,
  code: string,
  unit: string,
  price: string,
  category: "MATERIAL" | "LABOR" | "EQUIPMENT" | "OTHER" = "MATERIAL"
) {
  return {
    id,
    code,
    description: `Insumo ${code}`,
    unit,
    category,
    price,
    laborChargesIncluded: false,
  };
}

function buildReportStages(): ReportStage[] {
  return [
    {
      id: "stage-1",
      code: "1",
      title: "Serviços Preliminares",
      parentStageId: null,
      sortOrder: 1,
      items: [
        {
          id: "item-1",
          compositionCode: "COMP-1",
          compositionDescription: "Alvenaria",
          unit: "m²",
          compositionType: "ANALYTICAL",
          quantity: "10",
          unitCostMaterial: "6",
          unitCostLabor: "4",
          unitCostEquipment: "0",
          unitCostOther: "0",
          unitCostTotal: "10",
          subtotal: "100",
          bdiRate: "25",
          subtotalWithBdi: "125",
          notes: null,
          bdiConfigName: null,
        },
      ],
    },
    {
      id: "stage-1-1",
      code: "1.1",
      title: "Subetapa",
      parentStageId: "stage-1",
      sortOrder: 2,
      items: [
        {
          id: "item-2",
          compositionCode: "COMP-2",
          compositionDescription: "Pintura",
          unit: "m²",
          compositionType: "ANALYTICAL",
          quantity: "5",
          unitCostMaterial: "20",
          unitCostLabor: "0",
          unitCostEquipment: "0",
          unitCostOther: "0",
          unitCostTotal: "20",
          subtotal: "100",
          bdiRate: "25",
          subtotalWithBdi: "125",
          notes: null,
          bdiConfigName: null,
        },
      ],
    },
  ];
}

function buildBundle(overrides: Partial<ReportBundle> = {}): ReportBundle {
  const stages = overrides.input?.stages ?? buildReportStages();
  const computed = reconcileReportTotals({
    source: "DATABASE",
    stages,
    expected: { direct: "200", withBdi: "250" },
  });

  return {
    input: {
      metadata: {
        budgetTitle: "Orçamento Teste",
        revisionNumber: 1,
        projectName: "Obra Teste",
        clientName: "Cliente Teste",
        technicalResponsible: "Eng. Teste",
        baseDate: new Date("2026-01-15T00:00:00.000Z").toISOString(),
        referenceState: "SP",
        referenceMonth: "2026/01",
        referenceTaxRegime: "SIMPLES",
        bdiConfig: {
          name: "BDI 25%",
          bdiRate: "25",
          ac: "4",
          cf: "1",
          s: "0.5",
          g: "0.5",
          mi: "1",
          tm: "2.5",
          te: "0",
          tf: "3.65",
          l: "8",
        },
        roundingMode: "ROUND_HALF_UP",
        roundingTotalDecimals: 2,
        snapshotChecksum: null,
        finalizedAt: null,
      },
      stages,
      resources: [
        {
          code: "MAT-1",
          description: "Bloco cerâmico",
          unit: "un",
          category: "MATERIAL",
          coefficient: "2",
          price: "10",
          quantity: "50",
          total: "500",
        },
      ],
      auditFindings: [],
      expectedTotals: { direct: "200", withBdi: "250" },
      ...overrides.input,
    },
    source: overrides.source ?? "DATABASE",
    reconciliation: overrides.reconciliation ?? computed,
    headerDefaults: overrides.headerDefaults ?? {
      companyName: "ObraCalc Engenharia",
      cnpj: "00.000.000/0001-00",
      professionalName: "Eng. Teste",
      registrationType: "CREA",
      registrationNumber: "123456",
      includeChecksum: true,
    },
    checksum: overrides.checksum ?? null,
    budgetTitle: overrides.budgetTitle ?? "Orçamento Teste",
    revisionNumber: overrides.revisionNumber ?? 1,
  };
}

// ============================================================================
// EXPANSÃO DE INSUMOS
// ============================================================================

describe("Etapa 10 — Expansão de composições em insumos", () => {
  it("multiplica coeficientes em subcomposições aninhadas", () => {
    const material = resource("mat-1", "MAT-1", "un", "10");
    const labor = resource("lab-1", "LAB-1", "h", "30", "LABOR");

    const child: CompositionInput = {
      id: "child",
      code: "COMP-CHILD",
      description: "Subcomposição",
      unit: "m²",
      type: "ANALYTICAL",
      components: [
        { resourceId: "lab-1", coefficient: "3", resource: labor },
      ],
    };

    const root: CompositionInput = {
      id: "root",
      code: "COMP-ROOT",
      description: "Composição raiz",
      unit: "m²",
      type: "ANALYTICAL",
      components: [
        { resourceId: "mat-1", coefficient: "2", resource: material },
        {
          childCompositionId: "child",
          coefficient: "0.5",
          childComposition: child,
        },
      ],
    };

    const catalog = new Map<string, CompositionInput>([
      ["root", root],
      ["child", child],
    ]);

    const expanded = expandCompositionResources("root", catalog);
    const matLine = expanded.find((line) => line.code === "MAT-1");
    const labLine = expanded.find((line) => line.code === "LAB-1");

    expect(matLine?.coefficient).toBe("2");
    expect(labLine?.coefficient).toBe("1.5");
    expect(expanded.every((line) => line.synthetic === false)).toBe(true);
  });

  it("preserva composição fechada como linha sintética sem decompor", () => {
    const closed: CompositionInput = {
      id: "closed",
      code: "COMP-CLOSED",
      description: "Serviço fechado",
      unit: "m²",
      type: "CLOSED",
      components: [],
      closedTotalPrice: "80",
      closedMaterialPrice: "50",
      closedLaborPrice: "30",
    };

    const catalog = new Map<string, CompositionInput>([["closed", closed]]);
    const expanded = expandCompositionResources("closed", catalog);

    expect(expanded).toHaveLength(2);
    expect(expanded.every((line) => line.synthetic)).toBe(true);
    const total = expanded.reduce(
      (acc, line) => acc.plus(new Decimal(line.price)),
      new Decimal(0)
    );
    expect(total.toString()).toBe("80");
  });
});

// ============================================================================
// MOTOR DE RELATÓRIOS
// ============================================================================

describe("Etapa 10 — Relatório de insumos e resumo de etapas", () => {
  it("reconcilia a soma dos insumos com o custo direto e gera ajuste explícito", () => {
    const stages = buildReportStages();
    // Insumos somam 190, mas o custo direto é 200 -> ajuste de 10.
    const report = generateResourcesReport({
      metadata: buildBundle().input.metadata,
      stages,
      resources: [
        {
          code: "MAT-1",
          description: "Bloco",
          unit: "un",
          category: "MATERIAL",
          coefficient: "1",
          price: "10",
          quantity: "19",
          total: "190",
        },
      ],
    });

    expect(report.totals.direct.toString()).toBe("200");
    expect(report.totals.resourcesRawTotal.toString()).toBe("190");
    expect(report.totals.adjustment.toString()).toBe("10");
    const adjustmentLine = report.lines.find((line) => line.code === "AJUSTE");
    expect(adjustmentLine).toBeDefined();
    const linesTotal = report.lines.reduce(
      (acc, line) => acc.plus(line.total),
      new Decimal(0)
    );
    expect(linesTotal.toString()).toBe("200");
  });

  it("agrega etapas hierárquicas sem duplicar pai e filho", () => {
    const report = generateStageSummaryReport({
      metadata: buildBundle().input.metadata,
      stages: buildReportStages(),
    });

    expect(report.rows).toHaveLength(2);
    const parent = report.rows.find((row) => row.code === "1")!;
    const child = report.rows.find((row) => row.code === "1.1")!;

    // O pai acumula o próprio item (100) + filho (100) = 200.
    expect(parent.direct.toString()).toBe("200");
    expect(parent.itemsCount).toBe(2);
    expect(child.direct.toString()).toBe("100");
    expect(parent.level).toBe(0);
    expect(child.level).toBe(1);
    expect(report.totals.direct.toString()).toBe("200");
  });

  it("sinaliza divergência quando os totais da fonte não coincidem", () => {
    const computed = reconcileReportTotals({
      source: "SNAPSHOT",
      stages: buildReportStages(),
      expected: { direct: "100", withBdi: "125" },
    });

    expect(computed.reconciled).toBe(false);
    expect(computed.directDifference.toString()).toBe("100");
  });
});

// ============================================================================
// MODELO TABULAR CANÔNICO E EXPORTADORES
// ============================================================================

describe("Etapa 10 — Modelo tabular canônico e exportadores", () => {
  it("gera os sete relatórios com títulos e totais reconciliados", () => {
    const bundle = buildBundle();

    for (const type of ALL_TYPES) {
      const model = buildReportTableModel({ type, bundle });
      expect(model.title).toBe(REPORT_TITLES[type]);
      expect(model.sections.length).toBeGreaterThan(0);
      expect(model.sections.every((section) => section.columns.length > 0)).toBe(
        true
      );
      expect(model.totals.direct).toBe("200.00");
      expect(model.totals.withBdi).toBe("250.00");
    }
  });

  it("expõe as mesmas colunas para CSV, XLSX e PDF (modelo único)", () => {
    const bundle = buildBundle();
    const analytical = buildReportTableModel({ type: "analytical", bundle });
    const synthetic = buildReportTableModel({ type: "synthetic", bundle });

    const analyticalKeys = analytical.sections[0].columns.map((c) => c.key);
    expect(analyticalKeys).toEqual([
      "code",
      "description",
      "unit",
      "quantity",
      "material",
      "labor",
      "equipment",
      "other",
      "unitTotal",
      "subtotal",
      "bdi",
      "total",
      "weight",
      "bdiConfig",
    ]);
    expect(synthetic.sections[0].columns.map((c) => c.key)).toEqual([
      "code",
      "title",
      "direct",
      "bdi",
      "total",
      "weight",
    ]);
  });

  it("aplica cabeçalho personalizado e checksum quando solicitado", () => {
    const bundle = buildBundle({
      source: "SNAPSHOT",
      checksum: "abc123checksum",
    });

    const model = buildReportTableModel({
      type: "synthetic",
      bundle,
      header: {
        companyName: "Empresa Custom",
        cnpj: "11.222.333/0001-44",
        professionalName: "Eng. Custom",
        registrationType: "CAU",
        registrationNumber: "999",
        customTitle: "Título Personalizado",
        footer: "Rodapé personalizado",
        includeChecksum: true,
      },
    });

    expect(model.title).toBe("Título Personalizado");
    expect(model.footer).toBe("Rodapé personalizado");
    const joined = model.metadataLines.join("\n");
    expect(joined).toContain("Empresa Custom");
    expect(joined).toContain("11.222.333/0001-44");
    expect(joined).toContain("Eng. Custom");
    expect(joined).toContain("CAU 999");
    expect(joined).toContain("abc123checksum");
  });

  it("exporta CSV em UTF-8 com BOM, ponto e vírgula e CRLF", () => {
    const model = buildReportTableModel({
      type: "synthetic",
      bundle: buildBundle(),
      generatedAt: "2026-02-01T12:00:00.000Z",
    });
    const buffer = exportReportCsv(model);

    expect(buffer[0]).toBe(0xef);
    expect(buffer[1]).toBe(0xbb);
    expect(buffer[2]).toBe(0xbf);

    const content = buffer.toString("utf8");
    expect(content).toContain(";");
    expect(content).toContain("\r\n");
    expect(content).toContain("TOTAL");
    expect(content).toContain("200,00");
    expect(content).toContain("250,00");
  });

  it("exporta XLSX válido (assinatura ZIP)", async () => {
    const model = buildReportTableModel({
      type: "synthetic",
      bundle: buildBundle(),
    });
    const buffer = await exportReportXlsx(model);

    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer[0]).toBe(0x50); // P
    expect(buffer[1]).toBe(0x4b); // K
  });
});

// ============================================================================
// INTEGRAÇÃO: RASCUNHO VS SNAPSHOT
// ============================================================================

describe("Etapa 10 — Exportação de rascunho e snapshot com totais idênticos", () => {
  let projectId: string;
  let bdiConfigId: string;
  let compositionId: string;

  beforeEach(async () => {
    sequence += 1;

    const user = await prisma.user.upsert({
      where: { email: "test.etapa10@obracalc.com" },
      update: {},
      create: {
        email: "test.etapa10@obracalc.com",
        name: "Engenheiro Etapa 10",
        passwordHash: "hash1234567890",
      },
    });
    testUserId = user.id;

    const project = await prisma.project.create({
      data: {
        userId: testUserId,
        name: `Obra Etapa 10 ${Date.now()}-${sequence}`,
        status: "ACTIVE",
      },
    });
    projectId = project.id;

    const bdi = await prisma.bdiConfig.create({
      data: {
        userId: testUserId,
        name: `BDI Etapa 10 ${Date.now()}-${sequence}`,
        bdiRate: "25.0000",
        ac: "0.040000",
        cf: "0.010000",
        s: "0.005000",
        g: "0.005000",
        mi: "0.010000",
        tm: "0.025000",
        te: "0.000000",
        tf: "0.036500",
        l: "0.080000",
        isDefault: true,
      },
    });
    bdiConfigId = bdi.id;

    const material = await prisma.resource.create({
      data: {
        userId: testUserId,
        code: `MAT-E10-${Date.now()}-${sequence}`,
        description: "Bloco Cerâmico",
        unit: "mil",
        category: "MATERIAL",
        price: "1200.0000",
        priceDate: new Date(),
        source: "CUSTOM",
      },
    });

    const labor = await prisma.resource.create({
      data: {
        userId: testUserId,
        code: `LAB-E10-${Date.now()}-${sequence}`,
        description: "Pedreiro",
        unit: "h",
        category: "LABOR",
        price: "25.5000",
        priceDate: new Date(),
        source: "CUSTOM",
      },
    });

    const composition = await prisma.composition.create({
      data: {
        userId: testUserId,
        code: `COMP-E10-${Date.now()}-${sequence}`,
        description: "Alvenaria de vedação",
        unit: "m²",
        type: "ANALYTICAL",
        source: "CUSTOM",
        components: {
          create: [
            { resourceId: material.id, coefficient: "0.02500", sortOrder: 1 },
            { resourceId: labor.id, coefficient: "0.80000", sortOrder: 2 },
          ],
        },
      },
    });
    compositionId = composition.id;

    await prisma.professionalProfile.upsert({
      where: { userId: testUserId },
      update: {
        companyName: "Empresa Etapa 10",
        cnpj: "00.000.000/0001-00",
        professionalName: "Eng. Etapa 10",
        registrationType: "CREA",
        registrationNumber: "100000",
      },
      create: {
        userId: testUserId,
        companyName: "Empresa Etapa 10",
        cnpj: "00.000.000/0001-00",
        professionalName: "Eng. Etapa 10",
        registrationType: "CREA",
        registrationNumber: "100000",
      },
    });
  });

  it("mantém os totais do snapshot exatamente iguais aos do rascunho selecionado", async () => {
    const budget = await createBudget({
      projectId,
      title: `Orçamento Etapa 10 ${Date.now()}-${sequence}`,
      bdiConfigId,
      roundingPriceDecimals: 4,
      roundingQuantityDecimals: 4,
      roundingCoefficientDecimals: 5,
      roundingTotalDecimals: 2,
      roundingMode: "ROUND_HALF_UP",
    });

    if (!budget.success) {
      throw new Error(`Falha ao criar orçamento: ${budget.error}`);
    }

    const revisionId = budget.revisionId!;
    const budgetId = budget.budgetId!;
    const stage = await prisma.stage.findFirst({
      where: { budgetRevisionId: revisionId },
    });

    await addBudgetItem({
      stageId: stage!.id,
      compositionId,
      quantity: "100",
    });

    const draft = await loadReportBundle({
      userId: testUserId,
      budgetId,
      revisionId,
    });

    expect(draft.source).toBe("DATABASE");
    expect(draft.reconciliation.reconciled).toBe(true);
    expect(Number(draft.input.expectedTotals!.direct)).toBeGreaterThan(0);
    expect(draft.input.resources!.length).toBeGreaterThan(0);

    const draftTotals = {
      direct: draft.input.expectedTotals!.direct,
      withBdi: draft.input.expectedTotals!.withBdi,
    };

    const finalized = await finalizeRevision(revisionId);
    expect(finalized.success).toBe(true);

    const snapshot = await loadReportBundle({
      userId: testUserId,
      budgetId,
      revisionId,
    });

    expect(snapshot.source).toBe("SNAPSHOT");
    expect(snapshot.checksum).toBeTruthy();
    expect(snapshot.reconciliation.reconciled).toBe(true);
    expect(snapshot.input.expectedTotals!.direct).toBe(draftTotals.direct);
    expect(snapshot.input.expectedTotals!.withBdi).toBe(draftTotals.withBdi);
    expect(snapshot.input.resources!.length).toBeGreaterThan(0);
    expect(snapshot.input.auditFindings!.length).toBeGreaterThanOrEqual(0);

    // Todos os sete modelos mantêm os totais da fonte selecionada.
    for (const type of ALL_TYPES) {
      const draftModel = buildReportTableModel({ type, bundle: draft });
      const snapshotModel = buildReportTableModel({ type, bundle: snapshot });

      expect(snapshotModel.totals.direct).toBe(draftModel.totals.direct);
      expect(snapshotModel.totals.withBdi).toBe(draftModel.totals.withBdi);
    }

    // O CSV do snapshot contém exatamente os totais reconciliados.
    const csv = exportReportCsv(
      buildReportTableModel({ type: "synthetic", bundle: snapshot })
    ).toString("utf8");
    const expectedTotal = new Decimal(draftTotals.withBdi)
      .toFixed(2)
      .replace(".", ",")
      .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    expect(csv).toContain(expectedTotal);
  });
});
