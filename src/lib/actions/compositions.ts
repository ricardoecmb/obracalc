"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db/prisma";
import { createAuditEntry } from "@/lib/db/audit";
import { DatabaseSource, TaxRegime, CompositionType } from "@prisma/client";
import Decimal from "decimal.js";
import { createRounder } from "@/lib/engine/rounding";
import {
  diffCostBreakdown,
  evaluateComposition,
  evaluateCompositionWithResourceOverride,
  resolveCompositionCost,
  serializeCostBreakdown,
  wouldCreateCompositionCycle,
} from "@/lib/services/composition-cost";
import { assertRevisionMutable } from "@/lib/services/snapshot";
import { addBudgetItem } from "./budgets";

function safeRevalidatePath(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // Ignora quando executado fora do contexto de requisição HTTP do Next.js
  }
}

// ============================================================================
// SCHEMAS
// ============================================================================

const compositionSchema = z.object({
  code: z.string().min(1, "Código é obrigatório"),
  description: z.string().min(2, "Descrição é obrigatória"),
  unit: z.string().min(1, "Unidade é obrigatória"),
  source: z.nativeEnum(DatabaseSource).default(DatabaseSource.CUSTOM),
  sourceState: z.string().length(2, "UF deve ter 2 caracteres").optional().or(z.literal("")).nullable(),
  sourceMonth: z.string().regex(/^\d{4}\/\d{2}$/, "Formato de competência deve ser AAAA/MM").default("2024/01"),
  sourceTaxRegime: z.nativeEnum(TaxRegime).optional().nullable(),
  type: z.nativeEnum(CompositionType).default(CompositionType.ANALYTICAL),
  closedTotalPrice: z.number().optional().nullable(),
  closedMaterialPrice: z.number().optional().nullable(),
  closedLaborPrice: z.number().optional().nullable(),
  closedEquipmentPrice: z.number().optional().nullable(),
  closedOtherPrice: z.number().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type CompositionFormData = z.infer<typeof compositionSchema>;

const componentSchema = z
  .object({
    compositionId: z.string().min(1),
    resourceId: z.string().optional().nullable(),
    childCompositionId: z.string().optional().nullable(),
    coefficient: z.union([z.string(), z.number()]),
    notes: z.string().optional().nullable(),
    unitConversionFactor: z.union([z.string(), z.number()]).optional().nullable(),
  })
  .refine(
    (data) => Boolean(data.resourceId) !== Boolean(data.childCompositionId),
    "O componente deve referenciar exatamente um insumo OU uma composição auxiliar."
  );

export type CompositionComponentInput = z.infer<typeof componentSchema>;

// ============================================================================
// AUXILIARES
// ============================================================================

function normalizeCoefficient(value: string | number): string {
  const decimal = new Decimal(value);
  if (!decimal.isFinite() || decimal.isNegative()) {
    throw new Error("O coeficiente deve ser um número finito maior ou igual a zero.");
  }
  return decimal.toString();
}

async function getOwnedComposition(userId: string, compositionId: string) {
  return prisma.composition.findFirst({
    where: { id: compositionId, userId },
  });
}

async function validateComponentReferences(params: {
  userId: string;
  parentCompositionId: string;
  resourceId?: string | null;
  childCompositionId?: string | null;
}) {
  if (params.resourceId) {
    const resource = await prisma.resource.findFirst({
      where: { id: params.resourceId, userId: params.userId, active: true },
      select: { id: true },
    });
    if (!resource) {
      throw new Error("Insumo não encontrado para este usuário.");
    }
  }

  if (params.childCompositionId) {
    const child = await prisma.composition.findFirst({
      where: { id: params.childCompositionId, userId: params.userId, active: true },
      select: { id: true },
    });
    if (!child) {
      throw new Error("Composição auxiliar não encontrada para este usuário.");
    }

    const createsCycle = await wouldCreateCompositionCycle(
      params.parentCompositionId,
      params.childCompositionId,
      { userId: params.userId }
    );

    if (createsCycle) {
      throw new Error(
        "Vínculo recusado: a composição auxiliar criaria um ciclo (ela já contém, direta ou indiretamente, esta composição)."
      );
    }
  }
}

/** Serializa um componente para o cliente, sem vazar Decimal. */
function serializeComponent(component: {
  id: string;
  resourceId: string | null;
  childCompositionId: string | null;
  coefficient: Decimal;
  notes: string | null;
  sortOrder: number;
  resource?: {
    id: string;
    code: string;
    description: string;
    unit: string;
    category: string;
    price: Decimal;
    laborChargesIncluded: boolean;
  } | null;
  childComposition?: {
    id: string;
    code: string;
    description: string;
    unit: string;
  } | null;
}) {
  return {
    id: component.id,
    resourceId: component.resourceId,
    childCompositionId: component.childCompositionId,
    coefficient: component.coefficient.toString(),
    notes: component.notes,
    sortOrder: component.sortOrder,
    resource: component.resource
      ? {
          id: component.resource.id,
          code: component.resource.code,
          description: component.resource.description,
          unit: component.resource.unit,
          category: component.resource.category,
          price: component.resource.price.toString(),
          laborChargesIncluded: component.resource.laborChargesIncluded,
        }
      : null,
    childComposition: component.childComposition
      ? {
          id: component.childComposition.id,
          code: component.childComposition.code,
          description: component.childComposition.description,
          unit: component.childComposition.unit,
        }
      : null,
  };
}

// ============================================================================
// CRIAÇÃO / EDIÇÃO / EXCLUSÃO DE COMPOSIÇÕES
// ============================================================================

export async function createCompositionAction(data: CompositionFormData) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  const parsed = compositionSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || "Dados inválidos" };
  }

  try {
    const composition = await prisma.composition.create({
      data: {
        userId: user.id,
        code: parsed.data.code.trim(),
        description: parsed.data.description.trim(),
        unit: parsed.data.unit.trim(),
        source: parsed.data.source,
        sourceState: parsed.data.sourceState?.toUpperCase().trim() || null,
        sourceMonth: parsed.data.sourceMonth.trim(),
        sourceTaxRegime: parsed.data.sourceTaxRegime || null,
        type: parsed.data.type,
        closedTotalPrice:
          parsed.data.closedTotalPrice !== undefined && parsed.data.closedTotalPrice !== null
            ? new Decimal(parsed.data.closedTotalPrice)
            : null,
        closedMaterialPrice:
          parsed.data.closedMaterialPrice !== undefined && parsed.data.closedMaterialPrice !== null
            ? new Decimal(parsed.data.closedMaterialPrice)
            : null,
        closedLaborPrice:
          parsed.data.closedLaborPrice !== undefined && parsed.data.closedLaborPrice !== null
            ? new Decimal(parsed.data.closedLaborPrice)
            : null,
        closedEquipmentPrice:
          parsed.data.closedEquipmentPrice !== undefined && parsed.data.closedEquipmentPrice !== null
            ? new Decimal(parsed.data.closedEquipmentPrice)
            : null,
        closedOtherPrice:
          parsed.data.closedOtherPrice !== undefined && parsed.data.closedOtherPrice !== null
            ? new Decimal(parsed.data.closedOtherPrice)
            : null,
        notes: parsed.data.notes?.trim() || null,
        version: 1,
      },
    });

    await createAuditEntry({
      userId: user.id,
      entityType: "Composition",
      entityId: composition.id,
      action: "CREATE",
      changes: composition,
    });

    safeRevalidatePath("/compositions");
    return { success: true, compositionId: composition.id, composition };
  } catch (error) {
    console.error("Erro ao criar composição:", error);
    return {
      success: false,
      error: "Composição já cadastrada para esta competência/estado/regime ou erro interno.",
    };
  }
}

