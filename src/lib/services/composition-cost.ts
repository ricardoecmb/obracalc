import Decimal from "decimal.js";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { calculateCompositionCost } from "@/lib/engine/calculator";
import { createRounder } from "@/lib/engine/rounding";
import { defaultUnitConverter } from "@/lib/engine/units";
import type {
  CompositionInput,
  CompositionResult,
  CostBreakdown,
  Rounder,
} from "@/lib/engine/types";

/**
 * Erro de domínio lançado quando uma composição não existe ou não pertence
 * ao usuário autenticado. Mantém as mensagens estáveis para os testes.
 */
export class CompositionNotFoundError extends Error {
  constructor(compositionId: string) {
    super(`Composição ${compositionId} não encontrada.`);
    this.name = "CompositionNotFoundError";
  }
}

export interface CompositionCatalogOptions {
  /** Quando informado, restringe o carregamento às composições do usuário. */
  userId?: string;
  /**
   * Cliente Prisma alternativo (ex.: transação). Necessário quando o catálogo
   * precisa enxergar alterações ainda não commitadas, como atualizações de preço.
   */
  db?: Prisma.TransactionClient;
}

const compositionInclude = {
  components: {
    orderBy: { sortOrder: "asc" as const },
    include: { resource: true },
  },
};

type CompositionRecord = Prisma.CompositionGetPayload<{
  include: typeof compositionInclude;
}>;

function toCompositionInput(comp: CompositionRecord): CompositionInput {
  // Composição fechada, ou composição analítica sem componentes mas com valor
  // de origem, é tratada como fechada para preservar o custo de referência.
  const isClosed =
    comp.type === "CLOSED" ||
    (comp.components.length === 0 && comp.closedTotalPrice != null);

  return {
    id: comp.id,
    code: comp.code,
    description: comp.description,
    unit: comp.unit,
    type: isClosed ? "CLOSED" : "ANALYTICAL",
    closedTotalPrice: comp.closedTotalPrice?.toString(),
    closedMaterialPrice: comp.closedMaterialPrice?.toString(),
    closedLaborPrice: comp.closedLaborPrice?.toString(),
    closedEquipmentPrice: comp.closedEquipmentPrice?.toString(),
    closedOtherPrice: comp.closedOtherPrice?.toString(),
    components: comp.components.map((component) => ({
      id: component.id,
      coefficient: component.coefficient.toString(),
      resourceId: component.resourceId ?? undefined,
      childCompositionId: component.childCompositionId ?? undefined,
      resource: component.resource
        ? {
            id: component.resource.id,
            code: component.resource.code,
            description: component.resource.description,
            unit: component.resource.unit,
            category: component.resource.category as
              | "MATERIAL"
              | "LABOR"
              | "EQUIPMENT"
              | "OTHER",
            price: component.resource.price.toString(),
            laborChargesIncluded: component.resource.laborChargesIncluded,
            laborChargesRate: component.resource.laborChargesRate?.toString(),
          }
        : undefined,
    })),
  };
}

/**
 * Carrega o catálogo completo de composições necessário para calcular uma
 * composição raiz, percorrendo auxiliares em largura (BFS) e deduplicando por
 * id. O motor é quem detecta ciclos e lança `CircularCompositionError`.
 */
export async function loadCompositionCatalog(
  rootCompositionId: string,
  options: CompositionCatalogOptions = {}
): Promise<Map<string, CompositionInput>> {
  const db = options.db ?? prisma;
  const catalog = new Map<string, CompositionInput>();
  const queue: string[] = [rootCompositionId];
  const loaded = new Set<string>();

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (loaded.has(currentId)) continue;
    loaded.add(currentId);

    const comp = await db.composition.findFirst({
      where: {
        id: currentId,
        ...(options.userId ? { userId: options.userId } : {}),
      },
      include: compositionInclude,
    });

    if (!comp) {
      throw new CompositionNotFoundError(currentId);
    }

    const input = toCompositionInput(comp);
    catalog.set(comp.id, input);

    for (const component of comp.components) {
      if (component.childCompositionId) {
        queue.push(component.childCompositionId);
      }
    }
  }

  return catalog;
}

/**
 * Calcula o resultado completo (custo unitário + detalhes por componente) de
 * uma composição persistida no banco.
 */
export async function evaluateComposition(
  compositionId: string,
  options: CompositionCatalogOptions & { rounder?: Rounder } = {}
): Promise<CompositionResult> {
  const catalog = await loadCompositionCatalog(compositionId, options);
  const root = catalog.get(compositionId);

  if (!root) {
    throw new CompositionNotFoundError(compositionId);
  }

  return calculateCompositionCost(root, {
    rounder: options.rounder ?? createRounder(),
    compositions: catalog,
    unitConverter: defaultUnitConverter,
  });
}

/**
 * Resolve apenas o desdobramento de custo unitário de uma composição,
 * reutilizado pelo orçamento, pela duplicação e pela simulação.
 */
export async function resolveCompositionCost(
  compositionId: string,
  rounder: Rounder = createRounder(),
  options: CompositionCatalogOptions = {}
): Promise<CostBreakdown> {
  const result = await evaluateComposition(compositionId, { ...options, rounder });
  return result.unitCost;
}

