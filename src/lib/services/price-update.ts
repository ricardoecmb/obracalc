import Decimal from "decimal.js";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { createAuditEntry } from "@/lib/db/audit";
import { calculateBudgetItem, calculateCompositionCost } from "@/lib/engine/calculator";
import { defaultUnitConverter } from "@/lib/engine/units";
import type { CompositionInput, Rounder } from "@/lib/engine/types";
import { loadCompositionCatalog } from "./composition-cost";
import { getRevisionRounder, recalculateRevisionCosts } from "./revision-costing";

export interface PriceUpdateInput {
  resourceId: string;
  price: string | number;
  reason?: string;
}

export interface PriceUpdateChange {
  resourceId: string;
  code: string;
  description: string;
  unit: string;
  oldPrice: string;
  newPrice: string;
  delta: string;
  deltaPercent: string;
}

export interface BudgetImpactItem {
  itemId: string;
  compositionCode: string;
  compositionDescription: string;
  quantity: string;
  unitCostBefore: string;
  unitCostAfter: string;
  subtotalBefore: string;
  subtotalAfter: string;
  delta: string;
}

export interface BudgetImpact {
  budgetId: string;
  budgetTitle: string;
  revisionId: string;
  revisionNumber: number;
  totalDirectBefore: string;
  totalDirectAfter: string;
  totalWithBdiBefore: string;
  totalWithBdiAfter: string;
  delta: string;
  deltaPercent: string;
  affectedItems: BudgetImpactItem[];
}

export interface PriceUpdatePreview {
  changes: PriceUpdateChange[];
  impacts: BudgetImpact[];
  totalDelta: string;
  totalDeltaPercent: string;
}

interface RevisionForImpact {
  id: string;
  revisionNumber: number;
  budgetId: string;
  budget: { id: string; title: string };
  bdiConfig: { id: string; name: string; bdiRate: Decimal } | null;
  roundingPriceDecimals: number;
  roundingQuantityDecimals: number;
  roundingCoefficientDecimals: number;
  roundingTotalDecimals: number;
  roundingMode: string;
  stages: Array<{
    items: Array<{
      id: string;
      compositionId: string;
      quantity: Decimal;
      bdiRate: Decimal;
      bdiOverrideId: string | null;
      composition: { code: string; description: string };
    }>;
  }>;
}

function applyPriceOverrides(
  catalog: Map<string, CompositionInput>,
  overrides: Map<string, Decimal>
): { catalog: Map<string, CompositionInput>; affected: boolean } {
  let affected = false;
  const overridden = new Map<string, CompositionInput>();

  for (const [id, composition] of catalog.entries()) {
    const components = composition.components.map((component) => {
      if (!component.resource) return component;
      const newPrice = overrides.get(component.resource.id);
      if (!newPrice) return component;
      affected = true;
      return {
        ...component,
        resource: { ...component.resource, price: newPrice.toString() },
      };
    });
    overridden.set(id, { ...composition, components });
  }

  return { catalog: overridden, affected };
}

function evaluateUnitCost(
  catalog: Map<string, CompositionInput>,
  compositionId: string,
  rounder: Rounder
): Decimal {
  const root = catalog.get(compositionId);
  if (!root) {
    throw new Error(`Composição ${compositionId} ausente no catálogo.`);
  }
  return calculateCompositionCost(root, {
    rounder,
    compositions: catalog,
    unitConverter: defaultUnitConverter,
  }).unitCost.total;
}

