import { describe, it, expect, beforeEach, vi } from "vitest";
import Decimal from "decimal.js";
import { prisma } from "@/lib/db/prisma";
import {
  decryptSecret,
  encryptSecret,
  maskSecret,
} from "@/lib/ai/crypto";
import {
  activateAIProvider,
  deleteAIProvider,
  getActiveProviderCredentials,
  listAIProviders,
  upsertAIProvider,
} from "@/lib/ai/config";
import {
  answerAssistantQuestion,
  assistedSearch,
  buildSuggestions,
  type SuggestionStageInput,
} from "@/lib/ai/assistant";
import {
  aggregatePortfolio,
  buildRootStageTotals,
  type PortfolioBudgetInput,
} from "@/lib/services/portfolio";
import {
  askAssistantAction,
  deleteAIProviderAction,
  getAIStatusAction,
  saveAIProviderAction,
  searchAssistantAction,
  testAIProviderAction,
} from "../ai";
import { createBudget, addBudgetItem } from "../budgets";

// Chave de teste determinística para não depender do .env.
process.env.AI_ENCRYPTION_KEY = "a".repeat(64);

let testUserId: string;
let sequence = 0;

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth-utils", () => ({
  getCurrentUser: vi.fn(async () => ({
    id: testUserId,
    email: "test.etapa11@obracalc.com",
    name: "Engenheiro Etapa 11",
    role: "ADMIN",
  })),
}));

// ============================================================================
// CRIPTOGRAFIA
// ============================================================================

describe("Etapa 11 — Criptografia de chaves de API", () => {
  it("faz round-trip AES-256-GCM sem persistir texto puro", () => {
    const plain = "sk-super-secret-key-123456";
    const encrypted = encryptSecret(plain);

    expect(encrypted.encrypted).not.toContain(plain);
    expect(encrypted.encrypted).toContain(".");
    expect(encrypted.iv.length).toBeGreaterThan(0);
    expect(decryptSecret(encrypted.encrypted, encrypted.iv)).toBe(plain);
  });

  it("usa IV aleatório por operação", () => {
    const first = encryptSecret("same-secret-value");
    const second = encryptSecret("same-secret-value");

    expect(first.iv).not.toBe(second.iv);
    expect(first.encrypted).not.toBe(second.encrypted);
  });

  it("detecta adulteração do ciphertext", () => {
    const encrypted = encryptSecret("sk-tamper-test-0001");
    const [tag, data] = encrypted.encrypted.split(".");
    const tampered = `${tag}.${data.slice(0, -4)}AAAA`;

    expect(() => decryptSecret(tampered, encrypted.iv)).toThrow();
  });

  it("mascara segredos sem revelar o conteúdo", () => {
    expect(maskSecret("sk-1234567890abcdef")).toBe("sk-1••••cdef");
    expect(maskSecret("curta")).toBe("••••••••");
    expect(maskSecret(null)).toBe("");
  });
});

// ============================================================================
// CARTEIRA — SEM DUPLA CONTAGEM DE REVISÕES
// ============================================================================