/**
 * Atualiza apenas o cabeçalho da composição. Componentes são geridos por
 * ações específicas para preservar a rastreabilidade e a validação de ciclos.
 */
export async function updateCompositionAction(input: {
  id: string;
  code?: string;
  description?: string;
  unit?: string;
  type?: CompositionType;
  notes?: string | null;
  closedTotalPrice?: number | null;
  closedMaterialPrice?: number | null;
  closedLaborPrice?: number | null;
  closedEquipmentPrice?: number | null;
  closedOtherPrice?: number | null;
}) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  const existing = await getOwnedComposition(user.id, input.id);
  if (!existing) {
    return { success: false, error: "Composição não encontrada" };
  }

  try {
    const updated = await prisma.composition.update({
      where: { id: input.id },
      data: {
        ...(input.code !== undefined ? { code: input.code.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() } : {}),
        ...(input.unit !== undefined ? { unit: input.unit.trim() } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
        ...(input.closedTotalPrice !== undefined
          ? {
              closedTotalPrice:
                input.closedTotalPrice === null ? null : new Decimal(input.closedTotalPrice),
            }
          : {}),
        ...(input.closedMaterialPrice !== undefined
          ? {
              closedMaterialPrice:
                input.closedMaterialPrice === null ? null : new Decimal(input.closedMaterialPrice),
            }
          : {}),
        ...(input.closedLaborPrice !== undefined
          ? {
              closedLaborPrice:
                input.closedLaborPrice === null ? null : new Decimal(input.closedLaborPrice),
            }
          : {}),
        ...(input.closedEquipmentPrice !== undefined
          ? {
              closedEquipmentPrice:
                input.closedEquipmentPrice === null
                  ? null
                  : new Decimal(input.closedEquipmentPrice),
            }
          : {}),
        ...(input.closedOtherPrice !== undefined
          ? {
              closedOtherPrice:
                input.closedOtherPrice === null ? null : new Decimal(input.closedOtherPrice),
            }
          : {}),
      },
    });

    await createAuditEntry({
      userId: user.id,
      entityType: "Composition",
      entityId: updated.id,
      action: "UPDATE",
      changes: { before: existing, after: updated },
    });

    safeRevalidatePath("/compositions");
    return { success: true };
  } catch (error) {
    console.error("Erro ao atualizar composição:", error);
    return { success: false, error: "Erro ao atualizar composição." };
  }
}