async function buildRevisionImpact(params: {
  revision: RevisionForImpact;
  overrides: Map<string, Decimal>;
}): Promise<BudgetImpact | null> {
  const { revision, overrides } = params;
  const rounder = getRevisionRounder(revision);
  const baseCatalogCache = new Map<string, Map<string, CompositionInput>>();

  let directBefore = new Decimal(0);
  let directAfter = new Decimal(0);
  let withBdiBefore = new Decimal(0);
  let withBdiAfter = new Decimal(0);
  const affectedItems: BudgetImpactItem[] = [];

  for (const stage of revision.stages) {
    for (const item of stage.items) {
      let baseCatalog = baseCatalogCache.get(item.compositionId);
      if (!baseCatalog) {
        baseCatalog = await loadCompositionCatalog(item.compositionId, {});
        baseCatalogCache.set(item.compositionId, baseCatalog);
      }

      const beforeUnit = evaluateUnitCost(baseCatalog, item.compositionId, rounder);
      const { catalog: afterCatalog, affected } = applyPriceOverrides(baseCatalog, overrides);
      const afterUnit = affected
        ? evaluateUnitCost(afterCatalog, item.compositionId, rounder)
        : beforeUnit;

      const beforeCalc = calculateBudgetItem(
        {
          quantity: item.quantity.toString(),
          compositionCost: {
            material: new Decimal(0),
            labor: new Decimal(0),
            equipment: new Decimal(0),
            other: new Decimal(0),
            total: beforeUnit,
          },
          bdiRate: item.bdiRate,
        },
        rounder
      );

      const afterCalc = calculateBudgetItem(
        {
          quantity: item.quantity.toString(),
          compositionCost: {
            material: new Decimal(0),
            labor: new Decimal(0),
            equipment: new Decimal(0),
            other: new Decimal(0),
            total: afterUnit,
          },
          bdiRate: item.bdiRate,
        },
        rounder
      );

      directBefore = directBefore.plus(beforeCalc.subtotal);
      directAfter = directAfter.plus(afterCalc.subtotal);
      withBdiBefore = withBdiBefore.plus(beforeCalc.subtotalWithBdi);
      withBdiAfter = withBdiAfter.plus(afterCalc.subtotalWithBdi);

      if (affected && !beforeUnit.equals(afterUnit)) {
        affectedItems.push({
          itemId: item.id,
          compositionCode: item.composition.code,
          compositionDescription: item.composition.description,
          quantity: item.quantity.toString(),
          unitCostBefore: beforeUnit.toString(),
          unitCostAfter: afterUnit.toString(),
          subtotalBefore: beforeCalc.subtotal.toString(),
          subtotalAfter: afterCalc.subtotal.toString(),
          delta: afterCalc.subtotal.minus(beforeCalc.subtotal).toString(),
        });
      }
    }
  }

  if (affectedItems.length === 0) {
    return null;
  }

  const delta = withBdiAfter.minus(withBdiBefore);
  const deltaPercent = withBdiBefore.isZero()
    ? "0"
    : delta.dividedBy(withBdiBefore).times(100).toDecimalPlaces(4).toString();

  return {
    budgetId: revision.budgetId,
    budgetTitle: revision.budget.title,
    revisionId: revision.id,
    revisionNumber: revision.revisionNumber,
    totalDirectBefore: directBefore.toFixed(2),
    totalDirectAfter: directAfter.toFixed(2),
    totalWithBdiBefore: withBdiBefore.toFixed(2),
    totalWithBdiAfter: withBdiAfter.toFixed(2),
    delta: delta.toFixed(2),
    deltaPercent,
    affectedItems,
  };
}

async function validateUpdates(
  userId: string,
  updates: PriceUpdateInput[],
  db: Prisma.TransactionClient | typeof prisma
): Promise<{ changes: PriceUpdateChange[]; overrides: Map<string, Decimal> }> {
  if (updates.length === 0) {
    throw new Error("Nenhuma atualização de preço informada.");
  }

  const changes: PriceUpdateChange[] = [];
  const overrides = new Map<string, Decimal>();

  for (const update of updates) {
    const resource = await db.resource.findFirst({
      where: { id: update.resourceId, userId },
    });

    if (!resource) {
      throw new Error(`Insumo ${update.resourceId} não encontrado para este usuário.`);
    }

    const newPrice = new Decimal(update.price);
    if (!newPrice.isFinite() || newPrice.isNegative()) {
      throw new Error(`Preço inválido para o insumo ${resource.code}: ${update.price}.`);
    }

    overrides.set(resource.id, newPrice);

    if (!resource.price.equals(newPrice)) {
      const delta = newPrice.minus(resource.price);
      changes.push({
        resourceId: resource.id,
        code: resource.code,
        description: resource.description,
        unit: resource.unit,
        oldPrice: resource.price.toString(),
        newPrice: newPrice.toString(),
        delta: delta.toString(),
        deltaPercent: resource.price.isZero()
          ? "0"
          : delta
              .dividedBy(resource.price)
              .times(100)
              .toDecimalPlaces(4)
              .toString(),
      });
    }
  }

  return { changes, overrides };
}

async function loadDraftRevisionsForImpact(userId: string) {
  return prisma.budgetRevision.findMany({
    where: { status: "DRAFT", budget: { userId } },
    include: {
      budget: { select: { id: true, title: true } },
      bdiConfig: true,
      stages: {
        include: {
          items: {
            include: {
              composition: { select: { code: true, description: true } },
            },
          },
        },
      },
    },
  });
}