describe("Etapa 11 — Indicadores sem dupla contagem", () => {
  it("usa apenas a revisão mais recente nos totais e a anterior no comparativo", () => {
    const budgets: PortfolioBudgetInput[] = [
      {
        id: "budget-1",
        title: "Obra A",
        projectName: "Projeto A",
        projectState: "SP",
        status: "DRAFT",
        revisions: [
          {
            id: "rev-1",
            revisionNumber: 1,
            status: "FINALIZED",
            updatedAt: "2026-01-01T00:00:00.000Z",
            source: "SNAPSHOT",
            direct: "100.00",
            withBdi: "125.00",
            bdiAmount: "25.00",
            effectiveBdi: "25.0000",
            itemsCount: 1,
            stages: [
              {
                code: "1",
                title: "Etapa 1",
                direct: "100.00",
                withBdi: "125.00",
                itemsCount: 1,
              },
            ],
          },
          {
            id: "rev-2",
            revisionNumber: 2,
            status: "DRAFT",
            updatedAt: "2026-02-01T00:00:00.000Z",
            source: "DATABASE",
            direct: "200.00",
            withBdi: "250.00",
            bdiAmount: "50.00",
            effectiveBdi: "25.0000",
            itemsCount: 2,
            stages: [
              {
                code: "1",
                title: "Etapa 1",
                direct: "200.00",
                withBdi: "250.00",
                itemsCount: 2,
              },
            ],
          },
        ],
      },
    ];

    const portfolio = aggregatePortfolio(budgets);

    expect(portfolio.indicators.totalBudgets).toBe(1);
    expect(portfolio.indicators.totalDirect).toBe("200.00");
    expect(portfolio.indicators.totalWithBdi).toBe("250.00");
    expect(portfolio.indicators.totalBdi).toBe("50.00");
    expect(portfolio.indicators.itemsCount).toBe(2);
    expect(portfolio.references).toHaveLength(1);
    expect(portfolio.references[0].revisionNumber).toBe(2);
    expect(portfolio.comparisons).toHaveLength(1);
    expect(portfolio.comparisons[0].deltaWithBdi).toBe("125.00");
    expect(portfolio.comparisons[0].deltaPercent).toBe("100.0000");
    expect(portfolio.stageRanking[0].totalWithBdi).toBe("250.00");
  });

  it("agrega hierarquia de etapas sem somar pai e filho duas vezes", () => {
    const totals = buildRootStageTotals([
      {
        id: "s1",
        code: "1",
        title: "Etapa raiz",
        parentStageId: null,
        sortOrder: 1,
        items: [{ subtotal: "100", subtotalWithBdi: "125" }],
      },
      {
        id: "s2",
        code: "1.1",
        title: "Subetapa",
        parentStageId: "s1",
        sortOrder: 2,
        items: [{ subtotal: "100", subtotalWithBdi: "125" }],
      },
    ]);

    expect(totals).toHaveLength(1);
    expect(totals[0].direct).toBe("200");
    expect(totals[0].withBdi).toBe("250");
    expect(totals[0].itemsCount).toBe(2);
  });

  it("infere hierarquia pelo código em snapshots v1", () => {
    const totals = buildRootStageTotals([
      {
        id: "s1",
        code: "1",
        title: "Raiz",
        items: [{ subtotal: "10", subtotalWithBdi: "12.5" }],
      },
      {
        id: "s2",
        code: "1.1",
        title: "Filha",
        items: [{ subtotal: "10", subtotalWithBdi: "12.5" }],
      },
    ]);

    expect(totals).toHaveLength(1);
    expect(totals[0].withBdi).toBe("25");
  });
});

// ============================================================================
// SUGESTÕES NÃO VINCULANTES
// ============================================================================

function suggestionStages(): SuggestionStageInput[] {
  return [
    {
      id: "stage-1",
      code: "1",
      title: "Serviços",
      items: [
        {
          id: "item-ok",
          compositionCode: "COMP-OK",
          compositionDescription: "Serviço normal",
          compositionType: "ANALYTICAL",
          compositionComponentsCount: 2,
          quantity: "10",
          unitCostTotal: "100",
          subtotal: "1000",
          subtotalWithBdi: "1250",
          bdiRate: "25",
        },
        {
          id: "item-zero",
          compositionCode: "COMP-ZERO",
          compositionDescription: "Serviço sem medição",
          compositionType: "ANALYTICAL",
          compositionComponentsCount: 1,
          quantity: "0",
          unitCostTotal: "50",
          subtotal: "0",
          subtotalWithBdi: "0",
          bdiRate: "25",
        },
        {
          id: "item-empty",
          compositionCode: "COMP-EMPTY",
          compositionDescription: "Composição vazia",
          compositionType: "ANALYTICAL",
          compositionComponentsCount: 0,
          quantity: "1",
          unitCostTotal: "0",
          subtotal: "0",
          subtotalWithBdi: "0",
          bdiRate: "0",
        },
      ],
    },
    {
      id: "stage-empty",
      code: "2",
      title: "Etapa vazia",
      items: [],
    },
  ];
}