export async function deleteCompositionAction(id: string) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  const existing = await prisma.composition.findFirst({
    where: { id, userId: user.id },
    include: {
      _count: {
        select: { budgetItems: true, usedAsComponent: true, derivedCompositions: true },
      },
    },
  });

  if (!existing) {
    return { success: false, error: "Composição não encontrada" };
  }

  if (
    existing._count.budgetItems > 0 ||
    existing._count.usedAsComponent > 0 ||
    existing._count.derivedCompositions > 0
  ) {
    return {
      success: false,
      error:
        "Esta composição está em uso em orçamentos, como subcomposição auxiliar ou possui duplicações e não pode ser excluída.",
    };
  }

  try {
    await prisma.composition.delete({
      where: { id },
    });

    await createAuditEntry({
      userId: user.id,
      entityType: "Composition",
      entityId: id,
      action: "DELETE",
      changes: existing,
    });

    safeRevalidatePath("/compositions");
    return { success: true };
  } catch (error) {
    console.error("Erro ao excluir composição:", error);
    return { success: false, error: "Erro interno ao excluir composição." };
  }
}

/**
 * Duplica uma composição (cabeçalho + componentes), preservando a origem em
 * `originCompositionId`. O código é tornado único dentro da mesma chave lógica.
 */
export async function duplicateCompositionAction(input: {
  compositionId: string;
  code?: string;
  description?: string;
}) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  const original = await prisma.composition.findFirst({
    where: { id: input.compositionId, userId: user.id },
    include: { components: { orderBy: { sortOrder: "asc" } } },
  });

  if (!original) {
    return { success: false, error: "Composição de origem não encontrada" };
  }

  try {
    let code = input.code?.trim();

    if (!code) {
      const baseCode = `${original.code}-COPIA`;
      const siblings = await prisma.composition.findMany({
        where: {
          userId: user.id,
          source: original.source,
          sourceState: original.sourceState,
          sourceMonth: original.sourceMonth,
          sourceTaxRegime: original.sourceTaxRegime,
          code: { startsWith: baseCode },
        },
        select: { code: true },
      });

      const taken = new Set(siblings.map((item) => item.code));
      if (!taken.has(baseCode)) {
        code = baseCode;
      } else {
        let suffix = 2;
        while (taken.has(`${baseCode}-${suffix}`)) suffix++;
        code = `${baseCode}-${suffix}`;
      }
    }

    const duplicated = await prisma.composition.create({
      data: {
        userId: user.id,
        referenceDatabaseId: original.referenceDatabaseId,
        code,
        description: input.description?.trim() || `${original.description} (cópia)`,
        unit: original.unit,
        source: original.source,
        sourceState: original.sourceState,
        sourceMonth: original.sourceMonth,
        sourceTaxRegime: original.sourceTaxRegime,
        type: original.type,
        closedTotalPrice: original.closedTotalPrice,
        closedMaterialPrice: original.closedMaterialPrice,
        closedLaborPrice: original.closedLaborPrice,
        closedEquipmentPrice: original.closedEquipmentPrice,
        closedOtherPrice: original.closedOtherPrice,
        notes: original.notes,
        version: 1,
        originCompositionId: original.id,
        components: {
          create: original.components.map((component) => ({
            resourceId: component.resourceId,
            childCompositionId: component.childCompositionId,
            coefficient: component.coefficient,
            notes: component.notes,
            sortOrder: component.sortOrder,
          })),
        },
      },
    });

    await createAuditEntry({
      userId: user.id,
      entityType: "Composition",
      entityId: duplicated.id,
      action: "CREATE",
      changes: {
        action: "DUPLICATE",
        originCompositionId: original.id,
        originCode: original.code,
        newCode: duplicated.code,
      },
    });

    safeRevalidatePath("/compositions");
    return { success: true, compositionId: duplicated.id, code: duplicated.code };
  } catch (error) {
    console.error("Erro ao duplicar composição:", error);
    return { success: false, error: "Erro ao duplicar composição (código já existente?)." };
  }
}

