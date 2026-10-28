import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  createResource,
  updateResourcePrice,
  createComposition,
} from "../reference-data";
import {
  createBudget,
  addBudgetStage,
  addBudgetItem,
} from "../budget";
import {
  createRevisionSnapshot,
  verifySnapshotIntegrity,
  assertRevisionMutable,
  RevisionFinalizedError,
} from "../snapshot";
import {
  DatabaseSource,
  TaxRegime,
  ResourceCategory,
  CompositionType,
} from "@prisma/client";
import Decimal from "decimal.js";

describe("Entidades, Integridade Referencial, Múltiplas Competências e Snapshots", () => {
  const runId = Math.random().toString(36).substring(2, 8);
  let testUserId: string;
  let testClientId: string;
  let testProjectId: string;
  let testBdiConfigId: string;
  let testSupplierId: string;
  let testUnitId: string;

  const cleanupUserData = async (userId: string) => {
    try {
      await prisma.budgetItem.deleteMany({
        where: { stage: { budgetRevision: { budget: { userId } } } },
      });
      await prisma.stage.deleteMany({
        where: { budgetRevision: { budget: { userId } } },
      });
      await prisma.revisionSnapshot.deleteMany({
        where: { budgetRevision: { budget: { userId } } },
      });
      await prisma.budgetRevision.deleteMany({
        where: { budget: { userId } },
      });
      await prisma.budget.deleteMany({ where: { userId } });
      await prisma.compositionComponent.deleteMany({
        where: { composition: { userId } },
      });
      await prisma.composition.deleteMany({ where: { userId } });
      await prisma.resourcePriceHistory.deleteMany({
        where: { resource: { userId } },
      });
      await prisma.resource.deleteMany({ where: { userId } });
      await prisma.referenceDatabase.deleteMany({ where: { userId } });
      await prisma.project.deleteMany({ where: { userId } });
      await prisma.client.deleteMany({ where: { userId } });
      await prisma.bdiConfig.deleteMany({ where: { userId } });
      await prisma.supplier.deleteMany({ where: { userId } });
      await prisma.auditEntry.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
    } catch {
      // Ignora se não existir
    }
  };

  beforeAll(async () => {
    // 1. Criar usuário com email único para este run de teste
    const user = await prisma.user.create({
      data: {
        email: `test-${runId}@obracalc.local`,
        name: "Engenheiro Teste Entidades",
        passwordHash: "$2a$12$fakeHashForTestPurposesOnly1234567890abcdefgh",
      },
    });
    testUserId = user.id;

    // 2. Criar fornecedor
    const supplier = await prisma.supplier.create({
      data: {
        userId: testUserId,
        name: `Distribuidora ${runId} Ltda`,
        document: "11.222.333/0001-44",
        email: `vendas-${runId}@distribuidora.com.br`,
        phone: "(11) 3333-4444",
      },
    });
    testSupplierId = supplier.id;

    // 3. Criar unidade de medida (se não existir)
    const unit = await prisma.unit.upsert({
      where: { symbol: "kg" },
      update: {},
      create: {
        symbol: "kg",
        name: "quilograma",
        dimension: "MASS",
      },
    });
    testUnitId = unit.id;

    // 4. Criar cliente e obra
    const client = await prisma.client.create({
      data: {
        userId: testUserId,
        name: `Prefeitura Municipal ${runId}`,
        document: "44.555.666/0001-77",
      },
    });
    testClientId = client.id;

    const project = await prisma.project.create({
      data: {
        userId: testUserId,
        clientId: testClientId,
        name: `Construção de Hospital Municipal ${runId}`,
        city: "São Paulo",
        state: "SP",
      },
    });
    testProjectId = project.id;

    // 5. Criar configuração de BDI
    const bdi = await prisma.bdiConfig.create({
      data: {
        userId: testUserId,
        name: `BDI Edifícios TCU ${runId}`,
        ac: new Decimal(0.04), // 4%
        cf: new Decimal(0.0123),
        s: new Decimal(0.004),
        g: new Decimal(0.004),
        mi: new Decimal(0.0127),
        tm: new Decimal(0.025),
        te: new Decimal(0),
        tf: new Decimal(0.0365),
        l: new Decimal(0.074),
        bdiRate: new Decimal(22.12),
        isDefault: true,
      },
    });
    testBdiConfigId = bdi.id;
  });

  afterAll(async () => {
    if (testUserId) {
      await cleanupUserData(testUserId);
    }
    // Também limpa o usuário estático anterior se sobrou
    const oldUser = await prisma.user.findUnique({
      where: { email: "test-entities@obracalc.local" },
    });
    if (oldUser) {
      await cleanupUserData(oldUser.id);
    }
  });

  // =========================================================================
  // CRITÉRIO 1: Testes de Relações e Integridade Referencial
  // =========================================================================
  it("deve criar e navegar por toda a cadeia referencial: Banco -> Insumo -> Composição -> Componentes -> Orçamento -> Etapas -> Itens", async () => {
    // 1. Criar Banco de Referência
    const refDb = await prisma.referenceDatabase.create({
      data: {
        userId: testUserId,
        name: "SINAPI SP 2024/01 Desonerado",
        source: DatabaseSource.SINAPI,
        state: "SP",
        referenceMonth: "2024/01",
        taxRegime: TaxRegime.DESONERADO,
        version: "1.0",
      },
    });
    expect(refDb.id).toBeDefined();

    // 2. Criar Insumos vinculados
    const resAco = await createResource({
      userId: testUserId,
      referenceDatabaseId: refDb.id,
      code: "INS-4010",
      description: "Aço CA-50 10.0mm",
      unit: "kg",
      category: ResourceCategory.MATERIAL,
      source: DatabaseSource.SINAPI,
      sourceState: "SP",
      sourceMonth: "2024/01",
      sourceTaxRegime: TaxRegime.DESONERADO,
      price: "7.5000",
      supplierId: testSupplierId,
    });
    expect(resAco.id).toBeDefined();

    const resPedreiro = await createResource({
      userId: testUserId,
      referenceDatabaseId: refDb.id,
      code: "INS-88309",
      description: "Pedreiro com encargos sociais",
      unit: "h",
      category: ResourceCategory.LABOR,
      source: DatabaseSource.SINAPI,
      sourceState: "SP",
      sourceMonth: "2024/01",
      sourceTaxRegime: TaxRegime.DESONERADO,
      price: "24.5000",
      laborChargesIncluded: true,
    });
    expect(resPedreiro.id).toBeDefined();

    // 3. Criar Subcomposição Auxiliar (Armador + Ajudante)
    const subComp = await createComposition({
      userId: testUserId,
      referenceDatabaseId: refDb.id,
      code: "COMP-AUX-01",
      description: "Corte e dobra de armadura",
      unit: "kg",
      source: DatabaseSource.SINAPI,
      sourceState: "SP",
      sourceMonth: "2024/01",
      sourceTaxRegime: TaxRegime.DESONERADO,
      type: CompositionType.ANALYTICAL,
      components: [
        {
          resourceId: resAco.id,
          coefficient: "1.05000", // 5% de perda
          sortOrder: 1,
        },
      ],
    });
    expect(subComp?.id).toBeDefined();

    // 4. Criar Composição Principal Analítica referenciando Insumo Direto E Subcomposição Auxiliar
    const mainComp = await createComposition({
      userId: testUserId,
      referenceDatabaseId: refDb.id,
      code: "COMP-MAIN-01",
      description: "Estrutura de pilar em concreto armado",
      unit: "m³",
      source: DatabaseSource.SINAPI,
      sourceState: "SP",
      sourceMonth: "2024/01",
      sourceTaxRegime: TaxRegime.DESONERADO,
      type: CompositionType.ANALYTICAL,
      components: [
        {
          resourceId: resPedreiro.id,
          coefficient: "8.00000",
          sortOrder: 1,
        },
        {
          childCompositionId: subComp!.id,
          coefficient: "80.00000",
          sortOrder: 2,
        },
      ],
    });
    expect(mainComp?.components.length).toBe(2);

    // 5. Criar Orçamento e Revisão 1
    const { budget, revision } = await createBudget({
      userId: testUserId,
      projectId: testProjectId,
      title: "Orçamento Executivo Bloco Cirúrgico",
      referenceDatabaseId: refDb.id,
      referenceState: "SP",
      referenceMonth: "2024/01",
      bdiConfigId: testBdiConfigId,
    });
    expect(budget.id).toBeDefined();
    expect(revision.revisionNumber).toBe(1);
    expect(revision.status).toBe("DRAFT");

    // 6. Criar Hierarquia de Etapas (Pai e Filha)
    const stagePai = await addBudgetStage({
      budgetRevisionId: revision.id,
      code: "1",
      title: "Superestrutura",
      sortOrder: 1,
    });

    const stageFilha = await addBudgetStage({
      budgetRevisionId: revision.id,
      code: "1.1",
      title: "Pilares e Vigas",
      parentStageId: stagePai.id,
      sortOrder: 1,
    });
    expect(stageFilha.parentStageId).toBe(stagePai.id);

    // 7. Adicionar Item de Orçamento
    const item = await addBudgetItem({
      budgetRevisionId: revision.id,
      stageId: stageFilha.id,
      compositionId: mainComp!.id,
      quantity: "15.0000",
      unitCostTotal: "1250.0000",
      subtotal: "18750.00",
      bdiRate: "22.12",
      subtotalWithBdi: "22897.50",
    });
    expect(item.id).toBeDefined();

    // 8. Testar navegação profunda e integridade referencial via Prisma query
    const queriedRevision = await prisma.budgetRevision.findUnique({
      where: { id: revision.id },
      include: {
        budget: {
          include: {
            project: {
              include: { client: true },
            },
          },
        },
        bdiConfig: true,
        referenceDatabase: true,
        stages: {
          where: { parentStageId: null },
          include: {
            childStages: {
              include: {
                items: {
                  include: {
                    composition: {
                      include: {
                        components: {
                          include: {
                            resource: true,
                            childComposition: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    expect(queriedRevision?.budget.project.client?.name).toBe(`Prefeitura Municipal ${runId}`);
    expect(queriedRevision?.stages[0].childStages[0].items[0].composition.code).toBe("COMP-MAIN-01");
    expect(queriedRevision?.stages[0].childStages[0].items[0].composition.components.length).toBe(2);
  });

  // =========================================================================
  // CRITÉRIO 2: Múltiplas Competências, Unicidade Contextual e Histórico
  // =========================================================================
  it("deve permitir mesmo código de insumo em múltiplas competências com preços distintos e registrar histórico", async () => {
    // 1. Criar insumo no mês 2024/01
    const resJan = await createResource({
      userId: testUserId,
      code: "SINAPI-88316",
      description: "Servente com encargos sociais",
      unit: "h",
      category: ResourceCategory.LABOR,
      source: DatabaseSource.SINAPI,
      sourceState: "SP",
      sourceMonth: "2024/01",
      sourceTaxRegime: TaxRegime.DESONERADO,
      price: "18.5000",
    });

    // 2. Criar mesmo código no mês 2024/02 com preço reajustado
    const resFev = await createResource({
      userId: testUserId,
      code: "SINAPI-88316",
      description: "Servente com encargos sociais",
      unit: "h",
      category: ResourceCategory.LABOR,
      source: DatabaseSource.SINAPI,
      sourceState: "SP",
      sourceMonth: "2024/02",
      sourceTaxRegime: TaxRegime.DESONERADO,
      price: "19.8000",
    });

    expect(resJan.id).not.toBe(resFev.id);
    expect(resJan.price.toString()).toBe("18.5");
    expect(resFev.price.toString()).toBe("19.8");
    expect(resJan.sourceMonth).toBe("2024/01");
    expect(resFev.sourceMonth).toBe("2024/02");

    // 3. Provar que a unicidade contextual barra duplicidade exatamente na mesma competência/estado/regime
    await expect(
      createResource({
        userId: testUserId,
        code: "SINAPI-88316",
        description: "Servente duplicado indevido",
        unit: "h",
        category: ResourceCategory.LABOR,
        source: DatabaseSource.SINAPI,
        sourceState: "SP",
        sourceMonth: "2024/01",
        sourceTaxRegime: TaxRegime.DESONERADO,
        price: "99.0000",
      })
    ).rejects.toThrow();

    // 4. Atualizar preço na competência 2024/02 e verificar registro em ResourcePriceHistory
    const updateResult = await updateResourcePrice({
      resourceId: resFev.id,
      userId: testUserId,
      newPrice: "20.5000",
      reason: "Dissídio coletivo da categoria aprovado",
      author: "Eng. Responsável Teste",
      effectiveDate: new Date("2024-02-15"),
    });

    expect(updateResult.resource.price.toString()).toBe("20.5");
    expect(updateResult.historyEntry.price.toString()).toBe("20.5");
    expect(updateResult.historyEntry.reason).toBe("Dissídio coletivo da categoria aprovado");

    // Verificar histórico completo
    const historyList = await prisma.resourcePriceHistory.findMany({
      where: { resourceId: resFev.id },
      orderBy: { createdAt: "asc" },
    });
    expect(historyList.length).toBe(2);
    expect(historyList[0].price.toString()).toBe("19.8"); // preço inicial
    expect(historyList[1].price.toString()).toBe("20.5"); // preço atualizado
  });

  // =========================================================================
  // CRITÉRIO 3: Imutabilidade de Snapshots e Verificação de Checksum SHA-256
  // =========================================================================
  it("deve criar snapshot imutável com checksum SHA-256, validar integridade e bloquear mutações em revisões finalizadas", async () => {
    // 1. Criar novo orçamento para teste de finalização
    const { budget, revision } = await createBudget({
      userId: testUserId,
      projectId: testProjectId,
      title: "Orçamento Auditado Para Snapshot",
      referenceState: "SP",
      referenceMonth: "2024/01",
      bdiConfigId: testBdiConfigId,
    });

    // 2. Criar etapa e item
    const stage = await addBudgetStage({
      budgetRevisionId: revision.id,
      code: "1",
      title: "Movimentação de Terra",
    });

    const comp = await createComposition({
      userId: testUserId,
      code: "ESC-01",
      description: "Escavação manual de valas",
      unit: "m³",
      type: CompositionType.CLOSED,
      closedTotalPrice: "65.0000",
    });

    await addBudgetItem({
      budgetRevisionId: revision.id,
      stageId: stage.id,
      compositionId: comp!.id,
      quantity: "50.0000",
      unitCostTotal: "65.0000",
      subtotal: "3250.00",
      bdiRate: "22.12",
      subtotalWithBdi: "3968.90",
    });

    // 3. Gerar Snapshot e Finalizar Revisão
    const snapshot = await createRevisionSnapshot(revision.id, testUserId);
    expect(snapshot.id).toBeDefined();
    expect(snapshot.checksum).toHaveLength(64); // SHA-256 hex string

    // 4. Verificar se a revisão mudou de estado para FINALIZED
    const updatedRev = await prisma.budgetRevision.findUnique({
      where: { id: revision.id },
    });
    expect(updatedRev?.status).toBe("FINALIZED");
    expect(updatedRev?.finalizedAt).toBeInstanceOf(Date);

    // 5. Validar integridade matemática do snapshot
    const integrityCheck = await verifySnapshotIntegrity(snapshot.id);
    expect(integrityCheck.isValid).toBe(true);
    expect(integrityCheck.computedChecksum).toBe(snapshot.checksum);

    // 6. Testar regra de imutabilidade: tentar adicionar uma etapa na revisão finalizada deve ser BLOQUEADO
    await expect(
      addBudgetStage({
        budgetRevisionId: revision.id,
        code: "2",
        title: "Etapa Não Permitida Pós Finalização",
      })
    ).rejects.toThrow(RevisionFinalizedError);

    // 7. Testar regra de imutabilidade: tentar adicionar item na revisão finalizada deve ser BLOQUEADO
    await expect(
      addBudgetItem({
        budgetRevisionId: revision.id,
        stageId: stage.id,
        compositionId: comp!.id,
        quantity: "10.0000",
      })
    ).rejects.toThrow(RevisionFinalizedError);

    // 8. Verificar que auditoria registrou a finalização
    const audit = await prisma.auditEntry.findFirst({
      where: {
        userId: testUserId,
        entityType: "BudgetRevision",
        entityId: revision.id,
        action: "FINALIZE",
      },
    });
    expect(audit).toBeDefined();
    expect(audit?.action).toBe("FINALIZE");
  });
});
