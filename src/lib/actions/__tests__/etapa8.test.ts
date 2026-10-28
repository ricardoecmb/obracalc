import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import Decimal from "decimal.js";
import {
  createBudget,
  addBudgetItem,
  updateBudgetItem,
  finalizeRevision,
} from "../budgets";
import {
  applyPriceUpdates,
  previewPriceUpdates,
} from "@/lib/services/price-update";
import { executeBudgetImport } from "@/lib/services/budget-import";
import { compareRevisionsAction, createRevisionFromFinalizedAction } from "../revision-compare";

let testUserId: string;
let sequence = 0;

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth-utils", () => ({
  getCurrentUser: vi.fn(async () => ({
    id: testUserId,
    email: "test.etapa8@obracalc.com",
    name: "Engenheiro Etapa 8",
    role: "ADMIN",
  })),
}));

const rounding = {
  roundingPriceDecimals: 4,
  roundingQuantityDecimals: 4,
  roundingCoefficientDecimals: 5,
  roundingTotalDecimals: 2,
  roundingMode: "ROUND_HALF_UP" as const,
};

describe("Etapa 8 — Atualização de preços, importação e revisões", () => {
  let projectId: string;
  let bdiConfigId: string;
  let materialId: string;
  let compositionId: string;
  let compositionCode: string;

  beforeEach(async () => {
    sequence += 1;

    const user = await prisma.user.upsert({
      where: { email: "test.etapa8@obracalc.com" },
      update: {},
      create: {
        email: "test.etapa8@obracalc.com",
        name: "Engenheiro Etapa 8",
        passwordHash: "hash1234567890",
      },
    });
    testUserId = user.id;

    const project = await prisma.project.create({
      data: {
        userId: testUserId,
        name: `Obra Etapa 8 ${Date.now()}-${sequence}`,
        status: "ACTIVE",
      },
    });
    projectId = project.id;

    const bdi = await prisma.bdiConfig.create({
      data: {
        userId: testUserId,
        name: `BDI 25% Etapa 8 ${Date.now()}-${sequence}`,
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
        code: `MAT-E8-${Date.now()}-${sequence}`,
        description: "Bloco Cerâmico",
        unit: "mil",
        category: "MATERIAL",
        price: "1200.0000",
        priceDate: new Date(),
        source: "CUSTOM",
      },
    });
    materialId = material.id;

    const labor = await prisma.resource.create({
      data: {
        userId: testUserId,
        code: `LAB-E8-${Date.now()}-${sequence}`,
        description: "Pedreiro",
        unit: "h",
        category: "LABOR",
        price: "25.5000",
        priceDate: new Date(),
        source: "CUSTOM",
      },
    });

    compositionCode = `COMP-E8-${Date.now()}-${sequence}`;
    const composition = await prisma.composition.create({
      data: {
        userId: testUserId,
        code: compositionCode,
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

  async function setupBudget(quantity = "100") {
    const budget = await createBudget({
      projectId,
      title: `Orçamento Etapa 8 ${Date.now()}-${sequence}`,
      bdiConfigId,
      referenceState: "SP",
      referenceMonth: "2024/01",
      ...rounding,
    });

    const revisionId = budget.revisionId!;
    const stage = await prisma.stage.findFirst({
      where: { budgetRevisionId: revisionId },
    });

    const item = await addBudgetItem({
      stageId: stage!.id,
      compositionId,
      quantity,
    });

    expect(item.success).toBe(true);
    return {
      budgetId: budget.budgetId!,
      revisionId,
      stageId: stage!.id,
      itemId: item.item!.id,
    };
  }

  it("atualiza preços com histórico imutável e recalcula apenas revisões em rascunho", async () => {
    const { budgetId, revisionId, itemId } = await setupBudget("100");

    const preview = await previewPriceUpdates({
      userId: testUserId,
      updates: [{ resourceId: materialId, price: "2400" }],
    });

    const impact = preview.impacts.find((entry) => entry.revisionId === revisionId);
    expect(impact).toBeDefined();
    expect(impact!.totalWithBdiBefore).toBe("6300.00");
    expect(impact!.totalWithBdiAfter).toBe("10050.00");
    expect(impact!.delta).toBe("3750.00");
    expect(preview.totalDelta).toBe("3750.00");

    const applied = await applyPriceUpdates({
      userId: testUserId,
      updates: [{ resourceId: materialId, price: "2400" }],
      reason: "Reajuste de tabela",
    });

    expect(applied.success).toBe(true);
    expect(applied.updatedResources).toBe(1);
    expect(applied.historyEntries).toBe(1);

    const updatedItem = await prisma.budgetItem.findUnique({ where: { id: itemId } });
    expect(new Decimal(updatedItem!.unitCostMaterial).equals("60")).toBe(true);
    expect(new Decimal(updatedItem!.unitCostTotal).equals("80.4")).toBe(true);
    expect(new Decimal(updatedItem!.subtotal).equals("8040")).toBe(true);
    expect(new Decimal(updatedItem!.subtotalWithBdi).equals("10050")).toBe(true);

    // Reaplicar o mesmo preço não gera novo histórico.
    const noop = await applyPriceUpdates({
      userId: testUserId,
      updates: [{ resourceId: materialId, price: "2400" }],
    });
    expect(noop.updatedResources).toBe(0);
    expect(await prisma.resourcePriceHistory.count({ where: { resourceId: materialId } })).toBe(1);

    // Um novo reajuste acrescenta entrada sem alterar as anteriores.
    await applyPriceUpdates({
      userId: testUserId,
      updates: [{ resourceId: materialId, price: "3000" }],
    });
    const history = await prisma.resourcePriceHistory.findMany({
      where: { resourceId: materialId },
      orderBy: { createdAt: "asc" },
    });
    expect(history).toHaveLength(2);
    expect(new Decimal(history[0].price).equals(2400)).toBe(true);

    // Finaliza a revisão e garante que o snapshot/histórico não mudam.
    const finalized = await finalizeRevision(revisionId);
    expect(finalized.success).toBe(true);

    const snapshotBefore = await prisma.revisionSnapshot.findUnique({
      where: { budgetRevisionId: revisionId },
    });

    const itemBefore = await prisma.budgetItem.findUnique({ where: { id: itemId } });
    const afterFinalize = await applyPriceUpdates({
      userId: testUserId,
      updates: [{ resourceId: materialId, price: "3600" }],
    });

    expect(afterFinalize.success).toBe(true);
    expect(afterFinalize.impacts.find((entry) => entry.revisionId === revisionId)).toBeUndefined();

    const itemAfter = await prisma.budgetItem.findUnique({ where: { id: itemId } });
    expect(itemAfter!.subtotal.toString()).toBe(itemBefore!.subtotal.toString());

    const snapshotAfter = await prisma.revisionSnapshot.findUnique({
      where: { budgetRevisionId: revisionId },
    });
    expect(snapshotAfter!.checksum).toBe(snapshotBefore!.checksum);

    // Importar em revisão finalizada é bloqueado antes de qualquer escrita.
    const csv = [
      "Etapa;Codigo;Descricao;Unidade;Quantidade;Preco",
      `1;${compositionCode};Alvenaria;m²;10;50,40`,
    ].join("\n");

    await expect(
      executeBudgetImport({
        userId: testUserId,
        revisionId,
        content: csv,
        fileType: "CSV",
        mapping: {
          stageCode: "Etapa",
          code: "Codigo",
          description: "Descricao",
          unit: "Unidade",
          quantity: "Quantidade",
          price: "Preco",
        },
      })
    ).rejects.toThrow(/finalizada/i);

    expect(budgetId).toBeDefined();
  });

  it("compara revisões mesmo quando a origem está finalizada e preserva o snapshot", async () => {
    const { revisionId } = await setupBudget("100");

    const finalized = await finalizeRevision(revisionId);
    expect(finalized.success).toBe(true);

    const snapshotBefore = await prisma.revisionSnapshot.findUnique({
      where: { budgetRevisionId: revisionId },
    });

    const newRevision = await createRevisionFromFinalizedAction({
      revisionId,
      notes: "Revisão de reajuste",
    });
    expect(newRevision.success).toBe(true);
    expect(newRevision.checksumVerified).toBe(true);
    expect(newRevision.revisionNumber).toBe(2);

    const rev2Id = newRevision.revisionId!;
    const rev2Stage = await prisma.stage.findFirst({
      where: { budgetRevisionId: rev2Id },
    });
    const rev2Item = await prisma.budgetItem.findFirst({
      where: { stageId: rev2Stage!.id },
    });

    const changed = await updateBudgetItem({
      itemId: rev2Item!.id,
      quantity: "150",
    });
    expect(changed.success).toBe(true);

    const added = await addBudgetItem({
      stageId: rev2Stage!.id,
      compositionId,
      quantity: "1",
    });
    expect(added.success).toBe(true);

    const comparison = await compareRevisionsAction({
      fromRevisionId: revisionId,
      toRevisionId: rev2Id,
    });

    expect(comparison.success).toBe(true);
    expect(comparison.comparison!.from.source).toBe("SNAPSHOT");
    expect(comparison.comparison!.to.source).toBe("DATABASE");
    expect(comparison.comparison!.from.totalWithBdi).toBe("6300.00");
    expect(comparison.comparison!.to.totalWithBdi).toBe("9513.00");
    expect(comparison.comparison!.summary.deltaWithBdi).toBe("3213.00");
    expect(comparison.comparison!.summary.itemsChanged).toBe(1);
    expect(comparison.comparison!.summary.itemsAdded).toBe(1);

    const snapshotAfter = await prisma.revisionSnapshot.findUnique({
      where: { budgetRevisionId: revisionId },
    });
    expect(snapshotAfter!.checksum).toBe(snapshotBefore!.checksum);

    const originalItem = await prisma.budgetItem.findFirst({
      where: { stage: { budgetRevisionId: revisionId } },
    });
    expect(originalItem!.quantity.toString()).toBe("100");

    // A revisão clonada continua editável.
    const rev2 = await prisma.budgetRevision.findUnique({ where: { id: rev2Id } });
    expect(rev2!.status).toBe("DRAFT");
  });

  it("importa CSV somente após confirmação e resolução explícita dos conflitos", async () => {
    const { revisionId } = await setupBudget("1");
    await prisma.budgetItem.deleteMany({
      where: { stage: { budgetRevisionId: revisionId } },
    });

    const unknownCode = `SERV-NOVO-${Date.now()}-${sequence}`;
    const csv = [
      "Etapa;Codigo;Descricao;Unidade;Quantidade;Preco",
      `1;${compositionCode};Alvenaria;m²;10;50,40`,
      `1;${unknownCode};Serviço novo;m²;5;100,00`,
      `1;${compositionCode};Alvenaria;kg;2;50,40`,
      `1;${compositionCode};Alvenaria;m²;3;99,00`,
    ].join("\n");

    const mapping = {
      stageCode: "Etapa",
      code: "Codigo",
      description: "Descricao",
      unit: "Unidade",
      quantity: "Quantidade",
      price: "Preco",
    };

    const preview = await executeBudgetImport({
      userId: testUserId,
      revisionId,
      content: csv,
      fileType: "CSV",
      mapping,
    });

    expect(preview.success).toBe(false);
    expect(preview.requiresConfirmation).toBe(true);
    expect(preview.preview!.summary).toEqual({
      totalRows: 4,
      ready: 1,
      conflicts: 2,
      invalid: 1,
    });

    const unknownRow = preview.preview!.rows.find((row) => row.code === unknownCode)!;
    const divergenceRow = preview.preview!.rows.find(
      (row) => row.conflicts.some((conflict) => conflict.kind === "PRICE_DIVERGENCE")
    )!;
    const invalidRow = preview.preview!.rows.find((row) => row.status === "INVALID")!;

    expect(unknownRow.conflicts[0].resolutions).toContain("CREATE_CLOSED");
    expect(divergenceRow.conflicts[0].resolutions).toContain("USE_SYSTEM");
    expect(invalidRow.conflicts[0].kind).toBe("UNIT_MISMATCH");

    // Confirmação sem resolver todos os conflitos continua bloqueada.
    const unresolved = await executeBudgetImport({
      userId: testUserId,
      revisionId,
      content: csv,
      fileType: "CSV",
      mapping,
      confirm: true,
      resolutions: { [String(unknownRow.line)]: "CREATE_CLOSED" },
    });
    expect(unresolved.success).toBe(false);
    expect(unresolved.pendingLines).toEqual([divergenceRow.line]);

    const executed = await executeBudgetImport({
      userId: testUserId,
      revisionId,
      content: csv,
      fileType: "CSV",
      mapping,
      confirm: true,
      resolutions: {
        [String(unknownRow.line)]: "CREATE_CLOSED",
        [String(divergenceRow.line)]: "USE_SYSTEM",
      },
    });

    expect(executed.success).toBe(true);
    expect(executed.report!.created).toBe(3);
    expect(executed.report!.skipped).toBe(1);

    const items = await prisma.budgetItem.findMany({
      where: { stage: { budgetRevisionId: revisionId } },
      include: { composition: true },
      orderBy: { sortOrder: "asc" },
    });
    expect(items).toHaveLength(3);
    expect(items.filter((item) => item.composition.code === compositionCode)).toHaveLength(2);

    const createdComposition = await prisma.composition.findFirst({
      where: { userId: testUserId, code: unknownCode },
    });
    expect(createdComposition).toBeDefined();
    expect(createdComposition!.type).toBe("CLOSED");
    expect(new Decimal(createdComposition!.closedTotalPrice!).equals(100)).toBe(true);

    // A linha com preço divergente usa o custo do sistema.
    const divergentItem = items.find((item) => item.notes?.includes(`linha ${divergenceRow.line}`));
    expect(new Decimal(divergentItem!.unitCostTotal).equals("50.4")).toBe(true);
  });
});
