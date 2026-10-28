"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth-utils";

function safeRevalidatePath(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // Ignora quando executado fora do contexto de requisição HTTP do Next.js
  }
}
import { prisma } from "@/lib/db/prisma";
import { createAuditEntry } from "@/lib/db/audit";
import { assertRevisionMutable, createRevisionSnapshot } from "@/lib/services/snapshot";
import { runRevisionAudit } from "@/lib/services/audit-rules";
import { calculateBudgetItem } from "@/lib/engine/calculator";
import { resolveBdi } from "@/lib/engine/bdi";
import { createRounder } from "@/lib/engine/rounding";
import {
  resolveCompositionCost,
} from "@/lib/services/composition-cost";
import { rankByFuzzy } from "@/lib/search/fuzzy";
import {
  RoundingMode,
  CostBreakdown,
  BdiConfigReference,
} from "@/lib/engine/types";
import { TaxRegime, BudgetStatus, DatabaseSource } from "@prisma/client";
import Decimal from "decimal.js";

// ============================================================================
// VALIDAÇÕES ZOD
// ============================================================================

const roundingModes = [
  "ROUND_HALF_UP",
  "ROUND_HALF_EVEN",
  "ROUND_UP",
  "ROUND_DOWN",
  "ROUND_CEILING",
  "ROUND_FLOOR",
] as const;

const createBudgetSchema = z.object({
  projectId: z.string().min(1, "Selecione uma obra"),
  title: z.string().min(2, "Título do orçamento é obrigatório"),
  description: z.string().optional().nullable(),
  technicalResponsible: z.string().optional().nullable(),
  baseDate: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  
  // Parâmetros de referência
  referenceDatabaseId: z.string().optional().nullable(),
  referenceState: z.string().length(2, "UF inválida").optional().or(z.literal("")).nullable(),
  referenceMonth: z.string().regex(/^\d{4}\/(0[1-9]|1[0-2])$/, "Mês de referência deve estar no formato AAAA/MM").optional().or(z.literal("")).nullable(),
  referenceTaxRegime: z.nativeEnum(TaxRegime).optional().nullable(),

  // BDI padrão
  bdiConfigId: z.string().optional().nullable(),

  // Modelo de EAP (opcional)
  templateId: z.string().optional().nullable(),

  // Precisão e Arredondamento
  roundingPriceDecimals: z.coerce.number().int().min(2).max(6).default(4),
  roundingQuantityDecimals: z.coerce.number().int().min(2).max(6).default(4),
  roundingCoefficientDecimals: z.coerce.number().int().min(2).max(8).default(5),
  roundingTotalDecimals: z.coerce.number().int().min(2).max(4).default(2),
  roundingMode: z.enum(roundingModes).default("ROUND_HALF_UP"),
});

export type CreateBudgetInput = z.infer<typeof createBudgetSchema>;

// ============================================================================
// AUXILIARES
// ============================================================================

/**
 * Cria executor de arredondamento a partir das preferências da revisão.
 */
function getRevisionRounder(revision: {
  roundingPriceDecimals: number;
  roundingQuantityDecimals: number;
  roundingCoefficientDecimals: number;
  roundingTotalDecimals: number;
  roundingMode: string;
}) {
  return createRounder({
    priceDecimals: revision.roundingPriceDecimals,
    quantityDecimals: revision.roundingQuantityDecimals,
    coefficientDecimals: revision.roundingCoefficientDecimals,
    totalDecimals: revision.roundingTotalDecimals,
    roundingMode: revision.roundingMode as RoundingMode,
  });
}

/**
 * Resolve a taxa efetiva de BDI de um item, respeitando a precedência:
 *
 *   1. exceção do serviço (`bdiOverrideId`), obrigatoriamente do próprio usuário;
 *   2. BDI padrão da revisão/orçamento;
 *   3. BDI padrão do sistema (fallback determinístico do motor).
 *
 * Uma exceção informada mas inexistente (ou de outro usuário) é um erro explícito,
 * evitando aplicar silenciosamente o BDI padrão quando o usuário pediu uma exceção.
 */