// ============================================================================
// COMPONENTES (INSUMOS E COMPOSIÇÕES AUXILIARES)
// ============================================================================

export async function addCompositionComponentAction(input: CompositionComponentInput) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  const parsed = componentSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || "Componente inválido" };
  }

  const composition = await getOwnedComposition(user.id, parsed.data.compositionId);
  if (!composition) {
    return { success: false, error: "Composição não encontrada" };
  }

  try {
    await validateComponentReferences({
      userId: user.id,
      parentCompositionId: composition.id,
      resourceId: parsed.data.resourceId,
      childCompositionId: parsed.data.childCompositionId,
    });

    const last = await prisma.compositionComponent.findFirst({
      where: { compositionId: composition.id },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });

    const component = await prisma.compositionComponent.create({
      data: {
        compositionId: composition.id,
        resourceId: parsed.data.resourceId || null,
        childCompositionId: parsed.data.childCompositionId || null,
        coefficient: normalizeCoefficient(parsed.data.coefficient),
        notes: parsed.data.notes?.trim() || null,
        sortOrder: (last?.sortOrder ?? 0) + 1,
      },
    });

    await createAuditEntry({
      userId: user.id,
      entityType: "Composition",
      entityId: composition.id,
      action: "UPDATE",
      changes: { action: "ADD_COMPONENT", componentId: component.id },
    });

    safeRevalidatePath("/compositions");
    return { success: true, componentId: component.id };
  } catch (error) {
    console.error("Erro ao adicionar componente:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao adicionar componente",
    };
  }
}

export async function updateCompositionComponentAction(input: {
  componentId: string;
  coefficient?: string | number;
  resourceId?: string | null;
  childCompositionId?: string | null;
  notes?: string | null;
}) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  const component = await prisma.compositionComponent.findFirst({
    where: {
      id: input.componentId,
      composition: { userId: user.id },
    },
    include: { composition: { select: { id: true } } },
  });

  if (!component) {
    return { success: false, error: "Componente não encontrado" };
  }

  try {
    const nextResourceId =
      input.resourceId !== undefined ? input.resourceId : component.resourceId;
    const nextChildCompositionId =
      input.childCompositionId !== undefined
        ? input.childCompositionId
        : component.childCompositionId;

    if (Boolean(nextResourceId) === Boolean(nextChildCompositionId)) {
      return {
        success: false,
        error: "O componente deve referenciar exatamente um insumo OU uma composição auxiliar.",
      };
    }

    await validateComponentReferences({
      userId: user.id,
      parentCompositionId: component.compositionId,
      resourceId: nextResourceId,
      childCompositionId: nextChildCompositionId,
    });

    await prisma.compositionComponent.update({
      where: { id: component.id },
      data: {
        ...(input.coefficient !== undefined
          ? { coefficient: normalizeCoefficient(input.coefficient) }
          : {}),
        resourceId: nextResourceId || null,
        childCompositionId: nextChildCompositionId || null,
        ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
      },
    });

    safeRevalidatePath("/compositions");
    return { success: true };
  } catch (error) {
    console.error("Erro ao atualizar componente:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao atualizar componente",
    };
  }
}