/**
 * Verifica se vincular `childCompositionId` como auxiliar de `parentId`
 * criaria um ciclo. Percorre toda a subárvore da filha em busca do pai.
 */
export async function wouldCreateCompositionCycle(
  parentId: string,
  childCompositionId: string,
  options: CompositionCatalogOptions = {}
): Promise<boolean> {
  if (parentId === childCompositionId) return true;

  const db = options.db ?? prisma;
  const visited = new Set<string>();
  const queue: string[] = [childCompositionId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === parentId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const comp = await db.composition.findFirst({
      where: {
        id: current,
        ...(options.userId ? { userId: options.userId } : {}),
      },
      select: {
        components: {
          select: { childCompositionId: true },
        },
      },
    });

    if (!comp) {
      // Filha inexistente é validada separadamente pela ação de escrita.
      return false;
    }

    for (const component of comp.components) {
      if (component.childCompositionId) {
        queue.push(component.childCompositionId);
      }
    }
  }

  return false;
}

/**
 * Simula a troca do insumo de um componente por outro insumo, sem persistir.
 * Retorna o resultado antes/depois e o detalhe do componente afetado.
 */
export async function evaluateCompositionWithResourceOverride(params: {
  compositionId: string;
  componentId: string;
  targetResourceId: string;
  userId: string;
  rounder?: Rounder;
}): Promise<{
  before: CompositionResult;
  after: CompositionResult;
  targetResource: {
    id: string;
    code: string;
    description: string;
    unit: string;
    price: string;
    category: string;
  };
  componentBefore: { description: string; totalPrice: string } | null;
  componentAfter: { description: string; totalPrice: string } | null;
}> {
  const rounder = params.rounder ?? createRounder();
  const catalog = await loadCompositionCatalog(params.compositionId, {
    userId: params.userId,
  });

  const root = catalog.get(params.compositionId);
  if (!root) throw new CompositionNotFoundError(params.compositionId);

  const target = await prisma.resource.findFirst({
    where: { id: params.targetResourceId, userId: params.userId },
  });

  if (!target) {
    throw new Error("Insumo de destino não encontrado para este usuário.");
  }

  const targetResource = {
    id: target.id,
    code: target.code,
    description: target.description,
    unit: target.unit,
    price: target.price.toString(),
    category: target.category as string,
  };

  const evaluate = (compositionCatalog: Map<string, CompositionInput>) => {
    const comp = compositionCatalog.get(params.compositionId);
    if (!comp) throw new CompositionNotFoundError(params.compositionId);
    return calculateCompositionCost(comp, {
      rounder,
      compositions: compositionCatalog,
      unitConverter: defaultUnitConverter,
    });
  };

  const before = evaluate(catalog);

  let replaced = false;
  const overridden = new Map<string, CompositionInput>();
  for (const [id, composition] of catalog.entries()) {
    const components = composition.components.map((component) => {
      if (component.id !== params.componentId) return component;
      replaced = true;
      return {
        ...component,
        resourceId: target.id,
        resource: {
          id: target.id,
          code: target.code,
          description: target.description,
          unit: target.unit,
          category: target.category as
            | "MATERIAL"
            | "LABOR"
            | "EQUIPMENT"
            | "OTHER",
          price: target.price.toString(),
          laborChargesIncluded: target.laborChargesIncluded,
          laborChargesRate: target.laborChargesRate?.toString(),
        },
      };
    });
    overridden.set(id, { ...composition, components });
  }

  if (!replaced) {
    throw new Error("Componente não encontrado na composição.");
  }

  const after = evaluate(overridden);

  const componentBefore = before.componentDetails.find(
    (detail) => detail.componentId === params.componentId
  );
  const componentAfter = after.componentDetails.find(
    (detail) => detail.componentId === params.componentId
  );

  return {
    before,
    after,
    targetResource,
    componentBefore: componentBefore
      ? {
          description: componentBefore.description,
          totalPrice: componentBefore.totalPrice.toString(),
        }
      : null,
    componentAfter: componentAfter
      ? {
          description: componentAfter.description,
          totalPrice: componentAfter.totalPrice.toString(),
        }
      : null,
  };
}

/**
 * Converte um custo calculado em um objeto serializável (strings decimais),
 * evitando que instâncias de Decimal vazem para o cliente.
 */
export function serializeCostBreakdown(cost: CostBreakdown) {
  return {
    material: cost.material.toString(),
    labor: cost.labor.toString(),
    equipment: cost.equipment.toString(),
    other: cost.other.toString(),
    unallocated: cost.unallocated?.toString() ?? "0",
    total: cost.total.toString(),
    breakdownUnavailable: cost.breakdownUnavailable ?? false,
  };
}

/**
 * Diferença determinística entre dois desdobramentos de custo.
 */
export function diffCostBreakdown(before: CostBreakdown, after: CostBreakdown) {
  const keys = ["material", "labor", "equipment", "other", "total"] as const;
  return Object.fromEntries(
    keys.map((key) => [
      key,
      new Decimal(after[key] ?? 0).minus(new Decimal(before[key] ?? 0)).toString(),
    ])
  ) as Record<(typeof keys)[number], string>;
}