async function resolveItemBdiRate(params: {
  userId: string;
  overrideId?: string | null;
  revisionBdi?: { id: string; name: string; bdiRate: Decimal } | null;
}): Promise<Decimal> {
  let itemOverride: BdiConfigReference | null = null;

  if (params.overrideId) {
    const override = await prisma.bdiConfig.findFirst({
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

// ============================================================================
// CRIAÇÃO E GERENCIAMENTO DE ORÇAMENTOS
// ============================================================================

/**
 * Cria um novo orçamento e sua Revisão 1 inicial com etapa padrão.
 */
export async function createBudget(rawInput: CreateBudgetInput) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  const parsed = createBudgetSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || "Dados inválidos" };
  }

  const data = parsed.data;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 0. Validar que a obra pertence ao usuário autenticado.
      const project = await tx.project.findFirst({
        where: { id: data.projectId, userId: user.id },
        select: { id: true },
      });

      if (!project) {
        throw new Error("Obra selecionada não encontrada para este usuário.");
      }

      // 0. Resolver o BDI padrão da revisão, por precedência:
      //    escolha explícita > preferência do usuário > configuração marcada como padrão.
      let bdiConfigId = data.bdiConfigId || null;

      if (bdiConfigId) {
        const explicitBdi = await tx.bdiConfig.findFirst({
          where: { id: bdiConfigId, userId: user.id, active: true },
          select: { id: true },
        });

        if (!explicitBdi) {
          throw new Error(
            "Configuração de BDI selecionada não encontrada ou indisponível para este usuário."
          );
        }

        bdiConfigId = explicitBdi.id;
      } else {
        const preferences = await tx.userPreferences.findUnique({
          where: { userId: user.id },
          select: { defaultBdiConfigId: true },
        });

        if (preferences?.defaultBdiConfigId) {
          const preferredBdi = await tx.bdiConfig.findFirst({
            where: {
              id: preferences.defaultBdiConfigId,
              userId: user.id,
              active: true,
            },
            select: { id: true },
          });
          bdiConfigId = preferredBdi?.id ?? null;
        }

        if (!bdiConfigId) {
          const fallbackBdi = await tx.bdiConfig.findFirst({
            where: { userId: user.id, isDefault: true, active: true },
            orderBy: { updatedAt: "desc" },
            select: { id: true },
          });
          bdiConfigId = fallbackBdi?.id ?? null;
        }
      }

      // 1. Criar Orçamento
      const budget = await tx.budget.create({
        data: {
          userId: user.id,
          projectId: data.projectId,
          title: data.title.trim(),
          description: data.description?.trim() || null,
          status: BudgetStatus.DRAFT,
        },
      });

      // 2. Criar Revisão 1
      const revision = await tx.budgetRevision.create({
        data: {
          budgetId: budget.id,
          revisionNumber: 1,
          status: "DRAFT",
          referenceDatabaseId: data.referenceDatabaseId || null,
          referenceState: data.referenceState || null,
          referenceMonth: data.referenceMonth || null,
          referenceTaxRegime: data.referenceTaxRegime || null,
          bdiConfigId,
          roundingPriceDecimals: data.roundingPriceDecimals,
          roundingQuantityDecimals: data.roundingQuantityDecimals,
          roundingCoefficientDecimals: data.roundingCoefficientDecimals,
          roundingTotalDecimals: data.roundingTotalDecimals,
          roundingMode: data.roundingMode,
          notes: data.notes?.trim() || null,
          technicalResponsible: data.technicalResponsible?.trim() || null,
          baseDate: data.baseDate ? new Date(data.baseDate) : new Date(),
        },
      });

      // 3. Criar Etapa Inicial Padrão (EAP Nível 1), exceto quando um modelo
      //    de EAP for informado — nesse caso o modelo define a estrutura.
      if (!data.templateId) {
        await tx.stage.create({
          data: {
            budgetRevisionId: revision.id,
            code: "1",
            title: "SERVIÇOS INICIAIS",
            sortOrder: 1,
          },
        });
      }

      return { budget, revision };
    });

    // 3.1. Aplicar modelo de EAP, se selecionado. O recálculo sincroniza os
    //      custos com o catálogo atual, preservando quantidades do modelo.
    if (data.templateId) {
      await applyBudgetTemplateToRevision(user.id, data.templateId, result.revision.id);
      await recalculateBudgetRevision(result.revision.id);
    }

    await createAuditEntry({
      userId: user.id,
      entityType: "Budget",
      entityId: result.budget.id,
      action: "CREATE",
      changes: {
        budget: result.budget,
        revisionId: result.revision.id,
      },
    });

    safeRevalidatePath("/budgets");
    safeRevalidatePath(`/budgets/${result.budget.id}`);

    return {
      success: true,
      budgetId: result.budget.id,
      revisionId: result.revision.id,
    };
  } catch (error) {
    console.error("Erro ao criar orçamento:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro interno ao criar orçamento",
    };
  }
}

/**
 * Exclui um orçamento e todas as suas revisões/etapas em cascata.
 */
export async function deleteBudget(budgetId: string) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  try {
    const budget = await prisma.budget.findFirst({
      where: { id: budgetId, userId: user.id },
    });

    if (!budget) {
      return { success: false, error: "Orçamento não encontrado" };
    }

    await prisma.budget.delete({
      where: { id: budgetId },
    });

    await createAuditEntry({
      userId: user.id,
      entityType: "Budget",
      entityId: budgetId,
      action: "DELETE",
      changes: { budgetId },
    });

    safeRevalidatePath("/budgets");
    return { success: true };
  } catch (error) {
    console.error("Erro ao excluir orçamento:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao excluir orçamento",
    };
  }
}

// ============================================================================
// GERENCIAMENTO DA EAP (ETAPAS E SUBETAPAS)
// ============================================================================

export interface CreateStageInput {
  budgetRevisionId: string;
  parentStageId?: string | null;
  /** Opcional: quando omitido/vazio, a numeração hierárquica é automática. */
  code?: string;
  title: string;
  description?: string | null;
  sortOrder?: number;
}

/**
 * Gera o próximo código hierárquico disponível.
 * Raízes: "1", "2", ... Filhas: "1.1", "1.2", ...
 */