export async function deleteCompositionComponentAction(componentId: string) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  const component = await prisma.compositionComponent.findFirst({
    where: { id: componentId, composition: { userId: user.id } },
  });

  if (!component) {
    return { success: false, error: "Componente não encontrado" };
  }

  await prisma.compositionComponent.delete({ where: { id: componentId } });
  safeRevalidatePath("/compositions");
  return { success: true };
}

// ============================================================================
// DETALHE DE COMPOSIÇÃO (CUSTO, COMPONENTES E RASTREABILIDADE)
// ============================================================================

export async function getCompositionDetailsAction(compositionId: string) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado", composition: null };
  }

  try {
    const composition = await prisma.composition.findFirst({
      where: { id: compositionId, userId: user.id },
      include: {
        components: {
          orderBy: { sortOrder: "asc" },
          include: {
            resource: true,
            childComposition: {
              select: { id: true, code: true, description: true, unit: true },
            },
          },
        },
        originComposition: { select: { id: true, code: true, description: true } },
      },
    });

    if (!composition) {
      return { success: false, error: "Composição não encontrada", composition: null };
    }

    const result = await evaluateComposition(compositionId, {
      userId: user.id,
      rounder: createRounder(),
    });

    return {
      success: true,
      composition: {
        id: composition.id,
        code: composition.code,
        description: composition.description,
        unit: composition.unit,
        source: composition.source,
        sourceState: composition.sourceState,
        sourceMonth: composition.sourceMonth,
        sourceTaxRegime: composition.sourceTaxRegime,
        type: composition.type,
        version: composition.version,
        notes: composition.notes,
        originCompositionId: composition.originCompositionId,
        originComposition: composition.originComposition,
        closedTotalPrice: composition.closedTotalPrice?.toString() ?? null,
        closedMaterialPrice: composition.closedMaterialPrice?.toString() ?? null,
        closedLaborPrice: composition.closedLaborPrice?.toString() ?? null,
        closedEquipmentPrice: composition.closedEquipmentPrice?.toString() ?? null,
        closedOtherPrice: composition.closedOtherPrice?.toString() ?? null,
        components: composition.components.map(serializeComponent),
        calculation: {
          unitCost: serializeCostBreakdown(result.unitCost),
          breakdownUnavailable: result.breakdownUnavailable ?? false,
          componentDetails: result.componentDetails.map((detail) => ({
            componentId: detail.componentId,
            description: detail.description,
            unit: detail.unit,
            coefficient: detail.coefficient.toString(),
            unitPrice: detail.unitPrice.toString(),
            totalPrice: detail.totalPrice.toString(),
            category: detail.category,
            laborChargesRate: detail.laborChargesRate?.toString() ?? null,
            laborChargesAmount: detail.laborChargesAmount?.toString() ?? null,
            appliedUnitConversionFactor:
              detail.appliedUnitConversionFactor?.toString() ?? null,
          })),
        },
      },
    };
  } catch (error) {
    console.error("Erro ao carregar detalhe da composição:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao calcular composição",
      composition: null,
    };
  }
}

// ============================================================================
// SIMULAÇÃO E SUBSTITUIÇÃO POR EQUIVALENTE CONFIRMADO
// ============================================================================

async function getConfirmedEquivalence(params: {
  sourceResourceId: string;
  targetResourceId: string;
}) {
  return prisma.resourceEquivalence.findFirst({
    where: {
      confirmed: true,
      OR: [
        {
          sourceResourceId: params.sourceResourceId,
          targetResourceId: params.targetResourceId,
        },
        {
          sourceResourceId: params.targetResourceId,
          targetResourceId: params.sourceResourceId,
        },
      ],
    },
  });
}

async function loadReplacementContext(params: {
  userId: string;
  compositionId: string;
  componentId: string;
  targetResourceId: string;
}) {
  const component = await prisma.compositionComponent.findFirst({
    where: {
      id: params.componentId,
      compositionId: params.compositionId,
      composition: { userId: params.userId },
    },
    select: { id: true, resourceId: true, childCompositionId: true },
  });

  if (!component) {
    throw new Error("Componente não encontrado nesta composição.");
  }

  if (!component.resourceId) {
    throw new Error("Somente componentes do tipo insumo podem ser substituídos.");
  }

  const equivalence = await getConfirmedEquivalence({
    sourceResourceId: component.resourceId,
    targetResourceId: params.targetResourceId,
  });

  if (!equivalence) {
    throw new Error(
      "Substituição bloqueada: a equivalência entre os insumos não está confirmada."
    );
  }

  return { component, equivalence };
}

