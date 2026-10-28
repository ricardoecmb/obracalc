import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import Decimal from "decimal.js";
import {
  createBudget,
  createStage,
  addBudgetItem,
  updateBudgetItem,
  recalculateBudgetRevision,
  finalizeRevision,
  createNewRevision,
} from "../budgets";

// Mock auth-utils to return a persistent test user
let testUserId: string;

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth-utils", () => ({
  getCurrentUser: vi.fn(async () => ({
    id: testUserId,
    email: "test.orcamento@obracalc.com",
    name: "Engenheiro Teste",
    role: "ADMIN",
  })),
}));

describe("Módulo de Orçamentos, EAP e Revisões (Etapa 5)", () => {
  let projectId: string;
  let bdiConfigId: string;
  let compositionId: string;

  beforeEach(async () => {
    // 1. Criar ou obter usuário de teste
    const user = await prisma.user.upsert({
      where: { email: "test.orcamento@obracalc.com" },
      update: {},
      create: {
        email: "test.orcamento@obracalc.com",
        name: "Engenheiro Teste",
        passwordHash: "hash1234567890",
      },
    });
    testUserId = user.id;

    // 2. Criar Obra / Projeto de teste
    const project = await prisma.project.create({
      data: {
        userId: testUserId,
        name: "Edifício Horizonte Norte",
        status: "ACTIVE",
      },
    });
    projectId = project.id;

    // 3. Criar BDI padrão (25.0000%)
    const bdi = await prisma.bdiConfig.create({
      data: {
        userId: testUserId,
        name: "BDI Padrão 25%",
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

    // 4. Criar Insumos e Composição Analítica
    const resMaterial = await prisma.resource.create({
      data: {
        userId: testUserId,
        code: `MAT-${Date.now()}`,
        description: "Bloco Cerâmico 9x19x19 cm",
        unit: "mil",
        category: "MATERIAL",
        price: "1200.0000",
        priceDate: new Date(),
        source: "CUSTOM",
      },
    });

    const resLabor = await prisma.resource.create({
      data: {
        userId: testUserId,
        code: `LAB-${Date.now()}`,
        description: "Pedreiro com Encargos",
        unit: "h",
        category: "LABOR",
        price: "25.5000",
        priceDate: new Date(),
        source: "CUSTOM",
      },
    });

    const comp = await prisma.composition.create({
      data: {
        userId: testUserId,
        code: `COMP-${Date.now()}`,
        description: "Alvenaria de vedação com blocos cerâmicos",
        unit: "m²",
        type: "ANALYTICAL",
        source: "CUSTOM",
        components: {
          create: [
            {
              resourceId: resMaterial.id,
              coefficient: "0.02500", // 25 blocos / 1000 = 0.025 mil -> 0.025 * 1200 = 30.00
              sortOrder: 1,
            },
            {
              resourceId: resLabor.id,
              coefficient: "0.80000", // 0.8h * 25.50 = 20.40
              sortOrder: 2,
            },
          ],
        },
      },
    });
    compositionId = comp.id;
  });

  it("deve criar um orçamento com Revisão 1 e etapa inicial padrão", async () => {
    const res = await createBudget({
      projectId,
      title: "Orçamento Executivo Torre A",
      description: "Orçamento de infraestrutura e superestrutura",
      bdiConfigId,
      referenceState: "SP",
      referenceMonth: "2024/01",
      roundingPriceDecimals: 4,
      roundingQuantityDecimals: 4,
      roundingCoefficientDecimals: 5,
      roundingTotalDecimals: 2,
      roundingMode: "ROUND_HALF_UP",
    });

    expect(res.success).toBe(true);
    expect(res.budgetId).toBeDefined();
    expect(res.revisionId).toBeDefined();

    const createdRevision = await prisma.budgetRevision.findUnique({
      where: { id: res.revisionId },
      include: { stages: true },
    });

    expect(createdRevision?.revisionNumber).toBe(1);
    expect(createdRevision?.status).toBe("DRAFT");
    expect(createdRevision?.stages.length).toBe(1);
    expect(createdRevision?.stages[0].code).toBe("1");
    expect(createdRevision?.stages[0].title).toBe("SERVIÇOS INICIAIS");
  });

  it("deve criar subetapas hierárquicas na EAP e adicionar itens orçados calculados", async () => {
    const bRes = await createBudget({
      projectId,
      title: "Orçamento EAP Teste",
      bdiConfigId,
      roundingPriceDecimals: 4,
      roundingQuantityDecimals: 4,
      roundingCoefficientDecimals: 5,
      roundingTotalDecimals: 2,
      roundingMode: "ROUND_HALF_UP",
    });

    const revisionId = bRes.revisionId!;
    const rootStage = await prisma.stage.findFirst({
      where: { budgetRevisionId: revisionId },
    });
    expect(rootStage).toBeDefined();

    // Criar subetapa 1.1 "Alvenarias"
    const subStageRes = await createStage({
      budgetRevisionId: revisionId,
      parentStageId: rootStage!.id,
      code: "1.1",
      title: "Alvenarias e Divisórias",
    });
    expect(subStageRes.success).toBe(true);
    const subStage = subStageRes.stage!;

    // Adicionar item orçado na subetapa: 100 m² de alvenaria
    // Preço da composição:
    // Material = 0.025 * 1200 = 30.00
    // Labor = 0.8 * 25.50 = 20.40
    // Total unitário = 50.40
    // Quantidade = 100 m²
    // Subtotal = 100 * 50.40 = 5040.00
    // BDI = 25% -> Subtotal c/ BDI = 5040.00 * 1.25 = 6300.00
    const itemRes = await addBudgetItem({
      stageId: subStage.id,
      compositionId,
      quantity: "100.0000",
    });

    expect(itemRes.success).toBe(true);
    const item = itemRes.item!;
    expect(new Decimal(item.unitCostMaterial.toString()).toNumber()).toBe(30);
    expect(new Decimal(item.unitCostLabor.toString()).toNumber()).toBe(20.4);
    expect(new Decimal(item.unitCostTotal.toString()).toNumber()).toBe(50.4);
    expect(new Decimal(item.subtotal.toString()).toNumber()).toBe(5040);
    expect(new Decimal(item.bdiRate.toString()).toNumber()).toBe(25);
    expect(new Decimal(item.subtotalWithBdi.toString()).toNumber()).toBe(6300);
  });

  it("deve recalcular valores quando a quantidade for alterada", async () => {
    const bRes = await createBudget({
      projectId,
      title: "Orçamento Recálculo",
      bdiConfigId,
      roundingPriceDecimals: 4,
      roundingQuantityDecimals: 4,
      roundingCoefficientDecimals: 5,
      roundingTotalDecimals: 2,
      roundingMode: "ROUND_HALF_UP",
    });

    const rootStage = await prisma.stage.findFirst({
      where: { budgetRevisionId: bRes.revisionId! },
    });

    const itemRes = await addBudgetItem({
      stageId: rootStage!.id,
      compositionId,
      quantity: "50.0000",
    });

    // Subtotal inicial: 50 * 50.40 = 2520.00 -> Com BDI (25%): 3150.00
    expect(new Decimal(itemRes.item!.subtotal.toString()).toNumber()).toBe(2520);
    expect(new Decimal(itemRes.item!.subtotalWithBdi.toString()).toNumber()).toBe(3150);

    // Atualizar quantidade para 200 m²
    const updateRes = await updateBudgetItem({
      itemId: itemRes.item!.id,
      quantity: "200.0000",
    });

    expect(updateRes.success).toBe(true);
    // Subtotal: 200 * 50.40 = 10080.00 -> Com BDI (25%): 12600.00
    expect(new Decimal(updateRes.item!.subtotal.toString()).toNumber()).toBe(10080);
    expect(new Decimal(updateRes.item!.subtotalWithBdi.toString()).toNumber()).toBe(12600);
  });

  it("deve finalizar revisão com snapshot criptográfico SHA-256 e bloquear edições posteriores", async () => {
    const bRes = await createBudget({
      projectId,
      title: "Orçamento Finalização Imutável",
      bdiConfigId,
      roundingPriceDecimals: 4,
      roundingQuantityDecimals: 4,
      roundingCoefficientDecimals: 5,
      roundingTotalDecimals: 2,
      roundingMode: "ROUND_HALF_UP",
    });

    const rootStage = await prisma.stage.findFirst({
      where: { budgetRevisionId: bRes.revisionId! },
    });

    await addBudgetItem({
      stageId: rootStage!.id,
      compositionId,
      quantity: "10.0000",
    });

    // Finalizar revisão
    const finalizeRes = await finalizeRevision(bRes.revisionId!);
    expect(finalizeRes.success).toBe(true);
    expect(finalizeRes.checksumSha256).toMatch(/^[a-f0-9]{64}$/); // SHA-256 válido

    // Verificar que a revisão agora está FINALIZED
    const revAfter = await prisma.budgetRevision.findUnique({
      where: { id: bRes.revisionId! },
    });
    expect(revAfter?.status).toBe("FINALIZED");

    // Tentativa de adicionar nova etapa ou item deve ser bloqueada
    const attemptAddStage = await createStage({
      budgetRevisionId: bRes.revisionId!,
      code: "2",
      title: "Etapa Não Permitida",
    });
    expect(attemptAddStage.success).toBe(false);
    expect(attemptAddStage.error).toContain("imutável");
  });

  it("deve clonar revisão finalizada gerando Revisão 2 DRAFT com todas as etapas e itens duplicados", async () => {
    const bRes = await createBudget({
      projectId,
      title: "Orçamento Multi-Revisões",
      bdiConfigId,
      roundingPriceDecimals: 4,
      roundingQuantityDecimals: 4,
      roundingCoefficientDecimals: 5,
      roundingTotalDecimals: 2,
      roundingMode: "ROUND_HALF_UP",
    });

    const rootStage = await prisma.stage.findFirst({
      where: { budgetRevisionId: bRes.revisionId! },
    });

    await addBudgetItem({
      stageId: rootStage!.id,
      compositionId,
      quantity: "25.0000",
    });

    // Finalizar Revisão 1
    await finalizeRevision(bRes.revisionId!);

    // Criar Revisão 2
    const cloneRes = await createNewRevision(bRes.budgetId!, "Ajustes contratuais e aditivo");
    expect(cloneRes.success).toBe(true);
    expect(cloneRes.revisionNumber).toBe(2);

    // Verificar que a Revisão 2 está em DRAFT e possui as etapas e itens clonados
    const rev2 = await prisma.budgetRevision.findUnique({
      where: { id: cloneRes.revisionId! },
      include: {
        stages: {
          include: { items: true },
        },
      },
    });

    expect(rev2?.status).toBe("DRAFT");
    expect(rev2?.stages.length).toBe(1);
    expect(rev2?.stages[0].items.length).toBe(1);
    expect(new Decimal(rev2!.stages[0].items[0].quantity.toString()).toNumber()).toBe(25);

    // A Revisão 2 deve aceitar novas edições normalmente
    const editRes = await updateBudgetItem({
      itemId: rev2!.stages[0].items[0].id,
      quantity: "50.0000",
    });
    expect(editRes.success).toBe(true);
  });

  it("deve usar o BDI padrão do usuário quando a revisão não informar configuração", async () => {
    const preferredBdi = await prisma.bdiConfig.create({
      data: {
        userId: testUserId,
        name: "BDI Preferido 18%",
        bdiRate: "18.0000",
        ac: "0.030000",
        cf: "0.005000",
        s: "0.005000",
        g: "0.005000",
        mi: "0.010000",
        tm: "0.025000",
        te: "0.000000",
        tf: "0.036500",
        l: "0.060000",
      },
    });

    await prisma.userPreferences.upsert({
      where: { userId: testUserId },
      update: { defaultBdiConfigId: preferredBdi.id },
      create: { userId: testUserId, defaultBdiConfigId: preferredBdi.id },
    });

    const bRes = await createBudget({
      projectId,
      title: "Orçamento com BDI Padrão do Usuário",
      roundingPriceDecimals: 4,
      roundingQuantityDecimals: 4,
      roundingCoefficientDecimals: 5,
      roundingTotalDecimals: 2,
      roundingMode: "ROUND_HALF_UP",
    });

    expect(bRes.success).toBe(true);

    const revision = await prisma.budgetRevision.findUnique({
      where: { id: bRes.revisionId! },
      select: { bdiConfigId: true },
    });
    expect(revision?.bdiConfigId).toBe(preferredBdi.id);

    const rootStage = await prisma.stage.findFirst({
      where: { budgetRevisionId: bRes.revisionId! },
    });

    const itemRes = await addBudgetItem({
      stageId: rootStage!.id,
      compositionId,
      quantity: "100.0000",
    });

    expect(itemRes.success).toBe(true);
    // 100 m² × R$ 50,40 = R$ 5.040,00; BDI 18% = R$ 907,20; total = R$ 5.947,20
    expect(new Decimal(itemRes.item!.bdiRate.toString()).toNumber()).toBe(18);
    expect(new Decimal(itemRes.item!.subtotalWithBdi.toString()).toNumber()).toBe(5947.2);
  });

  it("deve aplicar exceção de BDI por serviço e preservá-la no recálculo", async () => {
    const exceptionBdi = await prisma.bdiConfig.create({
      data: {
        userId: testUserId,
        name: "BDI Exceção 10%",
        bdiRate: "10.0000",
        ac: "0.020000",
        cf: "0.005000",
        s: "0.005000",
        g: "0.005000",
        mi: "0.005000",
        tm: "0.025000",
        te: "0.000000",
        tf: "0.030000",
        l: "0.050000",
      },
    });

    const updatedExceptionBdi = await prisma.bdiConfig.create({
      data: {
        userId: testUserId,
        name: "BDI Exceção 30%",
        bdiRate: "30.0000",
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
    });

    const bRes = await createBudget({
      projectId,
      title: "Orçamento com Exceções de BDI",
      bdiConfigId,
      roundingPriceDecimals: 4,
      roundingQuantityDecimals: 4,
      roundingCoefficientDecimals: 5,
      roundingTotalDecimals: 2,
      roundingMode: "ROUND_HALF_UP",
    });

    const rootStage = await prisma.stage.findFirst({
      where: { budgetRevisionId: bRes.revisionId! },
    });

    const itemRes = await addBudgetItem({
      stageId: rootStage!.id,
      compositionId,
      quantity: "100.0000",
      bdiOverrideId: exceptionBdi.id,
    });

    expect(itemRes.success).toBe(true);
    expect(new Decimal(itemRes.item!.bdiRate.toString()).toNumber()).toBe(10);
    // 5.040,00 × 1,10 = 5.544,00
    expect(new Decimal(itemRes.item!.subtotalWithBdi.toString()).toNumber()).toBe(5544);

    // Troca da exceção do serviço
    const updateRes = await updateBudgetItem({
      itemId: itemRes.item!.id,
      bdiOverrideId: updatedExceptionBdi.id,
    });
    expect(updateRes.success).toBe(true);
    expect(new Decimal(updateRes.item!.bdiRate.toString()).toNumber()).toBe(30);
    expect(new Decimal(updateRes.item!.subtotalWithBdi.toString()).toNumber()).toBe(6552);

    // O recálculo geral deve manter a exceção do serviço
    const recalcRes = await recalculateBudgetRevision(bRes.revisionId!);
    expect(recalcRes.success).toBe(true);

    const recalculated = await prisma.budgetItem.findUnique({
      where: { id: itemRes.item!.id },
    });
    expect(new Decimal(recalculated!.bdiRate.toString()).toNumber()).toBe(30);

    // Remover a exceção volta o serviço ao BDI padrão da revisão (25%)
    const resetRes = await updateBudgetItem({
      itemId: itemRes.item!.id,
      bdiOverrideId: null,
    });
    expect(resetRes.success).toBe(true);
    expect(new Decimal(resetRes.item!.bdiRate.toString()).toNumber()).toBe(25);
    expect(new Decimal(resetRes.item!.subtotalWithBdi.toString()).toNumber()).toBe(6300);
  });

  it("deve rejeitar exceção de BDI inexistente ou pertencente a outro usuário", async () => {
    const bRes = await createBudget({
      projectId,
      title: "Orçamento com Exceção Inválida",
      bdiConfigId,
      roundingPriceDecimals: 4,
      roundingQuantityDecimals: 4,
      roundingCoefficientDecimals: 5,
      roundingTotalDecimals: 2,
      roundingMode: "ROUND_HALF_UP",
    });

    const rootStage = await prisma.stage.findFirst({
      where: { budgetRevisionId: bRes.revisionId! },
    });

    const missingOverride = await addBudgetItem({
      stageId: rootStage!.id,
      compositionId,
      quantity: "1.0000",
      bdiOverrideId: "bdi-inexistente",
    });
    expect(missingOverride.success).toBe(false);
    expect(missingOverride.error).toContain("não encontrada");

    const otherUser = await prisma.user.upsert({
      where: { email: "outro.usuario.bdi@obracalc.com" },
      update: {},
      create: {
        email: "outro.usuario.bdi@obracalc.com",
        name: "Outro Usuário",
        passwordHash: "hash1234567890",
      },
    });

    const foreignBdi = await prisma.bdiConfig.create({
      data: {
        userId: otherUser.id,
        name: "BDI de Outro Usuário",
        bdiRate: "15.0000",
      },
    });

    const foreignOverride = await addBudgetItem({
      stageId: rootStage!.id,
      compositionId,
      quantity: "1.0000",
      bdiOverrideId: foreignBdi.id,
    });
    expect(foreignOverride.success).toBe(false);
    expect(foreignOverride.error).toContain("não encontrada");
  });
});