async function generateStageCode(
  budgetRevisionId: string,
  parentStageId?: string | null
): Promise<string> {
  if (parentStageId) {
    const parent = await prisma.stage.findUnique({
      where: { id: parentStageId },
      select: { id: true, code: true, budgetRevisionId: true },
    });

    if (!parent || parent.budgetRevisionId !== budgetRevisionId) {
      throw new Error("Etapa pai não encontrada nesta revisão.");
    }

    const prefix = `${parent.code}.`;
    const siblings = await prisma.stage.findMany({
      where: { budgetRevisionId, parentStageId },
      select: { code: true },
    });

    let max = 0;
    for (const sibling of siblings) {
      if (!sibling.code.startsWith(prefix)) continue;
      const suffix = sibling.code.slice(prefix.length);
      if (/^\d+$/.test(suffix)) {
        max = Math.max(max, Number(suffix));
      }
    }

    return `${prefix}${max + 1}`;
  }

  const roots = await prisma.stage.findMany({
    where: { budgetRevisionId, parentStageId: null },
    select: { code: true },
  });

  let max = 0;
  for (const root of roots) {
    if (/^\d+$/.test(root.code)) {
      max = Math.max(max, Number(root.code));
    }
  }

  return String(max + 1);
}

export async function createStage(input: CreateStageInput) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  try {
    await assertRevisionMutable(input.budgetRevisionId);

    // Calcular sortOrder se não fornecido
    let sortOrder = input.sortOrder;
    if (sortOrder === undefined) {
      const lastStage = await prisma.stage.findFirst({
        where: {
          budgetRevisionId: input.budgetRevisionId,
          parentStageId: input.parentStageId || null,
        },
        orderBy: { sortOrder: "desc" },
      });
      sortOrder = (lastStage?.sortOrder ?? 0) + 1;
    }

    // Numeração automática quando o código não é informado explicitamente.
    const explicitCode = input.code?.trim();
    const code =
      explicitCode && explicitCode.length > 0
        ? explicitCode
        : await generateStageCode(input.budgetRevisionId, input.parentStageId);

    const stage = await prisma.stage.create({
      data: {
        budgetRevisionId: input.budgetRevisionId,
        parentStageId: input.parentStageId || null,
        code,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        sortOrder,
      },
    });

    const revision = await prisma.budgetRevision.findUnique({
      where: { id: input.budgetRevisionId },
      select: { budgetId: true },
    });

    if (revision) {
      safeRevalidatePath(`/budgets/${revision.budgetId}`);
    }

    return { success: true, stage };
  } catch (error) {
    console.error("Erro ao criar etapa:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao criar etapa",
    };
  }
}

export interface UpdateStageInput {
  stageId: string;
  code?: string;
  title: string;
  description?: string | null;
  sortOrder?: number;
}

export async function updateStage(input: UpdateStageInput) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  try {
    const existing = await prisma.stage.findFirst({
      where: {
        id: input.stageId,
        budgetRevision: { budget: { userId: user.id } },
      },
      include: { budgetRevision: true },
    });

    if (!existing) {
      return { success: false, error: "Etapa não encontrada" };
    }

    await assertRevisionMutable(existing.budgetRevisionId);

    const updated = await prisma.stage.update({
      where: { id: input.stageId },
      data: {
        code: input.code?.trim() || existing.code,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      },
    });

    safeRevalidatePath(`/budgets/${existing.budgetRevision.budgetId}`);
    return { success: true, stage: updated };
  } catch (error) {
    console.error("Erro ao atualizar etapa:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao atualizar etapa",
    };
  }
}

export async function deleteStage(stageId: string) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  try {
    const stage = await prisma.stage.findFirst({
      where: {
        id: stageId,
        budgetRevision: { budget: { userId: user.id } },
      },
      include: { budgetRevision: true },
    });

    if (!stage) {
      return { success: false, error: "Etapa não encontrada" };
    }

    await assertRevisionMutable(stage.budgetRevisionId);

    await prisma.stage.delete({
      where: { id: stageId },
    });

    safeRevalidatePath(`/budgets/${stage.budgetRevision.budgetId}`);
    return { success: true };
  } catch (error) {
    console.error("Erro ao excluir etapa:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao excluir etapa",
    };
  }
}

// ============================================================================
// RENUMERAÇÃO AUTOMÁTICA DA EAP
// ============================================================================

/**
 * Renumera toda a EAP de forma determinística (1, 1.1, 1.1.1, 2, ...),
 * respeitando a ordem (`sortOrder`) de cada nível. Códigos explícitos são
 * substituídos — a ação é opt-in e registrada em auditoria.
 */
export async function renumberStages(budgetRevisionId: string) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  try {
    const revision = await prisma.budgetRevision.findFirst({
      where: { id: budgetRevisionId, budget: { userId: user.id } },
      include: { stages: true },
    });

    if (!revision) {
      return { success: false, error: "Revisão não encontrada" };
    }

    await assertRevisionMutable(budgetRevisionId);

    const childrenByParent = new Map<string | null, typeof revision.stages>();
    for (const stage of revision.stages) {
      const key = stage.parentStageId ?? null;
      const list = childrenByParent.get(key) ?? [];
      list.push(stage);
      childrenByParent.set(key, list);
    }

    for (const list of childrenByParent.values()) {
      list.sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
    }

    const updates: Array<{ id: string; code: string }> = [];
    const visit = (parentId: string | null, parentCode: string | null) => {
      const siblings = childrenByParent.get(parentId) ?? [];
      siblings.forEach((stage, index) => {
        const code = parentCode ? `${parentCode}.${index + 1}` : String(index + 1);
        updates.push({ id: stage.id, code });
        visit(stage.id, code);
      });
    };
    visit(null, null);

    await prisma.$transaction(
      updates.map((update) =>
        prisma.stage.update({
          where: { id: update.id },
          data: { code: update.code },
        })
      )
    );

    await createAuditEntry({
      userId: user.id,
      entityType: "BudgetRevision",
      entityId: budgetRevisionId,
      action: "UPDATE",
      changes: { action: "RENUMBER_STAGES", stages: updates },
    });

    safeRevalidatePath(`/budgets/${revision.budgetId}`);
    return { success: true, updatedCount: updates.length };
  } catch (error) {
    console.error("Erro ao renumerar etapas:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao renumerar etapas",
    };
  }
}