/**
 * Simula antes/depois a substituição de um insumo por um equivalente
 * confirmado, sem alterar a composição.
 */
export async function simulateResourceReplacementAction(input: {
  compositionId: string;
  componentId: string;
  targetResourceId: string;
}) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  try {
    await loadReplacementContext({
      userId: user.id,
      compositionId: input.compositionId,
      componentId: input.componentId,
      targetResourceId: input.targetResourceId,
    });

    const simulation = await evaluateCompositionWithResourceOverride({
      compositionId: input.compositionId,
      componentId: input.componentId,
      targetResourceId: input.targetResourceId,
      userId: user.id,
      rounder: createRounder(),
    });

    const before = serializeCostBreakdown(simulation.before.unitCost);
    const after = serializeCostBreakdown(simulation.after.unitCost);

    return {
      success: true,
      simulation: {
        before,
        after,
        diff: diffCostBreakdown(simulation.before.unitCost, simulation.after.unitCost),
        targetResource: simulation.targetResource,
        componentBefore: simulation.componentBefore,
        componentAfter: simulation.componentAfter,
      },
    };
  } catch (error) {
    console.error("Erro na simulação de substituição:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro na simulação",
    };
  }
}

/**
 * Substitui o insumo de um componente por um equivalente confirmado.
 * Rejeita equivalências não confirmadas.
 */
export async function replaceComponentResourceAction(input: {
  compositionId: string;
  componentId: string;
  targetResourceId: string;
  justification?: string | null;
}) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  try {
    const { component, equivalence } = await loadReplacementContext({
      userId: user.id,
      compositionId: input.compositionId,
      componentId: input.componentId,
      targetResourceId: input.targetResourceId,
    });

    const before = await resolveCompositionCost(input.compositionId, createRounder(), {
      userId: user.id,
    });

    await prisma.compositionComponent.update({
      where: { id: component.id },
      data: { resourceId: input.targetResourceId },
    });

    const after = await resolveCompositionCost(input.compositionId, createRounder(), {
      userId: user.id,
    });

    await createAuditEntry({
      userId: user.id,
      entityType: "Composition",
      entityId: input.compositionId,
      action: "UPDATE",
      changes: {
        action: "REPLACE_RESOURCE",
        componentId: component.id,
        fromResourceId: component.resourceId,
        toResourceId: input.targetResourceId,
        equivalenceId: equivalence.id,
        justification: input.justification?.trim() || equivalence.justification,
        before: serializeCostBreakdown(before),
        after: serializeCostBreakdown(after),
      },
    });

    safeRevalidatePath("/compositions");
    return {
      success: true,
      before: serializeCostBreakdown(before),
      after: serializeCostBreakdown(after),
      diff: diffCostBreakdown(before, after),
    };
  } catch (error) {
    console.error("Erro ao substituir insumo:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao substituir insumo",
    };
  }
}

// ============================================================================
// CADASTRO DENTRO DO ORÇAMENTO (INCLUSÃO IMEDIATA)
// ============================================================================

/**
 * Cria uma composição própria (com componentes opcionais) e a inclui
 * imediatamente como item da etapa informada.
 */
