import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  runAuditRules,
  type AuditRevisionInput,
} from "@/lib/services/audit-rules";
import { runRevisionAuditAction, justifyAuditResultAction } from "../audit";
import { createBudget, addBudgetItem, finalizeRevision } from "../budgets";

let testUserId: string;
let sequence = 0;

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth-utils", () => ({
  getCurrentUser: vi.fn(async () => ({
    id: testUserId,
    email: "test.etapa9@obracalc.com",
    name: "Engenheiro Etapa 9",
    role: "ADMIN",
  })),
}));

function buildRevision(overrides: Partial<AuditRevisionInput> = {}): AuditRevisionInput {
  return {
    id: "revision-1",
    revisionNumber: 1,
    bdiConfig: {
      id: "bdi-1",
      name: "BDI 25%",
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
    },
    stages: [
      {
        id: "stage-1",
        code: "1",
        title: "Serviços",
        items: [
          {
            id: "item-1",
            quantity: "10",
            bdiRate: "25.0000",
            bdiOverrideId: null,
            unitCostTotal: "50.4000",
            composition: {
              id: "comp-1",
              code: "COMP-1",
              description: "Alvenaria",
              unit: "m²",
              type: "ANALYTICAL",
              closedTotalPrice: null,
              components: [
                {
                  id: "component-1",
                  coefficient: "1.00000",
                  resourceId: "resource-1",
                  childCompositionId: null,
                  resource: {
                    id: "resource-1",
                    code: "MAT-1",
                    description: "Bloco",
                    unit: "un",
                    price: "10.0000",
                    category: "MATERIAL",
                    laborChargesIncluded: false,
                    laborChargesRate: null,
                  },
                  childComposition: null,
                },
              ],
            },
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("Etapa 9 — Regras de auditoria", () => {
  it("detecta preço ausente em composição fechada", () => {
    const revision = buildRevision();
    revision.stages[0].items[0].unitCostTotal = "0";
    revision.stages[0].items[0].composition = {
      ...revision.stages[0].items[0].composition,
      type: "CLOSED",
      closedTotalPrice: null,
      components: [],
    };

    const findings = runAuditRules(revision);
    const finding = findings.find((entry) => entry.type === "MISSING_PRICE");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("ERROR");
    expect(finding!.entityId).toBe("item-1");
  });

  it("detecta quantidade inválida", () => {
    const revision = buildRevision();
    revision.stages[0].items[0].quantity = "0";

    const findings = runAuditRules(revision);
    expect(findings.some((entry) => entry.type === "INVALID_QUANTITY")).toBe(true);
  });

  it("detecta BDI inválido pela fórmula do TCU", () => {
    const revision = buildRevision();
    revision.bdiConfig = {
      ...revision.bdiConfig!,
      tm: "0.500000",
      l: "0.500000",
    };

    const findings = runAuditRules(revision);
    expect(
      findings.some(
        (entry) => entry.type === "INVALID_BDI" && entry.severity === "ERROR"
      )
    ).toBe(true);
  });

  it("detecta unidade incompatível entre composição e subcomposição", () => {
    const revision = buildRevision();
    revision.stages[0].items[0].composition.components = [
      {
        id: "component-child",
        coefficient: "1.00000",
        resourceId: null,
        childCompositionId: "child-1",
        resource: null,
        childComposition: {
          id: "child-1",
          code: "COMP-CHILD",
          description: "Subcomposição em horas",
          unit: "h",
          type: "ANALYTICAL",
          closedTotalPrice: null,
        },
      },
    ];

    const findings = runAuditRules(revision);
    expect(findings.some((entry) => entry.type === "INCOMPATIBLE_UNITS")).toBe(true);
  });

  it("detecta composição analítica incompleta", () => {
    const revision = buildRevision();
    revision.stages[0].items[0].composition.components = [];
    revision.stages[0].items[0].unitCostTotal = "0";

    const findings = runAuditRules(revision);
    expect(findings.some((entry) => entry.type === "INCOMPLETE_COMPOSITION")).toBe(true);
  });
});

describe("Etapa 9 — Integração com finalização, persistência e justificativa", () => {
  let projectId: string;
  let bdiConfigId: string;
  let laborId: string;
  let compositionId: string;

  beforeEach(async () => {
    sequence += 1;

    const user = await prisma.user.upsert({
      where: { email: "test.etapa9@obracalc.com" },
      update: {},
      create: {
        email: "test.etapa9@obracalc.com",
        name: "Engenheiro Etapa 9",
        passwordHash: "hash1234567890",
      },
    });
    testUserId = user.id;

    const project = await prisma.project.create({
      data: {
        userId: testUserId,
        name: `Obra Etapa 9 ${Date.now()}-${sequence}`,
        status: "ACTIVE",
      },
    });
    projectId = project.id;

    const bdi = await prisma.bdiConfig.create({
      data: {
        userId: testUserId,
        name: `BDI Etapa 9 ${Date.now()}-${sequence}`,
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
        code: `MAT-E9-${Date.now()}-${sequence}`,
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
        code: `LAB-E9-${Date.now()}-${sequence}`,
        description: "Pedreiro",
        unit: "h",
        category: "LABOR",
        price: "25.5000",
        priceDate: new Date(),
        source: "CUSTOM",
      },
    });
    laborId = labor.id;

    const composition = await prisma.composition.create({
      data: {
        userId: testUserId,
        code: `COMP-E9-${Date.now()}-${sequence}`,
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
  });

  async function setupBudget() {
    const budget = await createBudget({
      projectId,
      title: `Orçamento Etapa 9 ${Date.now()}-${sequence}`,
      bdiConfigId,
      roundingPriceDecimals: 4,
      roundingQuantityDecimals: 4,
      roundingCoefficientDecimals: 5,
      roundingTotalDecimals: 2,
      roundingMode: "ROUND_HALF_UP",
    });

    const revisionId = budget.revisionId!;
    const stage = await prisma.stage.findFirst({
      where: { budgetRevisionId: revisionId },
    });
    const item = await addBudgetItem({
      stageId: stage!.id,
      compositionId,
      quantity: "100",
    });

    return { revisionId, itemId: item.item!.id };
  }

  it("persiste achados, bloqueia finalização com erro crítico e aceita justificativa de alerta", async () => {
    const { revisionId, itemId } = await setupBudget();

    await prisma.budgetItem.update({
      where: { id: itemId },
      data: { quantity: "0" },
    });

    const auditWithError = await runRevisionAuditAction(revisionId);
    expect(auditWithError.success).toBe(true);
    expect(auditWithError.summary!.errors).toBeGreaterThan(0);
    expect(auditWithError.results!.some((result) => result.type === "INVALID_QUANTITY")).toBe(true);

    const blocked = await finalizeRevision(revisionId);
    expect(blocked.success).toBe(false);
    expect((blocked as { blocked?: boolean }).blocked).toBe(true);

    const snapshotBefore = await prisma.revisionSnapshot.findUnique({
      where: { budgetRevisionId: revisionId },
    });
    expect(snapshotBefore).toBeNull();

    // Corrige a quantidade e introduz um alerta justificável (encargos duplicados).
    await prisma.budgetItem.update({
      where: { id: itemId },
      data: { quantity: "100" },
    });
    await prisma.resource.update({
      where: { id: laborId },
      data: { laborChargesIncluded: true, laborChargesRate: "84.5000" },
    });

    const auditWithWarning = await runRevisionAuditAction(revisionId);
    expect(auditWithWarning.success).toBe(true);
    expect(auditWithWarning.summary!.errors).toBe(0);

    const warning = auditWithWarning.results!.find(
      (result) => result.severity === "WARNING"
    );
    expect(warning).toBeDefined();
    expect(warning!.type).toBe("DUPLICATE_CHARGES");

    const tooShort = await justifyAuditResultAction({
      auditResultId: warning!.id,
      justification: "ok",
    });
    expect(tooShort.success).toBe(false);

    const justified = await justifyAuditResultAction({
      auditResultId: warning!.id,
      justification: "Encargos conferidos: já estão contemplados no preço do insumo.",
    });
    expect(justified.success).toBe(true);

    const persisted = await prisma.auditResult.findUnique({ where: { id: warning!.id } });
    expect(persisted!.justification).toContain("Encargos conferidos");
    expect(persisted!.resolvedAt).not.toBeNull();

    const finalized = await finalizeRevision(revisionId);
    expect(finalized.success).toBe(true);

    const snapshotAfter = await prisma.revisionSnapshot.findUnique({
      where: { budgetRevisionId: revisionId },
    });
    expect(snapshotAfter).not.toBeNull();

    const auditRows = await prisma.auditResult.findMany({
      where: { budgetRevisionId: revisionId },
    });
    expect(auditRows.length).toBeGreaterThan(0);
  });
});
