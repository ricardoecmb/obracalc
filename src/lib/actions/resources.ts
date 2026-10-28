"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db/prisma";
import { createAuditEntry } from "@/lib/db/audit";
import { DatabaseSource, TaxRegime, ResourceCategory } from "@prisma/client";
import Decimal from "decimal.js";
import { rankByFuzzy } from "@/lib/search/fuzzy";

const resourceSchema = z.object({
  code: z.string().min(1, "Código é obrigatório"),
  description: z.string().min(2, "Descrição é obrigatória"),
  unit: z.string().min(1, "Unidade é obrigatória"),
  category: z.nativeEnum(ResourceCategory).default(ResourceCategory.MATERIAL),
  source: z.nativeEnum(DatabaseSource).default(DatabaseSource.CUSTOM),
  sourceState: z.string().length(2, "UF deve ter 2 caracteres").optional().or(z.literal("")).nullable(),
  sourceMonth: z.string().regex(/^\d{4}\/\d{2}$/, "Formato de competência deve ser AAAA/MM (ex: 2024/01)").default("2024/01"),
  sourceTaxRegime: z.nativeEnum(TaxRegime).optional().nullable(),
  price: z.number().min(0, "Preço deve ser maior ou igual a zero"),
  laborChargesIncluded: z.boolean().default(false),
  laborChargesRate: z.number().optional().nullable(),
  supplierId: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type ResourceFormData = z.infer<typeof resourceSchema>;

export async function createResourceAction(data: ResourceFormData) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  const parsed = resourceSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || "Dados inválidos" };
  }

  try {
    const priceDecimal = new Decimal(parsed.data.price);
    const effectiveDate = new Date();

    const resource = await prisma.$transaction(async (tx) => {
      const res = await tx.resource.create({
        data: {
          userId: user.id,
          code: parsed.data.code.trim(),
          description: parsed.data.description.trim(),
          unit: parsed.data.unit.trim(),
          category: parsed.data.category,
          source: parsed.data.source,
          sourceState: parsed.data.sourceState?.toUpperCase().trim() || null,
          sourceMonth: parsed.data.sourceMonth.trim(),
          sourceTaxRegime: parsed.data.sourceTaxRegime || null,
          price: priceDecimal,
          priceDate: effectiveDate,
          laborChargesIncluded: parsed.data.laborChargesIncluded,
          laborChargesRate: parsed.data.laborChargesRate ? new Decimal(parsed.data.laborChargesRate) : null,
          supplierId: parsed.data.supplierId || null,
          notes: parsed.data.notes?.trim() || null,
        },
      });

      await tx.resourcePriceHistory.create({
        data: {
          resourceId: res.id,
          price: priceDecimal,
          source: parsed.data.source,
          reason: "Cadastro manual de insumo",
          author: user.id,
          effectiveDate,
        },
      });

      return res;
    });

    await createAuditEntry({
      userId: user.id,
      entityType: "Resource",
      entityId: resource.id,
      action: "CREATE",
      changes: resource,
    });

    revalidatePath("/resources");
    return { success: true, resource };
  } catch (error) {
    console.error("Erro ao criar insumo:", error);
    return { success: false, error: "Insumo já cadastrado para esta mesma competência/estado/regime ou erro interno." };
  }
}

export async function updateResourceAction(id: string, data: Partial<ResourceFormData>) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  const existing = await prisma.resource.findFirst({
    where: { id, userId: user.id },
  });

  if (!existing) {
    return { success: false, error: "Insumo não encontrado" };
  }

  try {
    const newPriceDecimal = data.price !== undefined ? new Decimal(data.price) : existing.price;
    const priceChanged = !existing.price.equals(newPriceDecimal);
    const effectiveDate = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const res = await tx.resource.update({
        where: { id },
        data: {
          ...(data.description ? { description: data.description.trim() } : {}),
          ...(data.unit ? { unit: data.unit.trim() } : {}),
          ...(data.category ? { category: data.category } : {}),
          ...(data.price !== undefined ? { price: newPriceDecimal, priceDate: effectiveDate } : {}),
          ...(data.laborChargesIncluded !== undefined ? { laborChargesIncluded: data.laborChargesIncluded } : {}),
          ...(data.laborChargesRate !== undefined
            ? { laborChargesRate: data.laborChargesRate ? new Decimal(data.laborChargesRate) : null }
            : {}),
          ...(data.supplierId !== undefined ? { supplierId: data.supplierId || null } : {}),
          ...(data.notes !== undefined ? { notes: data.notes?.trim() || null } : {}),
        },
      });

      if (priceChanged) {
        await tx.resourcePriceHistory.create({
          data: {
            resourceId: id,
            price: newPriceDecimal,
            source: "MANUAL_UPDATE",
            reason: "Atualização individual de preço",
            author: user.id,
            effectiveDate,
          },
        });
      }

      return res;
    });

    await createAuditEntry({
      userId: user.id,
      entityType: "Resource",
      entityId: id,
      action: "UPDATE",
      changes: { before: existing, after: updated },
    });

    revalidatePath("/resources");
    return { success: true, resource: updated };
  } catch (error) {
    console.error("Erro ao atualizar insumo:", error);
    return { success: false, error: "Erro interno ao atualizar insumo." };
  }
}