export async function createCompositionInBudgetAction(input: {
  stageId: string;
  composition: CompositionFormData;
  components?: CompositionComponentInput[];
  quantity: string | number;
  bdiOverrideId?: string | null;
}) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  const parsed = compositionSchema.safeParse(input.composition);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || "Dados inválidos" };
  }

  // Valida a etapa antes de criar a composição, evitando órfãos.
  const stage = await prisma.stage.findFirst({
    where: {
      id: input.stageId,
      budgetRevision: { budget: { userId: user.id } },
    },
    include: { budgetRevision: { select: { id: true, budgetId: true } } },
  });

  if (!stage) {
    return { success: false, error: "Etapa de destino não encontrada." };
  }

  let createdCompositionId: string | null = null;

  try {
    await assertRevisionMutable(stage.budgetRevisionId);

    const components = input.components ?? [];
    const normalizedComponents: Array<{
      resourceId: string | null;
      childCompositionId: string | null;
      coefficient: Decimal;
      notes: string | null;
      sortOrder: number;
    }> = [];

    for (let index = 0; index < components.length; index++) {
      const component = components[index];
      const valid = componentSchema.safeParse({
        ...component,
        compositionId: "pending",
      });
      if (!valid.success) {
        throw new Error(valid.error.issues[0]?.message || "Componente inválido.");
      }

      if (component.resourceId) {
        const resource = await prisma.resource.findFirst({
          where: { id: component.resourceId, userId: user.id, active: true },
          select: { id: true },
        });
        if (!resource) throw new Error("Insumo do componente não encontrado.");
      }

      if (component.childCompositionId) {
        const child = await prisma.composition.findFirst({
          where: { id: component.childCompositionId, userId: user.id, active: true },
          select: { id: true },
        });
        if (!child) throw new Error("Composição auxiliar não encontrada.");
      }

      normalizedComponents.push({
        resourceId: component.resourceId || null,
        childCompositionId: component.childCompositionId || null,
        coefficient: new Decimal(normalizeCoefficient(component.coefficient)),
        notes: component.notes?.trim() || null,
        sortOrder: index + 1,
      });
    }

    const composition = await prisma.composition.create({
      data: {
        userId: user.id,
        code: parsed.data.code.trim(),
        description: parsed.data.description.trim(),
        unit: parsed.data.unit.trim(),
        source: parsed.data.source,
        sourceState: parsed.data.sourceState?.toUpperCase().trim() || null,
        sourceMonth: parsed.data.sourceMonth.trim(),
        sourceTaxRegime: parsed.data.sourceTaxRegime || null,
        type: parsed.data.type,
        closedTotalPrice:
          parsed.data.closedTotalPrice !== undefined && parsed.data.closedTotalPrice !== null
            ? new Decimal(parsed.data.closedTotalPrice)
            : null,
        closedMaterialPrice:
          parsed.data.closedMaterialPrice !== undefined && parsed.data.closedMaterialPrice !== null
            ? new Decimal(parsed.data.closedMaterialPrice)
            : null,
        closedLaborPrice:
          parsed.data.closedLaborPrice !== undefined && parsed.data.closedLaborPrice !== null
            ? new Decimal(parsed.data.closedLaborPrice)
            : null,
        closedEquipmentPrice:
          parsed.data.closedEquipmentPrice !== undefined &&
          parsed.data.closedEquipmentPrice !== null
            ? new Decimal(parsed.data.closedEquipmentPrice)
            : null,
        closedOtherPrice:
          parsed.data.closedOtherPrice !== undefined && parsed.data.closedOtherPrice !== null
            ? new Decimal(parsed.data.closedOtherPrice)
            : null,
        notes: parsed.data.notes?.trim() || null,
        version: 1,
        components:
          normalizedComponents.length > 0
            ? { create: normalizedComponents }
            : undefined,
      },
    });

    createdCompositionId = composition.id;

    const itemResult = await addBudgetItem({
      stageId: input.stageId,
      compositionId: composition.id,
      quantity: input.quantity,
      bdiOverrideId: input.bdiOverrideId ?? null,
    });

    if (!itemResult.success) {
      throw new Error(itemResult.error || "Erro ao incluir item no orçamento.");
    }

    await createAuditEntry({
      userId: user.id,
      entityType: "Composition",
      entityId: composition.id,
      action: "CREATE",
      changes: {
        action: "CREATE_IN_BUDGET",
        budgetId: stage.budgetRevision.budgetId,
        revisionId: stage.budgetRevisionId,
        stageId: stage.id,
        itemId: itemResult.item?.id,
      },
    });

    safeRevalidatePath("/compositions");
    safeRevalidatePath(`/budgets/${stage.budgetRevision.budgetId}`);

    return {
      success: true,
      compositionId: composition.id,
      itemId: itemResult.item?.id,
    };
  } catch (error) {
    // Rollback manual: remove a composição recém-criada se a inclusão falhar.
    if (createdCompositionId) {
      await prisma.composition.delete({ where: { id: createdCompositionId } }).catch(() => {});
    }
    console.error("Erro ao criar composição dentro do orçamento:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao criar composição no orçamento",
    };
  }
}
