import { prisma } from "@/lib/db/prisma";
import { DatabaseSource, TaxRegime, ResourceCategory, CompositionType } from "@prisma/client";
import Decimal from "decimal.js";

export interface CreateResourceParams {
  userId: string;
  referenceDatabaseId?: string | null;
  code: string;
  description: string;
  unit: string;
  category: ResourceCategory;
  source?: DatabaseSource;
  sourceState?: string | null;
  sourceMonth?: string | null; // Competência (ex: "2024/01")
  sourceTaxRegime?: TaxRegime | null;
  price: Decimal | string | number;
  priceDate?: Date;
  laborChargesIncluded?: boolean;
  laborChargesRate?: Decimal | string | number | null;
  supplierId?: string | null;
  notes?: string | null;
}

export interface UpdateResourcePriceParams {
  resourceId: string;
  userId: string;
  newPrice: Decimal | string | number;
  reason?: string;
  author?: string;
  effectiveDate?: Date;
}

/**
 * Cria um insumo respeitando a unicidade contextual da chave composta:
 * [userId, code, source, sourceState, sourceMonth, sourceTaxRegime]
 * Permitindo o mesmo código em competências (meses) ou estados diferentes.
 */
export async function createResource(params: CreateResourceParams) {
  const priceDecimal = new Decimal(params.price.toString());
  const effectiveDate = params.priceDate ?? new Date();

  return await prisma.$transaction(async (tx) => {
    const resource = await tx.resource.create({
      data: {
        userId: params.userId,
        referenceDatabaseId: params.referenceDatabaseId ?? null,
        code: params.code.trim(),
        description: params.description.trim(),
        unit: params.unit.trim(),
        category: params.category,
        source: params.source ?? DatabaseSource.CUSTOM,
        sourceState: params.sourceState?.toUpperCase().trim() ?? null,
        sourceMonth: params.sourceMonth?.trim() ?? null,
        sourceTaxRegime: params.sourceTaxRegime ?? null,
        price: priceDecimal,
        priceDate: effectiveDate,
        laborChargesIncluded: params.laborChargesIncluded ?? false,
        laborChargesRate: params.laborChargesRate
          ? new Decimal(params.laborChargesRate.toString())
          : null,
        supplierId: params.supplierId ?? null,
        notes: params.notes?.trim() ?? null,
      },
    });

    // Registra entrada inicial no histórico de preços
    await tx.resourcePriceHistory.create({
      data: {
        resourceId: resource.id,
        price: priceDecimal,
        source: params.source ?? "INITIAL",
        reason: "Preço inicial de referência",
        author: params.userId,
        effectiveDate,
      },
    });

    return resource;
  });
}

/**
 * Atualiza o preço de um insumo e gera registro auditável em ResourcePriceHistory.
 */
export async function updateResourcePrice(params: UpdateResourcePriceParams) {
  const newPriceDecimal = new Decimal(params.newPrice.toString());
  const effectiveDate = params.effectiveDate ?? new Date();

  return await prisma.$transaction(async (tx) => {
    // 1. Atualizar preço atual no insumo
    const updatedResource = await tx.resource.update({
      where: { id: params.resourceId },
      data: {
        price: newPriceDecimal,
        priceDate: effectiveDate,
      },
    });

    // 2. Criar registro histórico
    const historyEntry = await tx.resourcePriceHistory.create({
      data: {
        resourceId: params.resourceId,
        price: newPriceDecimal,
        source: "MANUAL_UPDATE",
        reason: params.reason ?? "Atualização de cotação / preço de referência",
        author: params.author ?? params.userId,
        effectiveDate,
      },
    });

    return { resource: updatedResource, historyEntry };
  });
}

export interface CreateCompositionComponentParams {
  resourceId?: string | null;
  childCompositionId?: string | null;
  coefficient: Decimal | string | number;
  sortOrder?: number;
  notes?: string | null;
}

export interface CreateCompositionParams {
  userId: string;
  referenceDatabaseId?: string | null;
  code: string;
  description: string;
  unit: string;
  source?: DatabaseSource;
  sourceState?: string | null;
  sourceMonth?: string | null;
  sourceTaxRegime?: TaxRegime | null;
  type?: CompositionType;
  closedTotalPrice?: Decimal | string | number | null;
  version?: number;
  originCompositionId?: string | null;
  components?: CreateCompositionComponentParams[];
}

/**
 * Cria uma composição analítica ou fechada com seus componentes vinculados
 * (insumos diretos ou subcomposições auxiliares).
 */
export async function createComposition(params: CreateCompositionParams) {
  return await prisma.$transaction(async (tx) => {
    const composition = await tx.composition.create({
      data: {
        userId: params.userId,
        referenceDatabaseId: params.referenceDatabaseId ?? null,
        code: params.code.trim(),
        description: params.description.trim(),
        unit: params.unit.trim(),
        source: params.source ?? DatabaseSource.CUSTOM,
        sourceState: params.sourceState?.toUpperCase().trim() ?? null,
        sourceMonth: params.sourceMonth?.trim() ?? null,
        sourceTaxRegime: params.sourceTaxRegime ?? null,
        type: params.type ?? CompositionType.ANALYTICAL,
        closedTotalPrice: params.closedTotalPrice
          ? new Decimal(params.closedTotalPrice.toString())
          : null,
        version: params.version ?? 1,
        originCompositionId: params.originCompositionId ?? null,
      },
    });

    if (params.components && params.components.length > 0) {
      for (let i = 0; i < params.components.length; i++) {
        const comp = params.components[i];
        await tx.compositionComponent.create({
          data: {
            compositionId: composition.id,
            resourceId: comp.resourceId ?? null,
            childCompositionId: comp.childCompositionId ?? null,
            coefficient: new Decimal(comp.coefficient.toString()),
            sortOrder: comp.sortOrder ?? i + 1,
            notes: comp.notes ?? null,
          },
        });
      }
    }

    return await tx.composition.findUnique({
      where: { id: composition.id },
      include: {
        components: {
          include: {
            resource: true,
            childComposition: true,
          },
        },
      },
    });
  });
}