// ============================================================================
// GERENCIAMENTO DE ITENS DA PLANILHA (BUDGET ITEMS)
// ============================================================================

export interface AddBudgetItemInput {
  stageId: string;
  compositionId: string;
  quantity: string | number;
  bdiOverrideId?: string | null;
  notes?: string | null;
}

export async function addBudgetItem(input: AddBudgetItemInput) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  try {
    const stage = await prisma.stage.findFirst({
      where: {
        id: input.stageId,
        budgetRevision: { budget: { userId: user.id } },
      },
      include: {
        budgetRevision: {
          include: {
            bdiConfig: true,
          },
        },
      },
    });

    if (!stage) {
      return { success: false, error: "Etapa não encontrada" };
    }

    await assertRevisionMutable(stage.budgetRevisionId);

    const revision = stage.budgetRevision;
    const rounder = getRevisionRounder(revision);

    // 1. Custo unitário da composição
    const unitCost = await resolveCompositionCost(input.compositionId, rounder, {
      userId: user.id,
    });

    // 2. Obter taxa de BDI efetiva (exceção do serviço > padrão da revisão > padrão do sistema)
    const bdiRateDecimal = await resolveItemBdiRate({
      userId: user.id,
      overrideId: input.bdiOverrideId,
      revisionBdi: revision.bdiConfig,
    });

    // 3. Calcular item com motor determinístico
    const itemCalc = calculateBudgetItem(
      {
        quantity: input.quantity,
        compositionCost: unitCost,
        bdiRate: bdiRateDecimal,
      },
      rounder
    );

    // 4. Determinar sortOrder
    const lastItem = await prisma.budgetItem.findFirst({
      where: { stageId: input.stageId },
      orderBy: { sortOrder: "desc" },
    });
    const sortOrder = (lastItem?.sortOrder ?? 0) + 1;

    // 5. Salvar item
    const newItem = await prisma.budgetItem.create({
      data: {
        stageId: input.stageId,
        compositionId: input.compositionId,
        sortOrder,
        quantity: itemCalc.quantity.toString(),
        bdiOverrideId: input.bdiOverrideId || null,
        unitCostMaterial: unitCost.material.toString(),
        unitCostLabor: unitCost.labor.toString(),
        unitCostEquipment: unitCost.equipment.toString(),
        unitCostOther: unitCost.other.toString(),
        unitCostTotal: unitCost.total.toString(),
        subtotal: itemCalc.subtotal.toString(),
        bdiRate: itemCalc.bdiRate.toString(),
        subtotalWithBdi: itemCalc.subtotalWithBdi.toString(),
        notes: input.notes?.trim() || null,
      },
    });

    safeRevalidatePath(`/budgets/${revision.budgetId}`);
    return { success: true, item: newItem };
  } catch (error) {
    console.error("Erro ao adicionar item ao orçamento:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao adicionar item",
    };
  }
}

export interface UpdateBudgetItemInput {
  itemId: string;
  quantity?: string | number;
  bdiOverrideId?: string | null;
  notes?: string | null;
}

export async function updateBudgetItem(input: UpdateBudgetItemInput) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  try {
    const item = await prisma.budgetItem.findFirst({
      where: {
        id: input.itemId,
        stage: { budgetRevision: { budget: { userId: user.id } } },
      },
      include: {
        stage: {
          include: {
            budgetRevision: {
              include: {
                bdiConfig: true,
              },
            },
          },
        },
      },
    });

    if (!item) {
      return { success: false, error: "Item não encontrado" };
    }

    const revision = item.stage.budgetRevision;
    await assertRevisionMutable(revision.id);

    const rounder = getRevisionRounder(revision);
    const quantity = input.quantity !== undefined ? input.quantity : item.quantity.toString();
    const bdiOverrideId = input.bdiOverrideId !== undefined ? input.bdiOverrideId : item.bdiOverrideId;

    // Custo unitário atual
    const unitCost: CostBreakdown = {
      material: new Decimal(item.unitCostMaterial.toString()),
      labor: new Decimal(item.unitCostLabor.toString()),
      equipment: new Decimal(item.unitCostEquipment.toString()),
      other: new Decimal(item.unitCostOther.toString()),
      total: new Decimal(item.unitCostTotal.toString()),
    };

    // Taxa de BDI efetiva (exceção do item > padrão da revisão > padrão do sistema)
    const bdiRateDecimal = await resolveItemBdiRate({
      userId: user.id,
      overrideId: bdiOverrideId,
      revisionBdi: revision.bdiConfig,
    });

    const itemCalc = calculateBudgetItem(
      {
        quantity,
        compositionCost: unitCost,
        bdiRate: bdiRateDecimal,
      },
      rounder
    );

    const updated = await prisma.budgetItem.update({
      where: { id: input.itemId },
      data: {
        quantity: itemCalc.quantity.toString(),
        bdiOverrideId: bdiOverrideId || null,
        subtotal: itemCalc.subtotal.toString(),
        bdiRate: itemCalc.bdiRate.toString(),
        subtotalWithBdi: itemCalc.subtotalWithBdi.toString(),
        ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
      },
    });

    safeRevalidatePath(`/budgets/${revision.budgetId}`);
    return { success: true, item: updated };
  } catch (error) {
    console.error("Erro ao atualizar item:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao atualizar item",
    };
  }
}