export async function deleteResourceAction(id: string) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  const existing = await prisma.resource.findFirst({
    where: { id, userId: user.id },
    include: {
      _count: {
        select: { compositionComponents: true },
      },
    },
  });

  if (!existing) {
    return { success: false, error: "Insumo não encontrado" };
  }

  if (existing._count.compositionComponents > 0) {
    return {
      success: false,
      error: "Este insumo faz parte de composições existentes e não pode ser excluído diretamente.",
    };
  }

  try {
    await prisma.resource.delete({
      where: { id },
    });

    await createAuditEntry({
      userId: user.id,
      entityType: "Resource",
      entityId: id,
      action: "DELETE",
      changes: existing,
    });

    revalidatePath("/resources");
    return { success: true };
  } catch (error) {
    console.error("Erro ao excluir insumo:", error);
    return { success: false, error: "Erro interno ao excluir insumo." };
  }
}

// ============================================================================
// BUSCA APROXIMADA DE INSUMOS (CATÁLOGO / EDITOR DE COMPOSIÇÕES)
// ============================================================================

export async function searchResources(params: {
  query?: string;
  category?: ResourceCategory;
  limit?: number;
}) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, resources: [], error: "Não autorizado" };
  }

  const query = params.query?.trim() || "";
  const limit = Math.min(Math.max(params.limit || 20, 1), 100);

  try {
    const resources = await prisma.resource.findMany({
      where: {
        userId: user.id,
        active: true,
        ...(params.category ? { category: params.category } : {}),
        ...(query
          ? {
              OR: [
                { code: { contains: query, mode: "insensitive" } },
                { description: { contains: query, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      take: 300,
      orderBy: [{ updatedAt: "desc" }],
    });

    const ranked = rankByFuzzy(
      resources,
      query,
      (resource) => ({ code: resource.code, description: resource.description }),
      query ? Math.max(limit * 3, 30) : limit
    ).slice(0, limit);

    return {
      success: true,
      resources: ranked.map(({ item: resource }) => ({
        id: resource.id,
        code: resource.code,
        description: resource.description,
        unit: resource.unit,
        category: resource.category,
        price: resource.price.toString(),
        source: resource.source,
        sourceState: resource.sourceState,
        sourceMonth: resource.sourceMonth,
        laborChargesIncluded: resource.laborChargesIncluded,
        laborChargesRate: resource.laborChargesRate?.toString() ?? null,
      })),
    };
  } catch (error) {
    console.error("Erro ao buscar insumos:", error);
    return { success: false, resources: [], error: "Erro na busca de insumos" };
  }
}

// ============================================================================
// EQUIVALÊNCIA DE INSUMOS
// ============================================================================

async function resourceBelongsToUser(resourceId: string, userId: string) {
  const resource = await prisma.resource.findFirst({
    where: { id: resourceId, userId },
    select: { id: true },
  });
  return Boolean(resource);
}

/**
 * Lista as equivalências em que o insumo participa (como origem ou destino).
 */
export async function listResourceEquivalences(resourceId?: string) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, equivalences: [], error: "Não autorizado" };
  }

  try {
    const equivalences = await prisma.resourceEquivalence.findMany({
      where: {
        ...(resourceId
          ? {
              OR: [
                { sourceResourceId: resourceId },
                { targetResourceId: resourceId },
              ],
            }
          : {}),
        sourceResource: { userId: user.id },
      },
      include: {
        sourceResource: {
          select: { id: true, code: true, description: true, unit: true, price: true },
        },
        targetResource: {
          select: { id: true, code: true, description: true, unit: true, price: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return {
      success: true,
      equivalences: equivalences.map((equivalence) => ({
        id: equivalence.id,
        confirmed: equivalence.confirmed,
        confirmedBy: equivalence.confirmedBy,
        justification: equivalence.justification,
        source: {
          id: equivalence.sourceResource.id,
          code: equivalence.sourceResource.code,
          description: equivalence.sourceResource.description,
          unit: equivalence.sourceResource.unit,
          price: equivalence.sourceResource.price.toString(),
        },
        target: {
          id: equivalence.targetResource.id,
          code: equivalence.targetResource.code,
          description: equivalence.targetResource.description,
          unit: equivalence.targetResource.unit,
          price: equivalence.targetResource.price.toString(),
        },
      })),
    };
  } catch (error) {
    console.error("Erro ao listar equivalências:", error);
    return { success: false, equivalences: [], error: "Erro ao listar equivalências" };
  }
}

/**
 * Lista somente equivalentes CONFIRMADOS de um insumo, em ambas as direções.
 * É a fonte usada pelo editor de composições para permitir substituições.
 */
export async function listConfirmedEquivalents(resourceId: string) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, resources: [], error: "Não autorizado" };
  }

  if (!(await resourceBelongsToUser(resourceId, user.id))) {
    return { success: false, resources: [], error: "Insumo não encontrado" };
  }

  try {
    const equivalences = await prisma.resourceEquivalence.findMany({
      where: {
        confirmed: true,
        OR: [
          { sourceResourceId: resourceId },
          { targetResourceId: resourceId },
        ],
      },
      include: {
        sourceResource: true,
        targetResource: true,
      },
    });

    const resources = equivalences.map((equivalence) =>
      equivalence.sourceResourceId === resourceId
        ? equivalence.targetResource
        : equivalence.sourceResource
    );

    return {
      success: true,
      resources: resources.map((resource) => ({
        id: resource.id,
        code: resource.code,
        description: resource.description,
        unit: resource.unit,
        category: resource.category,
        price: resource.price.toString(),
      })),
    };
  } catch (error) {
    console.error("Erro ao listar equivalentes confirmados:", error);
    return { success: false, resources: [], error: "Erro ao listar equivalentes" };
  }
}

export async function createResourceEquivalenceAction(input: {
  sourceResourceId: string;
  targetResourceId: string;
  justification?: string | null;
}) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  if (input.sourceResourceId === input.targetResourceId) {
    return { success: false, error: "Um insumo não pode ser equivalente a si próprio." };
  }

  const [source, target] = await Promise.all([
    resourceBelongsToUser(input.sourceResourceId, user.id),
    resourceBelongsToUser(input.targetResourceId, user.id),
  ]);

  if (!source || !target) {
    return { success: false, error: "Insumo de origem ou destino não encontrado." };
  }

  try {
    const existing = await prisma.resourceEquivalence.findFirst({
      where: {
        OR: [
          {
            sourceResourceId: input.sourceResourceId,
            targetResourceId: input.targetResourceId,
          },
          {
            sourceResourceId: input.targetResourceId,
            targetResourceId: input.sourceResourceId,
          },
        ],
      },
    });

    if (existing) {
      return { success: false, error: "Já existe uma equivalência cadastrada entre estes insumos." };
    }

    const equivalence = await prisma.resourceEquivalence.create({
      data: {
        sourceResourceId: input.sourceResourceId,
        targetResourceId: input.targetResourceId,
        justification: input.justification?.trim() || null,
        confirmed: false,
      },
    });

    await createAuditEntry({
      userId: user.id,
      entityType: "ResourceEquivalence",
      entityId: equivalence.id,
      action: "CREATE",
      changes: equivalence,
    });

    safeRevalidatePath("/resources");
    safeRevalidatePath("/compositions");
    return { success: true, equivalenceId: equivalence.id };
  } catch (error) {
    console.error("Erro ao criar equivalência:", error);
    return { success: false, error: "Erro ao criar equivalência de insumos." };
  }
}

export async function confirmResourceEquivalenceAction(input: {
  equivalenceId: string;
  justification?: string | null;
}) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  const equivalence = await prisma.resourceEquivalence.findFirst({
    where: {
      id: input.equivalenceId,
      sourceResource: { userId: user.id },
      targetResource: { userId: user.id },
    },
  });

  if (!equivalence) {
    return { success: false, error: "Equivalência não encontrada" };
  }

  const confirmed = await prisma.resourceEquivalence.update({
    where: { id: equivalence.id },
    data: {
      confirmed: true,
      confirmedBy: user.id,
      justification:
        input.justification?.trim() || equivalence.justification || "Equivalência confirmada.",
    },
  });

  await createAuditEntry({
    userId: user.id,
    entityType: "ResourceEquivalence",
    entityId: equivalence.id,
    action: "UPDATE",
    changes: { action: "CONFIRM", after: confirmed },
  });

  safeRevalidatePath("/resources");
  safeRevalidatePath("/compositions");
  return { success: true };
}

export async function deleteResourceEquivalenceAction(equivalenceId: string) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  const equivalence = await prisma.resourceEquivalence.findFirst({
    where: {
      id: equivalenceId,
      sourceResource: { userId: user.id },
      targetResource: { userId: user.id },
    },
  });

  if (!equivalence) {
    return { success: false, error: "Equivalência não encontrada" };
  }

  await prisma.resourceEquivalence.delete({ where: { id: equivalenceId } });
  safeRevalidatePath("/resources");
  safeRevalidatePath("/compositions");
  return { success: true };
}

function safeRevalidatePath(path: string) {
  try {
    revalidatePath(path);
  } catch {
    // Ignora quando executado fora do contexto de requisição HTTP do Next.js
  }
}