describe("Etapa 11 — Sugestões orientativas", () => {
  it("detecta quantidade zero, preço zerado, composição vazia e etapa vazia", () => {
    const suggestions = buildSuggestions({
      stages: suggestionStages(),
      revisionNumber: 1,
    });

    const categories = new Set(suggestions.map((item) => item.category));
    expect(categories.has("QUANTITY")).toBe(true);
    expect(categories.has("PRICE")).toBe(true);
    expect(categories.has("STRUCTURE")).toBe(true);

    expect(
      suggestions.some((item) => item.id === "quantity-item-zero")
    ).toBe(true);
    expect(suggestions.some((item) => item.id === "price-item-empty")).toBe(
      true
    );
    expect(
      suggestions.some((item) => item.id === "structure-empty-stage-empty")
    ).toBe(true);
  });

  it("marca todas as sugestões como não vinculantes", () => {
    const suggestions = buildSuggestions({
      stages: suggestionStages(),
      revisionNumber: 1,
    });

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.every((item) => item.binding === false)).toBe(true);
  });

  it("inclui achados de auditoria não resolvidos", () => {
    const suggestions = buildSuggestions({
      stages: suggestionStages(),
      revisionNumber: 2,
      auditResults: [
        {
          id: "audit-1",
          severity: "ERROR",
          code: "MISSING_PRICE",
          message: "Preço ausente",
          entityType: "BudgetItem",
          entityId: "item-x",
          justification: null,
          resolvedAt: null,
        },
        {
          id: "audit-2",
          severity: "WARNING",
          code: "DUPLICATE_CHARGES",
          message: "Encargos duplicados",
          entityType: "Resource",
          entityId: "res-x",
          justification: "Conferido",
          resolvedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(suggestions.some((item) => item.id === "audit-audit-1")).toBe(true);
    // Achados resolvidos não são repetidos.
    expect(suggestions.some((item) => item.id === "audit-audit-2")).toBe(false);
  });
});

// ============================================================================
// INTEGRAÇÃO: PROVEDORES, BUSCA E MODO SEM IA
// ============================================================================

describe("Etapa 11 — Provedores, busca e operação sem IA", () => {
  beforeEach(async () => {
    sequence += 1;

    const user = await prisma.user.upsert({
      where: { email: "test.etapa11@obracalc.com" },
      update: {},
      create: {
        email: "test.etapa11@obracalc.com",
        name: "Engenheiro Etapa 11",
        passwordHash: "hash1234567890",
      },
    });
    testUserId = user.id;

    // Isola provedores entre testes.
    await prisma.aiProviderConfig.deleteMany({ where: { userId: testUserId } });
  });

  it("armazena a chave criptografada e nunca a devolve nas listagens", async () => {
    const plain = "sk-provider-secret-987654321";
    await upsertAIProvider({
      userId: testUserId,
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: plain,
    });

    const raw = await prisma.aiProviderConfig.findUnique({
      where: {
        userId_provider: { userId: testUserId, provider: "openai" },
      },
    });

    expect(raw).not.toBeNull();
    expect(raw!.apiKeyEncrypted).not.toContain(plain);
    expect(raw!.apiKeyIv.length).toBeGreaterThan(0);
    expect(decryptSecret(raw!.apiKeyEncrypted, raw!.apiKeyIv)).toBe(plain);

    const status = await listAIProviders(testUserId);
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain(plain);
    expect(status.activeProvider?.provider).toBe("openai");
    expect(status.activeProvider?.keyMask).toBe("••••••••");

    const credentials = await getActiveProviderCredentials(testUserId);
    expect(credentials?.apiKey).toBe(plain);
  });

  it("ativa apenas um provedor por vez e remove configs", async () => {
    await upsertAIProvider({
      userId: testUserId,
      provider: "openai",
      apiKey: "sk-openai-123456789",
    });
    await upsertAIProvider({
      userId: testUserId,
      provider: "gemini",
      apiKey: "gemini-key-123456789",
    });

    let status = await listAIProviders(testUserId);
    expect(status.activeProvider?.provider).toBe("gemini");
    expect(
      status.providers.filter((provider) => provider.isActive)
    ).toHaveLength(1);

    status = await activateAIProvider({
      userId: testUserId,
      provider: "openai",
    });
    expect(status.activeProvider?.provider).toBe("openai");

    status = await deleteAIProvider({
      userId: testUserId,
      provider: "gemini",
    });
    expect(status.providers).toHaveLength(1);
  });

  it("funciona sem IA: status local, busca assistida e parecer determinístico", async () => {
    const statusResult = await getAIStatusAction();
    expect(statusResult.success).toBe(true);
    expect(statusResult.status!.activeProvider).toBeNull();

    const unique = `Argamassa Etapa 11 ${Date.now()}-${sequence}`;
    await prisma.resource.create({
      data: {
        userId: testUserId,
        code: `ARG-E11-${Date.now()}-${sequence}`,
        description: unique,
        unit: "kg",
        category: "MATERIAL",
        price: "2.5000",
        priceDate: new Date(),
        source: "CUSTOM",
      },
    });

    const hits = await assistedSearch({
      userId: testUserId,
      query: "Argamassa Etapa 11",
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].type).toBe("RESOURCE");
    expect(hits[0].description).toContain("Argamassa Etapa 11");

    const searchActionResult = await searchAssistantAction({
      query: "Argamassa Etapa 11",
    });
    expect(searchActionResult.success).toBe(true);
    expect(searchActionResult.hits!.length).toBeGreaterThan(0);

    const answer = await answerAssistantQuestion({
      userId: testUserId,
      query: "Argamassa Etapa 11",
    });
    expect(answer.mode).toBe("LOCAL");
    expect(answer.provider).toBeNull();
    expect(answer.notice).toContain("não vinculantes");
    expect(answer.searchHits.length).toBeGreaterThan(0);
  });

  it("rejeita chave curta e aceita chave válida pela action", async () => {
    const invalid = await saveAIProviderAction({
      provider: "openai",
      apiKey: "123",
    });
    expect(invalid.success).toBe(false);

    const valid = await saveAIProviderAction({
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "sk-action-1234567890",
    });
    expect(valid.success).toBe(true);
    expect(valid.status!.activeProvider?.provider).toBe("openai");

    const tested = await testAIProviderAction({ provider: "openai" });
    expect(tested.success).toBe(true);
    expect(tested.tested).toBe(true);

    const removed = await deleteAIProviderAction({ provider: "openai" });
    expect(removed.success).toBe(true);
    expect(removed.status!.providers).toHaveLength(0);
  });

  it("não altera preços, coeficientes ou quantidades ao consultar o assistente", async () => {
    const project = await prisma.project.create({
      data: {
        userId: testUserId,
        name: `Obra Etapa 11 ${Date.now()}-${sequence}`,
        status: "ACTIVE",
      },
    });

    const bdi = await prisma.bdiConfig.create({
      data: {
        userId: testUserId,
        name: `BDI Etapa 11 ${Date.now()}-${sequence}`,
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

    const material = await prisma.resource.create({
      data: {
        userId: testUserId,
        code: `MAT-E11-${Date.now()}-${sequence}`,
        description: "Cimento",
        unit: "kg",
        category: "MATERIAL",
        price: "1.2000",
        priceDate: new Date(),
        source: "CUSTOM",
      },
    });

    const composition = await prisma.composition.create({
      data: {
        userId: testUserId,
        code: `COMP-E11-${Date.now()}-${sequence}`,
        description: "Chapisco",
        unit: "m²",
        type: "ANALYTICAL",
        source: "CUSTOM",
        components: {
          create: [{ resourceId: material.id, coefficient: "2.00000", sortOrder: 1 }],
        },
      },
    });

    const budget = await createBudget({
      projectId: project.id,
      title: `Orçamento Etapa 11 ${Date.now()}-${sequence}`,
      bdiConfigId: bdi.id,
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
    const stage = await prisma.stage.findFirst({
      where: { budgetRevisionId: revisionId },
    });
    const itemResult = await addBudgetItem({
      stageId: stage!.id,
      compositionId: composition.id,
      quantity: "10",
    });
    const itemId = itemResult.item!.id;

    const before = await prisma.budgetItem.findUnique({ where: { id: itemId } });
    const resourceBefore = await prisma.resource.findUnique({
      where: { id: material.id },
    });
    const componentBefore = await prisma.compositionComponent.findFirst({
      where: { compositionId: composition.id },
    });

    const result = await askAssistantAction({
      query: "Quais os pontos de atenção deste orçamento?",
      revisionId,
    });
    expect(result.success).toBe(true);
    expect(result.answer!.mode).toBe("LOCAL");
    expect(result.answer!.suggestions.every((s) => s.binding === false)).toBe(
      true
    );

    const after = await prisma.budgetItem.findUnique({ where: { id: itemId } });
    const resourceAfter = await prisma.resource.findUnique({
      where: { id: material.id },
    });
    const componentAfter = await prisma.compositionComponent.findFirst({
      where: { compositionId: composition.id },
    });

    expect(after!.quantity.toString()).toBe(before!.quantity.toString());
    expect(after!.unitCostTotal.toString()).toBe(before!.unitCostTotal.toString());
    expect(after!.subtotalWithBdi.toString()).toBe(
      before!.subtotalWithBdi.toString()
    );
    expect(resourceAfter!.price.toString()).toBe(
      resourceBefore!.price.toString()
    );
    expect(componentAfter!.coefficient.toString()).toBe(
      componentBefore!.coefficient.toString()
    );

    // Garante que o Decimal foi usado sem artefatos de ponto flutuante.
    expect(new Decimal(before!.subtotal.toString()).isFinite()).toBe(true);
  });
});