export async function deleteBudgetItem(itemId: string) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  try {
    const item = await prisma.budgetItem.findFirst({
      where: {
        id: itemId,
        stage: { budgetRevision: { budget: { userId: user.id } } },
      },
      include: {
        stage: {
          include: {
            budgetRevision: true,
          },
        },
      },
    });

    if (!item) {
      return { success: false, error: "Item não encontrado" };
    }

    const revision = item.stage.budgetRevision;
    await assertRevisionMutable(revision.id);

    await prisma.budgetItem.delete({
      where: { id: itemId },
    });

    safeRevalidatePath(`/budgets/${revision.budgetId}`);
    return { success: true };
  } catch (error) {
    console.error("Erro ao remover item:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao remover item",
    };
  }
}

/**
 * Exclusão em lote de itens da planilha. Valida propriedade e mutabilidade de
 * todas as revisões envolvidas antes de remover qualquer registro.
 */
export async function deleteBudgetItems(itemIds: string[]) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  const uniqueIds = Array.from(new Set(itemIds.filter(Boolean)));
  if (uniqueIds.length === 0) {
    return { success: false, error: "Nenhum item selecionado." };
  }

  try {
    const items = await prisma.budgetItem.findMany({
      where: {
        id: { in: uniqueIds },
        stage: { budgetRevision: { budget: { userId: user.id } } },
      },
      select: {
        id: true,
        stage: {
          select: {
            budgetRevision: {
              select: { id: true, budgetId: true },
            },
          },
        },
      },
    });

    if (items.length !== uniqueIds.length) {
      return {
        success: false,
        error: "Um ou mais itens não foram encontrados para este usuário.",
      };
    }

    const revisions = new Map<string, string>();
    for (const item of items) {
      revisions.set(item.stage.budgetRevision.id, item.stage.budgetRevision.budgetId);
    }

    for (const revisionId of revisions.keys()) {
      await assertRevisionMutable(revisionId);
    }

    const result = await prisma.budgetItem.deleteMany({
      where: { id: { in: uniqueIds } },
    });

    for (const budgetId of new Set(revisions.values())) {
      safeRevalidatePath(`/budgets/${budgetId}`);
    }

    return { success: true, deletedCount: result.count };
  } catch (error) {
    console.error("Erro ao remover itens em lote:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao remover itens",
    };
  }
}

// ============================================================================
// RECALCULO GERAL DETERMINÍSTICO DA REVISÃO
// ============================================================================

export async function recalculateBudgetRevision(budgetRevisionId: string) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  try {
    await assertRevisionMutable(budgetRevisionId);

    const revision = await prisma.budgetRevision.findFirst({
      where: { id: budgetRevisionId, budget: { userId: user.id } },
      include: {
        bdiConfig: true,
        stages: {
          include: {
            items: true,
          },
        },
      },
    });

    if (!revision) {
      return { success: false, error: "Revisão não encontrada" };
    }

    const rounder = getRevisionRounder(revision);

    // Iterar e recalcular cada item
    let updatedCount = 0;
    for (const stage of revision.stages) {
      for (const item of stage.items) {
        // Custo atualizado da composição
        const unitCost = await resolveCompositionCost(item.compositionId, rounder, {
          userId: user.id,
        });

        // Taxa de BDI efetiva (exceção do item > padrão da revisão > padrão do sistema)
        const itemBdiRate = await resolveItemBdiRate({
          userId: user.id,
          overrideId: item.bdiOverrideId,
          revisionBdi: revision.bdiConfig,
        });

        const calc = calculateBudgetItem(
          {
            quantity: item.quantity.toString(),
            compositionCost: unitCost,
            bdiRate: itemBdiRate,
          },
          rounder
        );

        await prisma.budgetItem.update({
          where: { id: item.id },
          data: {
            unitCostMaterial: unitCost.material.toString(),
            unitCostLabor: unitCost.labor.toString(),
            unitCostEquipment: unitCost.equipment.toString(),
            unitCostOther: unitCost.other.toString(),
            unitCostTotal: unitCost.total.toString(),
            subtotal: calc.subtotal.toString(),
            bdiRate: calc.bdiRate.toString(),
            subtotalWithBdi: calc.subtotalWithBdi.toString(),
          },
        });
        updatedCount++;
      }
    }

    safeRevalidatePath(`/budgets/${revision.budgetId}`);
    return { success: true, updatedCount };
  } catch (error) {
    console.error("Erro ao recalcular revisão:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao recalcular orçamento",
    };
  }
}

// ============================================================================
// FINALIZAÇÃO DE REVISÃO (SNAPSHOT IMUTÁVEL COM SHA-256)
// ============================================================================

