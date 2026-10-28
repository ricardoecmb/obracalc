import { prisma } from "@/lib/db/prisma";
import { assertRevisionMutable } from "./snapshot";
import Decimal from "decimal.js";

export interface CreateBudgetParams {
  userId: string;
  projectId: string;
  title: string;
  description?: string | null;
  referenceDatabaseId?: string | null;
  referenceState?: string | null;
  referenceMonth?: string | null;
  bdiConfigId?: string | null;
}

export interface AddStageParams {
  budgetRevisionId: string;
  code: string;
  title: string;
  parentStageId?: string | null;
  sortOrder?: number;
  description?: string | null;
}

export interface AddBudgetItemParams {
  budgetRevisionId: string;
  stageId: string;
  compositionId: string;
  quantity: Decimal | string | number;
  bdiOverrideId?: string | null;
  unitCostMaterial?: Decimal | string | number;
  unitCostLabor?: Decimal | string | number;
  unitCostEquipment?: Decimal | string | number;
  unitCostOther?: Decimal | string | number;
  unitCostTotal?: Decimal | string | number;
  subtotal?: Decimal | string | number;
  bdiRate?: Decimal | string | number;
  subtotalWithBdi?: Decimal | string | number;
  sortOrder?: number;
  notes?: string | null;
}

/**
 * Cria um orçamento com a Revisão 1 inicial vinculada.
 */
export async function createBudget(params: CreateBudgetParams) {
  return await prisma.$transaction(async (tx) => {
    const budget = await tx.budget.create({
      data: {
        userId: params.userId,
        projectId: params.projectId,
        title: params.title.trim(),
        description: params.description?.trim() ?? null,
      },
    });

    const revision = await tx.budgetRevision.create({
      data: {
        budgetId: budget.id,
        revisionNumber: 1,
        status: "DRAFT",
        referenceDatabaseId: params.referenceDatabaseId ?? null,
        referenceState: params.referenceState ?? null,
        referenceMonth: params.referenceMonth ?? null,
        bdiConfigId: params.bdiConfigId ?? null,
      },
    });

    return { budget, revision };
  });
}

/**
 * Adiciona uma etapa à EAP (Estrutura Analítica de Projeto) do orçamento.
 * Bloqueia se a revisão já foi finalizada (imutabilidade).
 */
export async function addBudgetStage(params: AddStageParams) {
  await assertRevisionMutable(params.budgetRevisionId);

  return await prisma.stage.create({
    data: {
      budgetRevisionId: params.budgetRevisionId,
      code: params.code.trim(),
      title: params.title.trim(),
      parentStageId: params.parentStageId ?? null,
      sortOrder: params.sortOrder ?? 1,
      description: params.description?.trim() ?? null,
    },
  });
}

/**
 * Adiciona um item de serviço à etapa orçamentária.
 * Bloqueia se a revisão já foi finalizada (imutabilidade).
 */
export async function addBudgetItem(params: AddBudgetItemParams) {
  await assertRevisionMutable(params.budgetRevisionId);

  const quantity = new Decimal(params.quantity.toString());
  const unitCostTotal = new Decimal((params.unitCostTotal ?? 0).toString());
  const subtotal = new Decimal((params.subtotal ?? quantity.times(unitCostTotal)).toString());
  const bdiRate = new Decimal((params.bdiRate ?? 0).toString());
  const subtotalWithBdi = new Decimal(
    (params.subtotalWithBdi ?? subtotal.times(new Decimal(1).plus(bdiRate.dividedBy(100)))).toString()
  );

  return await prisma.budgetItem.create({
    data: {
      stageId: params.stageId,
      compositionId: params.compositionId,
      quantity,
      bdiOverrideId: params.bdiOverrideId ?? null,
      unitCostMaterial: new Decimal((params.unitCostMaterial ?? 0).toString()),
      unitCostLabor: new Decimal((params.unitCostLabor ?? 0).toString()),
      unitCostEquipment: new Decimal((params.unitCostEquipment ?? 0).toString()),
      unitCostOther: new Decimal((params.unitCostOther ?? 0).toString()),
      unitCostTotal,
      subtotal,
      bdiRate,
      subtotalWithBdi,
      sortOrder: params.sortOrder ?? 1,
      notes: params.notes ?? null,
    },
  });
}
