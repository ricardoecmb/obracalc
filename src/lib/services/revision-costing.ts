import Decimal from "decimal.js";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { calculateBudgetItem } from "@/lib/engine/calculator";
import { resolveBdi } from "@/lib/engine/bdi";
import { createRounder } from "@/lib/engine/rounding";
import type {
  BdiConfigReference,
  CostBreakdown,
  Rounder,
  RoundingMode,
} from "@/lib/engine/types";
import { resolveCompositionCost } from "./composition-cost";

/**
 * Política de arredondamento de uma revisão. Centralizada para que qualquer
 * caminho de cálculo (editor, importação, atualização de preços) produza
 * exatamente os mesmos valores.
 */
export function getRevisionRounder(revision: {
  roundingPriceDecimals: number;
  roundingQuantityDecimals: number;
  roundingCoefficientDecimals: number;
  roundingTotalDecimals: number;
  roundingMode: string;
}): Rounder {
  return createRounder({
    priceDecimals: revision.roundingPriceDecimals,
    quantityDecimals: revision.roundingQuantityDecimals,
    coefficientDecimals: revision.roundingCoefficientDecimals,
    totalDecimals: revision.roundingTotalDecimals,
    roundingMode: revision.roundingMode as RoundingMode,
  });
}

/**
 * Resolve a taxa efetiva de BDI de um item respeitando a precedência:
 * exceção do item > padrão da revisão > padrão do sistema.
 */
export async function resolveItemBdiRate(params: {
  userId: string;
  overrideId?: string | null;
  revisionBdi?: { id: string; name: string; bdiRate: Decimal } | null;
  db?: Prisma.TransactionClient;
}): Promise<Decimal> {
  const db = params.db ?? prisma;
  let itemOverride: BdiConfigReference | null = null;

  if (params.overrideId) {
    const override = await db.bdiConfig.findFirst({
      where: { id: params.overrideId, userId: params.userId },
    });

    if (!override) {
      throw new Error("Configuração de BDI de exceção não encontrada para este usuário.");
    }

    itemOverride = {
      id: override.id,
      name: override.name,
      rate: override.bdiRate.toString(),
    };
  }

  const revisionDefault: BdiConfigReference | null = params.revisionBdi
    ? {
        id: params.revisionBdi.id,
        name: params.revisionBdi.name,
        rate: params.revisionBdi.bdiRate.toString(),
      }
    : null;

  return resolveBdi({ itemOverride, revisionDefault }).rate;
}

export interface BudgetItemCostingData {
  unitCost: CostBreakdown;
  quantity: Decimal;
  subtotal: Decimal;
  bdiRate: Decimal;
  subtotalWithBdi: Decimal;
}

/**
 * Calcula todos os campos persistidos de um item de orçamento a partir da
 * composição e da política de arredondamento da revisão.
 */
export async function computeBudgetItemCosting(params: {
  userId: string;
  compositionId: string;
  quantity: Decimal | string | number;
  bdiOverrideId?: string | null;
  revision: {
    id: string;
    bdiConfigId: string | null;
    bdiConfig: { id: string; name: string; bdiRate: Decimal } | null;
    roundingPriceDecimals: number;
    roundingQuantityDecimals: number;
    roundingCoefficientDecimals: number;
    roundingTotalDecimals: number;
    roundingMode: string;
  };
  rounder?: Rounder;
  db?: Prisma.TransactionClient;
  /**
   * Quando informado, substitui o custo unitário calculado. Usado pela
   * importação de orçamento ao optar pelo preço do arquivo.
   */
  unitCostOverride?: CostBreakdown;
}): Promise<BudgetItemCostingData> {
  const rounder = params.rounder ?? getRevisionRounder(params.revision);

  const unitCost =
    params.unitCostOverride ??
    (await resolveCompositionCost(params.compositionId, rounder, {
      userId: params.userId,
      db: params.db,
    }));

  const bdiRate = await resolveItemBdiRate({
    userId: params.userId,
    overrideId: params.bdiOverrideId,
    revisionBdi: params.revision.bdiConfig,
    db: params.db,
  });

  const calc = calculateBudgetItem(
    {
      quantity: params.quantity,
      compositionCost: unitCost,
      bdiRate,
    },
    rounder
  );

  return {
    unitCost,
    quantity: calc.quantity,
    subtotal: calc.subtotal,
    bdiRate: calc.bdiRate,
    subtotalWithBdi: calc.subtotalWithBdi,
  };
}

export interface RecalculateRevisionResult {
  updatedCount: number;
  totalDirect: Decimal;
  totalWithBdi: Decimal;
}

/**
 * Recalcula deterministicamente todos os itens persistidos de uma revisão.
 * Deve ser executado dentro de uma transação quando fizer parte de uma
 * operação maior (ex.: atualização de preços).
 */
export async function recalculateRevisionCosts(params: {
  revisionId: string;
  userId: string;
  db?: Prisma.TransactionClient;
}): Promise<RecalculateRevisionResult> {
  const db = params.db ?? prisma;

  const revision = await db.budgetRevision.findFirst({
    where: { id: params.revisionId, budget: { userId: params.userId } },
    include: {
      bdiConfig: true,
      stages: { include: { items: true } },
    },
  });

  if (!revision) {
    throw new Error("Revisão não encontrada para recálculo.");
  }

  if (revision.status === "FINALIZED") {
    throw new Error(
      `A revisão ${revision.revisionNumber} está finalizada e não pode ser recalculada.`
    );
  }

  const rounder = getRevisionRounder(revision);
  let updatedCount = 0;
  let totalDirect = new Decimal(0);
  let totalWithBdi = new Decimal(0);

  for (const stage of revision.stages) {
    for (const item of stage.items) {
      const costing = await computeBudgetItemCosting({
        userId: params.userId,
        compositionId: item.compositionId,
        quantity: item.quantity.toString(),
        bdiOverrideId: item.bdiOverrideId,
        revision,
        rounder,
        db,
      });

      await db.budgetItem.update({
        where: { id: item.id },
        data: {
          unitCostMaterial: costing.unitCost.material.toString(),
          unitCostLabor: costing.unitCost.labor.toString(),
          unitCostEquipment: costing.unitCost.equipment.toString(),
          unitCostOther: costing.unitCost.other.toString(),
          unitCostTotal: costing.unitCost.total.toString(),
          subtotal: costing.subtotal.toString(),
          bdiRate: costing.bdiRate.toString(),
          subtotalWithBdi: costing.subtotalWithBdi.toString(),
        },
      });

      updatedCount++;
      totalDirect = totalDirect.plus(costing.subtotal);
      totalWithBdi = totalWithBdi.plus(costing.subtotalWithBdi);
    }
  }

  return { updatedCount, totalDirect, totalWithBdi };
}