export async function finalizeRevision(budgetRevisionId: string) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  try {
    const revision = await prisma.budgetRevision.findUnique({
      where: { id: budgetRevisionId },
      include: { budget: true },
    });

    if (!revision) {
      return { success: false, error: "Revisão não encontrada" };
    }

    // Auditoria crítica: erros bloqueiam a geração do snapshot imutável.
    const audit = await runRevisionAudit({
      revisionId: budgetRevisionId,
      userId: user.id,
    });

    if (audit.errors > 0) {
      const criticalFindings = audit.findings.filter(
        (finding) => finding.severity === "ERROR"
      );

      return {
        success: false,
        blocked: true,
        error: `Finalização bloqueada: ${audit.errors} erro(s) crítico(s) de auditoria. Corrija os apontamentos e tente novamente.`,
        audit: {
          errors: audit.errors,
          warnings: audit.warnings,
          infos: audit.infos,
          findings: criticalFindings,
        },
      };
    }

    // Chama o serviço canônico de Snapshot
    const snapshot = await createRevisionSnapshot(budgetRevisionId, user.id);

    // Atualiza status do orçamento para FINALIZED se todas as revisões ativas estiverem finalizadas
    await prisma.budget.update({
      where: { id: revision.budgetId },
      data: { status: BudgetStatus.FINALIZED },
    });

    safeRevalidatePath("/budgets");
    safeRevalidatePath(`/budgets/${revision.budgetId}`);

    return {
      success: true,
      checksumSha256: snapshot.checksum,
      finalizedAt: snapshot.createdAt,
      audit: {
        errors: audit.errors,
        warnings: audit.warnings,
        infos: audit.infos,
      },
    };
  } catch (error) {
    console.error("Erro ao finalizar revisão:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao finalizar revisão",
    };
  }
}

// ============================================================================
// CLONAGEM PARA NOVA REVISÃO (REVISION N+1)
// ============================================================================

export async function createNewRevision(budgetId: string, notes?: string) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  try {
    const budget = await prisma.budget.findFirst({
      where: { id: budgetId, userId: user.id },
      include: {
        revisions: {
          orderBy: { revisionNumber: "desc" },
          take: 1,
          include: {
            stages: {
              orderBy: { sortOrder: "asc" },
              include: {
                items: {
                  orderBy: { sortOrder: "asc" },
                },
              },
            },
          },
        },
      },
    });

    if (!budget || budget.revisions.length === 0) {
      return { success: false, error: "Orçamento sem revisões base para duplicar" };
    }

    const baseRevision = budget.revisions[0];
    const newRevisionNumber = baseRevision.revisionNumber + 1;

    const newRev = await prisma.$transaction(async (tx) => {
      // 1. Criar nova revisão DRAFT
      const rev = await tx.budgetRevision.create({
        data: {
          budgetId: budget.id,
          revisionNumber: newRevisionNumber,
          status: "DRAFT",
          referenceDatabaseId: baseRevision.referenceDatabaseId,
          referenceState: baseRevision.referenceState,
          referenceMonth: baseRevision.referenceMonth,
          referenceTaxRegime: baseRevision.referenceTaxRegime,
          bdiConfigId: baseRevision.bdiConfigId,
          roundingPriceDecimals: baseRevision.roundingPriceDecimals,
          roundingQuantityDecimals: baseRevision.roundingQuantityDecimals,
          roundingCoefficientDecimals: baseRevision.roundingCoefficientDecimals,
          roundingTotalDecimals: baseRevision.roundingTotalDecimals,
          roundingMode: baseRevision.roundingMode,
          notes: notes?.trim() || `Criado a partir da Revisão ${baseRevision.revisionNumber}`,
          technicalResponsible: baseRevision.technicalResponsible,
          baseDate: new Date(),
        },
      });

      // Mapeamento de id antigo de stage para id novo de stage
      const stageMap = new Map<string, string>();

      // 2. Duplicar etapas de nível 1 primeiro (sem parentStageId)
      const rootStages = baseRevision.stages.filter((s) => !s.parentStageId);
      for (const root of rootStages) {
        const createdRoot = await tx.stage.create({
          data: {
            budgetRevisionId: rev.id,
            parentStageId: null,
            code: root.code,
            title: root.title,
            description: root.description,
            sortOrder: root.sortOrder,
          },
        });
        stageMap.set(root.id, createdRoot.id);

        // Duplicar itens do root
        for (const item of root.items) {
          await tx.budgetItem.create({
            data: {
              stageId: createdRoot.id,
              compositionId: item.compositionId,
              sortOrder: item.sortOrder,
              quantity: item.quantity,
              bdiOverrideId: item.bdiOverrideId,
              unitCostMaterial: item.unitCostMaterial,
              unitCostLabor: item.unitCostLabor,
              unitCostEquipment: item.unitCostEquipment,
              unitCostOther: item.unitCostOther,
              unitCostTotal: item.unitCostTotal,
              subtotal: item.subtotal,
              bdiRate: item.bdiRate,
              subtotalWithBdi: item.subtotalWithBdi,
              notes: item.notes,
            },
          });
        }
      }

      // 3. Duplicar subetapas filhas (nível 2+)
      const childStages = baseRevision.stages.filter((s) => s.parentStageId);
      for (const child of childStages) {
        const newParentId = child.parentStageId ? stageMap.get(child.parentStageId) || null : null;
        const createdChild = await tx.stage.create({
          data: {
            budgetRevisionId: rev.id,
            parentStageId: newParentId,
            code: child.code,
            title: child.title,
            description: child.description,
            sortOrder: child.sortOrder,
          },
        });
        stageMap.set(child.id, createdChild.id);

        for (const item of child.items) {
          await tx.budgetItem.create({
            data: {
              stageId: createdChild.id,
              compositionId: item.compositionId,
              sortOrder: item.sortOrder,
              quantity: item.quantity,
              bdiOverrideId: item.bdiOverrideId,
              unitCostMaterial: item.unitCostMaterial,
              unitCostLabor: item.unitCostLabor,
              unitCostEquipment: item.unitCostEquipment,
              unitCostOther: item.unitCostOther,
              unitCostTotal: item.unitCostTotal,
              subtotal: item.subtotal,
              bdiRate: item.bdiRate,
              subtotalWithBdi: item.subtotalWithBdi,
              notes: item.notes,
            },
          });
        }
      }

      return rev;
    });

    await createAuditEntry({
      userId: user.id,
      entityType: "BudgetRevision",
      entityId: newRev.id,
      action: "CREATE",
      changes: {
        budgetId,
        revisionNumber: newRevisionNumber,
        clonedFromRevision: baseRevision.revisionNumber,
      },
    });

    safeRevalidatePath("/budgets");
    safeRevalidatePath(`/budgets/${budgetId}`);

    return {
      success: true,
      revisionId: newRev.id,
      revisionNumber: newRevisionNumber,
    };
  } catch (error) {
    console.error("Erro ao criar nova revisão:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao criar nova revisão",
    };
  }
}

