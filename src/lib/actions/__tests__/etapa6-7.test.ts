import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import Decimal from "decimal.js";
import {
  applyBudgetTemplate,
  createBudget,
  createStage,
  deleteBudgetItems,
  addBudgetItem,
  renumberStages,
  saveBudgetTemplate,
  listBudgetTemplates,
} from "../budgets";
import {
  addCompositionComponentAction,
  createCompositionAction,
  createCompositionInBudgetAction,
  duplicateCompositionAction,
  getCompositionDetailsAction,
  replaceComponentResourceAction,
  simulateResourceReplacementAction,
  updateCompositionComponentAction,
} from "../compositions";
import {
  confirmResourceEquivalenceAction,
  createResourceEquivalenceAction,
} from "../resources";

let testUserId: string;
let sequence = 0;

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth-utils", () => ({
  getCurrentUser: vi.fn(async () => ({
    id: testUserId,
    email: "test.etapa67@obracalc.com",
    name: "Engenheiro Etapa 6/7",
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

describe("Etapa 6/7 — EAP, modelos, composições e simulação", () => {
  let projectId: string;
  let bdiConfigId: string;
  let materialId: string;
  let laborId: string;
  let compositionId: string;

  beforeEach(async () => {
    sequence += 1;

    const user = await prisma.user.upsert({
      where: { email: "test.etapa67@obracalc.com" },
      update: {},
      create: {
        email: "test.etapa67@obracalc.com",
        name: "Engenheiro Etapa 6/7",
        passwordHash: "hash1234567890",
      },
    });
    testUserId = user.id;

    const project = await prisma.project.create({
      data: {
        userId: testUserId,
        name: `Obra Etapa 6/7 ${Date.now()}-${sequence}`,
        status: "ACTIVE",
      },
    });
    projectId = project.id;

    const bdi = await prisma.bdiConfig.create({
      data: {
        userId: testUserId,
        name: `BDI 25% ${Date.now()}-${sequence}`,
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
    });
    bdiConfigId = bdi.id;

    const material = await prisma.resource.create({
      data: {
        userId: testUserId,
        code: `MAT-E67-${Date.now()}-${sequence}`,
        description: "Material base",
        unit: "m³",
        category: "MATERIAL",
        price: "10.0000",
        priceDate: new Date(),
        source: "CUSTOM",
      },
    });
    materialId = material.id;

    const labor = await prisma.resource.create({
      data: {
        userId: testUserId,
        code: `LAB-E67-${Date.now()}-${sequence}`,
        description: "Mão de obra base",
        unit: "h",
        category: "LABOR",
        price: "20.0000",
        priceDate: new Date(),
        source: "CUSTOM",
      },
    });
    laborId = labor.id;

    const composition = await prisma.composition.create({
      data: {
        userId: testUserId,
        code: `COMP-E67-${Date.now()}-${sequence}`,
        description: "Composição base para Etapa 7",
        unit: "m³",
        type: "ANALYTICAL",
        source: "CUSTOM",
        sourceState: "SP",
        sourceMonth: "2024/01",
        sourceTaxRegime: "DESONERADO",
        components: {
          create: [
            { resourceId: materialId, coefficient: "2.00000", sortOrder: 1 },
            { resourceId: laborId, coefficient: "1.50000", sortOrder: 2 },
          ],
        },
      },
    });
    compositionId = composition.id;
  });

  async function createBaseBudget(title: string) {
    const res = await createBudget({
      projectId,
      title,
      bdiConfigId,
      ...rounding,
    });
    expect(res.success).toBe(true);
    return res;
  }

  // ==========================================================================
  // ETAPA 6
  // ==========================================================================

  it("gera numeração hierárquica automática e permite renumerar a EAP", async () => {
    const budget = await createBaseBudget(`Orçamento numeração ${Date.now()}`);

    const rootStage = await prisma.stage.findFirst({
      where: { budgetRevisionId: budget.revisionId! },
    });
    expect(rootStage?.code).toBe("1");

    // Código omitido em subetapa -> 1.1
    const child = await createStage({
      budgetRevisionId: budget.revisionId!,
      parentStageId: rootStage!.id,
      title: "Subetapa automática",
    });
    expect(child.success).toBe(true);
    expect(child.stage?.code).toBe("1.1");

    // Código omitido em etapa raiz -> 2
    const root2 = await createStage({
      budgetRevisionId: budget.revisionId!,
      title: "Segunda raiz",
    });
    expect(root2.stage?.code).toBe("2");

    // Código explícito fora do padrão é aceito...
    const explicitChild = await createStage({
      budgetRevisionId: budget.revisionId!,
      parentStageId: rootStage!.id,
      code: "99",
      title: "Filha com código explícito",
    });
    expect(explicitChild.stage?.code).toBe("99");

    // ...e a renumeração determinística restaura 1.2.
    const renumber = await renumberStages(budget.revisionId!);
    expect(renumber.success).toBe(true);

    const stages = await prisma.stage.findMany({
      where: { budgetRevisionId: budget.revisionId! },
      orderBy: [{ sortOrder: "asc" }],
    });
    const codes = stages.map((stage) => stage.code).sort();
    expect(codes).toEqual(["1", "1.1", "1.2", "2"]);
  });

  it("exclui itens em lote e impede exclusão de itens de outro usuário", async () => {
    const budget = await createBaseBudget(`Orçamento lote ${Date.now()}`);
    const stage = await prisma.stage.findFirst({
      where: { budgetRevisionId: budget.revisionId! },
    });

    const first = await addBudgetItem({
      stageId: stage!.id,
      compositionId,
      quantity: "2.0000",
    });
    const second = await addBudgetItem({
      stageId: stage!.id,
      compositionId,
      quantity: "3.0000",
    });
    expect(first.success && second.success).toBe(true);

    // Item de outro usuário na mesma base de dados.
    const otherUser = await prisma.user.upsert({
      where: { email: "outro.etapa67@obracalc.com" },
      update: {},
      create: {
        email: "outro.etapa67@obracalc.com",
        name: "Outro Usuário",
        passwordHash: "hash1234567890",
      },
    });
    const otherBudget = await prisma.budget.create({
      data: { userId: otherUser.id, projectId, title: "Orçamento alheio" },
    });
    const otherRevision = await prisma.budgetRevision.create({
      data: { budgetId: otherBudget.id, revisionNumber: 1 },
    });
    const otherStage = await prisma.stage.create({
      data: {
        budgetRevisionId: otherRevision.id,
        code: "1",
        title: "Alheia",
        sortOrder: 1,
      },
    });
    const foreignItem = await prisma.budgetItem.create({
      data: {
        stageId: otherStage.id,
        compositionId,
        sortOrder: 1,
        quantity: "1.0000",
      },
    });

    const blocked = await deleteBudgetItems([first.item!.id, foreignItem.id]);
    expect(blocked.success).toBe(false);
    expect(await prisma.budgetItem.count({ where: { id: first.item!.id } })).toBe(1);

    const deleted = await deleteBudgetItems([first.item!.id, second.item!.id]);
    expect(deleted.success).toBe(true);
    expect(deleted.deletedCount).toBe(2);
    expect(await prisma.budgetItem.count({ where: { stageId: stage!.id } })).toBe(0);
  });

  it("salva, lista e aplica modelos de EAP na criação e em revisões existentes", async () => {
    const source = await createBaseBudget(`Orçamento modelo ${Date.now()}`);
    const sourceStage = await prisma.stage.findFirst({
      where: { budgetRevisionId: source.revisionId! },
    });

    await createStage({
      budgetRevisionId: source.revisionId!,
      parentStageId: sourceStage!.id,
      title: "Subetapa do modelo",
    });
    await addBudgetItem({
      stageId: sourceStage!.id,
      compositionId,
      quantity: "4.0000",
    });

    const saved = await saveBudgetTemplate({
      revisionId: source.revisionId!,
      name: `Modelo ${Date.now()}`,
      description: "Modelo de teste",
    });
    expect(saved.success).toBe(true);
    expect(saved.templateId).toBeDefined();

    const listed = await listBudgetTemplates();
    expect(listed.success).toBe(true);
    expect(listed.templates.some((template) => template.id === saved.templateId)).toBe(true);

    // Criação de orçamento já com o modelo aplicado.
    const created = await createBudget({
      projectId,
      title: `Orçamento a partir de modelo ${Date.now()}`,
      bdiConfigId,
      templateId: saved.templateId,
      ...rounding,
    });
    expect(created.success).toBe(true);

    const createdRevision = await prisma.budgetRevision.findUnique({
      where: { id: created.revisionId! },
      include: { stages: { include: { items: true } } },
    });
    expect(createdRevision?.stages.length).toBe(2);
    const createdItems = createdRevision!.stages.flatMap((stage) => stage.items);
    expect(createdItems.length).toBe(1);
    expect(new Decimal(createdItems[0].subtotal.toString()).toNumber()).toBe(200);
    expect(new Decimal(createdItems[0].subtotalWithBdi.toString()).toNumber()).toBe(250);

    // Aplicação em outra revisão existente (sem duplicar a estrutura padrão).
    const target = await createBaseBudget(`Orçamento destino modelo ${Date.now()}`);
    const applied = await applyBudgetTemplate({
      revisionId: target.revisionId!,
      templateId: saved.templateId!,
    });
    expect(applied.success).toBe(true);

    const targetRevision = await prisma.budgetRevision.findUnique({
      where: { id: target.revisionId! },
      include: { stages: true },
    });
    expect(targetRevision?.stages.length).toBe(3); // padrão + raiz do modelo + subetapa
  });

  // ==========================================================================
  // ETAPA 7
  // ==========================================================================

  it("duplica composição preservando origem, componentes e rastreabilidade", async () => {
    const duplicated = await duplicateCompositionAction({ compositionId });
    expect(duplicated.success).toBe(true);
    expect(duplicated.compositionId).toBeDefined();

    const copy = await prisma.composition.findUnique({
      where: { id: duplicated.compositionId! },
      include: { components: true },
    });

    expect(copy?.originCompositionId).toBe(compositionId);
    expect(copy?.components.length).toBe(2);
    expect(copy?.source).toBe("CUSTOM");
    expect(copy?.sourceState).toBe("SP");
    expect(copy?.sourceMonth).toBe("2024/01");
    expect(copy?.code).not.toBe((await prisma.composition.findUnique({
      where: { id: compositionId },
    }))?.code);

    // Custo idêntico ao original.
    const details = await getCompositionDetailsAction(duplicated.compositionId!);
    expect(details.success).toBe(true);
    expect(Number(details.composition!.calculation.unitCost.total)).toBe(50);
  });

  it("bloqueia ciclos em composições auxiliares, inclusive auto-referência", async () => {
    const parent = await createCompositionAction({
      code: `PAI-${Date.now()}`,
      description: "Composição pai",
      unit: "un",
      source: "CUSTOM",
      sourceState: "SP",
      sourceMonth: "2024/01",
      sourceTaxRegime: "DESONERADO",
      type: "ANALYTICAL",
      closedTotalPrice: null,
      closedMaterialPrice: null,
      closedLaborPrice: null,
      closedEquipmentPrice: null,
      closedOtherPrice: null,
      notes: null,
    });
    const child = await createCompositionAction({
      code: `FILHA-${Date.now()}`,
      description: "Composição filha",
      unit: "un",
      source: "CUSTOM",
      sourceState: "SP",
      sourceMonth: "2024/01",
      sourceTaxRegime: "DESONERADO",
      type: "ANALYTICAL",
      closedTotalPrice: null,
      closedMaterialPrice: null,
      closedLaborPrice: null,
      closedEquipmentPrice: null,
      closedOtherPrice: null,
      notes: null,
    });

    expect(parent.success && child.success).toBe(true);

    const link = await addCompositionComponentAction({
      compositionId: child.compositionId!,
      childCompositionId: parent.compositionId!,
      resourceId: null,
      coefficient: "1.00000",
      notes: null,
    });
    expect(link.success).toBe(true);

    const cycle = await addCompositionComponentAction({
      compositionId: parent.compositionId!,
      childCompositionId: child.compositionId!,
      resourceId: null,
      coefficient: "1.00000",
      notes: null,
    });
    expect(cycle.success).toBe(false);
    expect(cycle.error).toContain("ciclo");

    const self = await addCompositionComponentAction({
      compositionId: child.compositionId!,
      childCompositionId: child.compositionId!,
      resourceId: null,
      coefficient: "1.00000",
      notes: null,
    });
    expect(self.success).toBe(false);
    expect(self.error).toContain("ciclo");
  });

  it("exige equivalência confirmada e calcula impacto antes/depois corretamente", async () => {
    const alternative = await prisma.resource.create({
      data: {
        userId: testUserId,
        code: `MAT-ALT-${Date.now()}`,
        description: "Material alternativo equivalente",
        unit: "m³",
        category: "MATERIAL",
        price: "12.0000",
        priceDate: new Date(),
        source: "CUSTOM",
      },
    });

    const component = await prisma.compositionComponent.findFirst({
      where: { compositionId, resourceId: materialId },
    });
    expect(component).toBeDefined();

    const equivalence = await createResourceEquivalenceAction({
      sourceResourceId: materialId,
      targetResourceId: alternative.id,
      justification: "Mesma especificação técnica",
    });
    expect(equivalence.success).toBe(true);
    expect(equivalence.equivalenceId).toBeDefined();

    // Não confirmada: simulação e substituição devem ser bloqueadas.
    const blockedSimulation = await simulateResourceReplacementAction({
      compositionId,
      componentId: component!.id,
      targetResourceId: alternative.id,
    });
    expect(blockedSimulation.success).toBe(false);
    expect(blockedSimulation.error).toContain("não está confirmada");

    const blockedReplacement = await replaceComponentResourceAction({
      compositionId,
      componentId: component!.id,
      targetResourceId: alternative.id,
    });
    expect(blockedReplacement.success).toBe(false);

    const confirmed = await confirmResourceEquivalenceAction({
      equivalenceId: equivalence.equivalenceId!,
      justification: "Confirmada pelo engenheiro responsável",
    });
    expect(confirmed.success).toBe(true);

    // Antes: 2×10 + 1,5×20 = 50. Depois: 2×12 + 1,5×20 = 54. Impacto: +4.
    const simulation = await simulateResourceReplacementAction({
      compositionId,
      componentId: component!.id,
      targetResourceId: alternative.id,
    });
    expect(simulation.success).toBe(true);
    expect(Number(simulation.simulation!.before.total)).toBe(50);
    expect(Number(simulation.simulation!.after.total)).toBe(54);
    expect(Number(simulation.simulation!.diff.total)).toBe(4);

    const replaced = await replaceComponentResourceAction({
      compositionId,
      componentId: component!.id,
      targetResourceId: alternative.id,
    });
    expect(replaced.success).toBe(true);
    expect(Number(replaced.after!.total)).toBe(54);
    expect(Number(replaced.diff!.total)).toBe(4);

    const details = await getCompositionDetailsAction(compositionId);
    expect(details.success).toBe(true);
    expect(Number(details.composition!.calculation.unitCost.total)).toBe(54);

    const updatedComponent = await prisma.compositionComponent.findUnique({
      where: { id: component!.id },
    });
    expect(updatedComponent?.resourceId).toBe(alternative.id);
  });

  it("cria composição própria dentro do orçamento com inclusão imediata do item", async () => {
    const budget = await createBaseBudget(`Orçamento composição imediata ${Date.now()}`);
    const stage = await prisma.stage.findFirst({
      where: { budgetRevisionId: budget.revisionId! },
    });

    const closed = await createCompositionInBudgetAction({
      stageId: stage!.id,
      composition: {
        code: `NOVA-FECHADA-${Date.now()}`,
        description: "Serviço fechado criado no orçamento",
        unit: "un",
        source: "CUSTOM",
        sourceState: "SP",
        sourceMonth: "2024/01",
        sourceTaxRegime: "DESONERADO",
        type: "CLOSED",
        closedTotalPrice: 25,
        closedMaterialPrice: null,
        closedLaborPrice: null,
        closedEquipmentPrice: null,
        closedOtherPrice: null,
        notes: null,
      },
      quantity: "4.0000",
    });

    expect(closed.success).toBe(true);
    expect(closed.itemId).toBeDefined();

    const item = await prisma.budgetItem.findUnique({
      where: { id: closed.itemId! },
      include: { composition: true },
    });
    expect(item?.compositionId).toBe(closed.compositionId);
    expect(item?.stageId).toBe(stage!.id);
    expect(new Decimal(item!.subtotal.toString()).toNumber()).toBe(100);
    expect(new Decimal(item!.subtotalWithBdi.toString()).toNumber()).toBe(125);

    // Composição analítica com insumo, também incluída imediatamente.
    const analytical = await createCompositionInBudgetAction({
      stageId: stage!.id,
      composition: {
        code: `NOVA-ANALITICA-${Date.now()}`,
        description: "Serviço analítico criado no orçamento",
        unit: "m³",
        source: "CUSTOM",
        sourceState: "SP",
        sourceMonth: "2024/01",
        sourceTaxRegime: "DESONERADO",
        type: "ANALYTICAL",
        closedTotalPrice: null,
        closedMaterialPrice: null,
        closedLaborPrice: null,
        closedEquipmentPrice: null,
        closedOtherPrice: null,
        notes: null,
      },
      components: [
        {
          compositionId: "pending",
          resourceId: materialId,
          childCompositionId: null,
          coefficient: "3.00000",
          notes: null,
        },
      ],
      quantity: "2.0000",
    });

    expect(analytical.success).toBe(true);
    const analyticalItem = await prisma.budgetItem.findUnique({
      where: { id: analytical.itemId! },
    });
    // 3 × 10 = 30 por unidade; 2 × 30 = 60; com BDI 25% = 75.
    expect(new Decimal(analyticalItem!.subtotal.toString()).toNumber()).toBe(60);
    expect(new Decimal(analyticalItem!.subtotalWithBdi.toString()).toNumber()).toBe(75);
  });

  it("atualiza coeficiente de componente e reflete no custo", async () => {
    const component = await prisma.compositionComponent.findFirst({
      where: { compositionId, resourceId: laborId },
    });

    const updated = await updateCompositionComponentAction({
      componentId: component!.id,
      coefficient: "2.00000",
    });
    expect(updated.success).toBe(true);

    const details = await getCompositionDetailsAction(compositionId);
    // 2×10 + 2×20 = 60.
    expect(Number(details.composition!.calculation.unitCost.total)).toBe(60);
  });
});