async function computeImpacts(
  userId: string,
  overrides: Map<string, Decimal>
): Promise<BudgetImpact[]> {
  const revisions = (await loadDraftRevisionsForImpact(userId)) as unknown as Array<
    RevisionForImpact & { userId?: string }
  >;

  const impacts: BudgetImpact[] = [];
  for (const revision of revisions) {
    const impact = await buildRevisionImpact({
      revision,
      overrides,
    });
    if (impact) impacts.push(impact);
  }

  impacts.sort((a, b) => a.budgetTitle.localeCompare(b.budgetTitle, "pt-BR"));
  return impacts;
}

/**
 * Calcula, sem persistir, o impacto de uma atualização de preços nos
 * orçamentos em rascunho do usuário. Revisões finalizadas nunca entram no
 * cálculo de impacto — seu snapshot é imutável.
 */
export async function previewPriceUpdates(params: {
  userId: string;
  updates: PriceUpdateInput[];
}): Promise<PriceUpdatePreview> {
  const { changes, overrides } = await validateUpdates(params.userId, params.updates, prisma);
  const impacts = await computeImpacts(params.userId, overrides);

  let totalDelta = new Decimal(0);
  let totalBefore = new Decimal(0);
  for (const impact of impacts) {
    totalDelta = totalDelta.plus(impact.delta);
    totalBefore = totalBefore.plus(impact.totalWithBdiBefore);
  }

  return {
    changes,
    impacts,
    totalDelta: totalDelta.toFixed(2),
    totalDeltaPercent: totalBefore.isZero()
      ? "0"
      : totalDelta
          .dividedBy(totalBefore)
          .times(100)
          .toDecimalPlaces(4)
          .toString(),
  };
}

export interface ApplyPriceUpdatesResult {
  success: boolean;
  updatedResources: number;
  historyEntries: number;
  impacts: BudgetImpact[];
  error?: string;
}

/**
 * Aplica atualizações de preço de forma atômica:
 *  - grava o novo preço e um registro imutável em ResourcePriceHistory;
 *  - recalcula apenas revisões em rascunho impactadas;
 *  - preserva integralmente revisões finalizadas e o histórico anterior.
 */
export async function applyPriceUpdates(params: {
  userId: string;
  updates: PriceUpdateInput[];
  reason?: string;
}): Promise<ApplyPriceUpdatesResult> {
  const preview = await previewPriceUpdates({
    userId: params.userId,
    updates: params.updates,
  });

  if (preview.changes.length === 0) {
    return {
      success: true,
      updatedResources: 0,
      historyEntries: 0,
      impacts: [],
    };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const revisionIds = preview.impacts.map((impact) => impact.revisionId);
      let historyEntries = 0;

      for (const change of preview.changes) {
        await tx.resource.update({
          where: { id: change.resourceId },
          data: {
            price: change.newPrice,
            priceDate: new Date(),
          },
        });

        await tx.resourcePriceHistory.create({
          data: {
            resourceId: change.resourceId,
            price: change.newPrice,
            source: "CONTROLLED_UPDATE",
            reason: params.reason?.trim() || "Atualização controlada de preços",
            author: params.userId,
            effectiveDate: new Date(),
          },
        });

        historyEntries++;
      }

      for (const revisionId of revisionIds) {
        await recalculateRevisionCosts({
          revisionId,
          userId: params.userId,
          db: tx,
        });
      }

      return { historyEntries };
    });

    await createAuditEntry({
      userId: params.userId,
      entityType: "Resource",
      entityId: "BATCH_PRICE_UPDATE",
      action: "UPDATE_PRICE",
      metadata: {
        reason: params.reason ?? null,
        changes: preview.changes,
        impactedRevisions: preview.impacts.map((impact) => impact.revisionId),
        totalDelta: preview.totalDelta,
      },
    });

    return {
      success: true,
      updatedResources: preview.changes.length,
      historyEntries: result.historyEntries,
      impacts: preview.impacts,
    };
  } catch (error) {
    return {
      success: false,
      updatedResources: 0,
      historyEntries: 0,
      impacts: [],
      error:
        error instanceof Error ? error.message : "Erro ao aplicar atualização de preços.",
    };
  }
}

/**
 * Histórico de preços de um insumo, do mais antigo ao mais recente.
 * O histórico é somente leitura: nunca é alterado nem removido.
 */
export async function listResourcePriceHistory(params: {
  userId: string;
  resourceId: string;
}) {
  const resource = await prisma.resource.findFirst({
    where: { id: params.resourceId, userId: params.userId },
    select: { id: true },
  });

  if (!resource) {
    throw new Error("Insumo não encontrado para este usuário.");
  }

  return prisma.resourcePriceHistory.findMany({
    where: { resourceId: params.resourceId },
    orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }],
  });
}