// ============================================================================
// MODELOS DE EAP (BUDGET TEMPLATES)
// ============================================================================

export interface BudgetTemplateItemData {
  compositionId: string;
  quantity: string;
  bdiOverrideId?: string | null;
  notes?: string | null;
}

export interface BudgetTemplateStageData {
  code: string;
  parentCode: string | null;
  title: string;
  description: string | null;
  sortOrder: number;
  items: BudgetTemplateItemData[];
}

export interface BudgetTemplateData {
  version: 1;
  stages: BudgetTemplateStageData[];
}

/**
 * Cria um modelo de EAP a partir do estado atual de uma revisão.
 * A origem (obra/orçamento/revisão) é registrada na auditoria.
 */
export async function saveBudgetTemplate(input: {
  revisionId: string;
  name: string;
  description?: string | null;
}) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  const name = input.name?.trim();
  if (!name || name.length < 2) {
    return { success: false, error: "Informe um nome para o modelo (mínimo 2 caracteres)." };
  }

  try {
    const revision = await prisma.budgetRevision.findFirst({
      where: { id: input.revisionId, budget: { userId: user.id } },
      include: {
        budget: { select: { id: true, title: true } },
        stages: {
          orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
          include: { items: { orderBy: { sortOrder: "asc" } } },
        },
      },
    });

    if (!revision) {
      return { success: false, error: "Revisão não encontrada" };
    }

    const codeById = new Map(revision.stages.map((stage) => [stage.id, stage.code]));

    const templateData: BudgetTemplateData = {
      version: 1,
      stages: revision.stages.map((stage) => ({
        code: stage.code,
        parentCode: stage.parentStageId ? codeById.get(stage.parentStageId) ?? null : null,
        title: stage.title,
        description: stage.description,
        sortOrder: stage.sortOrder,
        items: stage.items.map((item) => ({
          compositionId: item.compositionId,
          quantity: item.quantity.toString(),
          bdiOverrideId: item.bdiOverrideId,
          notes: item.notes,
        })),
      })),
    };

    const template = await prisma.budgetTemplate.create({
      data: {
        userId: user.id,
        name,
        description: input.description?.trim() || null,
        templateData: templateData as unknown as object,
      },
    });

    await createAuditEntry({
      userId: user.id,
      entityType: "BudgetTemplate",
      entityId: template.id,
      action: "CREATE",
      changes: {
        name,
        sourceBudgetId: revision.budget.id,
        sourceRevisionId: revision.id,
        stageCount: templateData.stages.length,
      },
    });

    safeRevalidatePath("/budgets/new");
    return { success: true, templateId: template.id };
  } catch (error) {
    console.error("Erro ao salvar modelo de EAP:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao salvar modelo de EAP",
    };
  }
}

/**
 * Lista modelos do usuário com metadados derivados do JSON persistido.
 */
export async function listBudgetTemplates() {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, templates: [], error: "Não autorizado" };
  }

  try {
    const templates = await prisma.budgetTemplate.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
    });

    return {
      success: true,
      templates: templates.map((template) => {
        const data = template.templateData as unknown as BudgetTemplateData;
        const stages = Array.isArray(data?.stages) ? data.stages : [];
        return {
          id: template.id,
          name: template.name,
          description: template.description,
          updatedAt: template.updatedAt,
          stageCount: stages.length,
          itemCount: stages.reduce((sum, stage) => sum + (stage.items?.length ?? 0), 0),
        };
      }),
    };
  } catch (error) {
    console.error("Erro ao listar modelos de EAP:", error);
    return { success: false, templates: [], error: "Erro ao listar modelos" };
  }
}

export async function deleteBudgetTemplate(templateId: string) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  const existing = await prisma.budgetTemplate.findFirst({
    where: { id: templateId, userId: user.id },
  });

  if (!existing) {
    return { success: false, error: "Modelo não encontrado" };
  }

  await prisma.budgetTemplate.delete({ where: { id: templateId } });
  safeRevalidatePath("/budgets/new");
  return { success: true };
}

/**
 * Materializa um modelo em uma revisão existente, gerando códigos novos por
 * nível e recalculando os itens com o motor determinístico.
 */
async function applyBudgetTemplateToRevision(
  userId: string,
  templateId: string,
  revisionId: string
) {
  const template = await prisma.budgetTemplate.findFirst({
    where: { id: templateId, userId },
  });

  if (!template) {
    throw new Error("Modelo de EAP não encontrado para este usuário.");
  }

  const data = template.templateData as unknown as BudgetTemplateData;
  if (!data || !Array.isArray(data.stages)) {
    throw new Error("Modelo de EAP inválido.");
  }

  const stageIdByCode = new Map<string, string>();
  const pending = [...data.stages];

  while (pending.length > 0) {
    const index = pending.findIndex(
      (stage) => !stage.parentCode || stageIdByCode.has(stage.parentCode)
    );

    if (index === -1) {
      throw new Error("Modelo de EAP com hierarquia inválida.");
    }

    const [stageData] = pending.splice(index, 1);
    const parentStageId = stageData.parentCode
      ? stageIdByCode.get(stageData.parentCode) ?? null
      : null;

    const code = await generateStageCode(revisionId, parentStageId);
    const created = await prisma.stage.create({
      data: {
        budgetRevisionId: revisionId,
        parentStageId,
        code,
        title: stageData.title,
        description: stageData.description ?? null,
        sortOrder: stageData.sortOrder ?? 1,
      },
    });

    stageIdByCode.set(stageData.code, created.id);

    for (const item of stageData.items ?? []) {
      const result = await addBudgetItem({
        stageId: created.id,
        compositionId: item.compositionId,
        quantity: item.quantity,
        bdiOverrideId: item.bdiOverrideId ?? null,
        notes: item.notes ?? null,
      });

      if (!result.success) {
        throw new Error(result.error || "Erro ao aplicar item do modelo de EAP.");
      }
    }
  }
}

/**
 * Aplica um modelo a uma revisão já existente (rascunho).
 */
export async function applyBudgetTemplate(input: {
  revisionId: string;
  templateId: string;
}) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  try {
    const revision = await prisma.budgetRevision.findFirst({
      where: { id: input.revisionId, budget: { userId: user.id } },
      select: { id: true, budgetId: true },
    });

    if (!revision) {
      return { success: false, error: "Revisão não encontrada" };
    }

    await assertRevisionMutable(input.revisionId);
    await applyBudgetTemplateToRevision(user.id, input.templateId, input.revisionId);

    safeRevalidatePath(`/budgets/${revision.budgetId}`);
    return { success: true };
  } catch (error) {
    console.error("Erro ao aplicar modelo de EAP:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao aplicar modelo de EAP",
    };
  }
}

// ============================================================================
// BUSCA DE COMPOSIÇÕES (PARA O DRAWER / MODAL DE ADIÇÃO)
// ============================================================================

export interface SearchCompositionsParams {
  query: string;
  source?: DatabaseSource;
  limit?: number;
}

export async function searchCompositions(params: SearchCompositionsParams) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, compositions: [], error: "Não autorizado" };
  }

  const query = params.query?.trim() || "";
  const limit = Math.min(Math.max(params.limit || 20, 1), 50);

  try {
    // O filtro textual é feito em memória com ranking aproximado. O `contains`
    // do banco é usado como pré-filtro para reduzir o conjunto quando há termo,
    // mas também carregamos o acervo recente para tolerar erros de digitação.
    const baseWhere = {
      userId: user.id,
      active: true,
      ...(params.source ? { source: params.source } : {}),
    };

    const [exactMatches, recent] = await Promise.all([
      query
        ? prisma.composition.findMany({
            where: {
              ...baseWhere,
              OR: [
                { code: { contains: query, mode: "insensitive" } },
                { description: { contains: query, mode: "insensitive" } },
              ],
            },
            take: 200,
            orderBy: { code: "asc" },
            select: {
              id: true,
              code: true,
              description: true,
              unit: true,
              source: true,
              type: true,
              closedTotalPrice: true,
            },
          })
        : Promise.resolve([]),
      prisma.composition.findMany({
        where: baseWhere,
        take: 300,
        orderBy: [{ isFavorite: "desc" }, { updatedAt: "desc" }],
        select: {
          id: true,
          code: true,
          description: true,
          unit: true,
          source: true,
          type: true,
          closedTotalPrice: true,
        },
      }),
    ]);

    const merged = new Map<string, (typeof recent)[number]>();
    for (const composition of [...exactMatches, ...recent]) {
      merged.set(composition.id, composition);
    }

    const ranked = rankByFuzzy(
      Array.from(merged.values()),
      query,
      (composition) => ({
        code: composition.code,
        description: composition.description,
      }),
      query ? Math.max(limit * 3, 30) : limit
    ).slice(0, limit);

    const rounder = createRounder();
    const compositions = await Promise.all(
      ranked.map(async ({ item: c }) => {
        let unitCostTotal: string | null = c.closedTotalPrice?.toString() ?? null;

        if (unitCostTotal === null && c.type !== "CLOSED") {
          try {
            const cost = await resolveCompositionCost(c.id, rounder, { userId: user.id });
            unitCostTotal = cost.total.toString();
          } catch {
            unitCostTotal = null;
          }
        }

        return {
          id: c.id,
          code: c.code,
          description: c.description,
          unit: c.unit,
          source: c.source,
          type: c.type,
          closedTotalPrice: c.closedTotalPrice?.toString() ?? null,
          unitCostTotal,
        };
      })
    );

    return { success: true, compositions };
  } catch (error) {
    console.error("Erro ao buscar composições:", error);
    return {
      success: false,
      compositions: [],
      error: "Erro na busca de composições",
    };
  }
}
