import Decimal from 'decimal.js';
import { toDecimal, percentOf, toPercentage } from './decimal';
import {
  CircularCompositionError,
  InvalidClosedCompositionError,
  InvalidCompositionError,
  UnresolvedComponentError,
  UnitConversionError,
} from './errors';
import { applyBdi } from './bdi';
import { defaultRounder } from './rounding';
import {
  BudgetItemResult,
  ComponentCostBreakdown,
  ComponentDetail,
  ComponentInput,
  CompositionInput,
  CompositionResult,
  CostBreakdown,
  ResourceCategory,
  ResourceInput,
  Rounder,
  StageInput,
  StageResult,
} from './types';
import { defaultUnitConverter, UnitConverter } from './units';

/**
 * Catálogo de composições para resolução de subcomposições por id.
 * Pode ser um Map, um objeto chave-valor ou uma função de consulta.
 */
export type CompositionResolver =
  | Map<string, CompositionResult | CompositionInput>
  | Record<string, CompositionResult | CompositionInput>
  | ((id: string) => CompositionResult | CompositionInput | undefined);

/** Catálogo de insumos para resolução de componentes por `resourceId`. */
export type ResourceResolver =
  | Map<string, ResourceInput>
  | Record<string, ResourceInput>
  | ((id: string) => ResourceInput | undefined);

/** Opções de cálculo compartilhadas por composições, itens e etapas. */
export interface CalculationOptions {
  /** Política de arredondamento (padrão: `defaultRounder`). */
  rounder?: Rounder;
  /** Catálogo de composições auxiliares. */
  compositions?: CompositionResolver;
  /** Catálogo de insumos. */
  resources?: ResourceResolver;
  /** Conversor de unidades (padrão: unidades usuais da construção civil). */
  unitConverter?: UnitConverter;
  /** Profundidade máxima de recursão (proteção contra árvores patológicas). */
  maxDepth?: number;
  /** Cache opcional de resultados já calculados, compartilhável entre chamadas. */
  memo?: Map<string, CompositionResult>;
}

interface CalculationState {
  rounder: Rounder;
  compositions?: CompositionResolver;
  resources?: ResourceResolver;
  unitConverter: UnitConverter;
  maxDepth: number;
  memo: Map<string, CompositionResult>;
  path: string[];
}

const DEFAULT_MAX_DEPTH = 64;

/** Converte a categoria do insumo para a chave correspondente do desdobramento. */
function categoryKey(category: ResourceCategory): 'material' | 'labor' | 'equipment' | 'other' {
  switch (category) {
    case 'MATERIAL':
      return 'material';
    case 'LABOR':
      return 'labor';
    case 'EQUIPMENT':
      return 'equipment';
    case 'OTHER':
    default:
      return 'other';
  }
}

function isRounder(value: unknown): value is Rounder {
  return (
    !!value &&
    typeof (value as Rounder).roundPrice === 'function' &&
    typeof (value as Rounder).roundTotal === 'function' &&
    !!(value as Rounder).policy
  );
}

function policySignature(rounder: Rounder): string {
  const p = rounder.policy;
  return `${p.priceDecimals}:${p.quantityDecimals}:${p.coefficientDecimals}:${p.totalDecimals}:${p.roundingMode}`;
}

function createState(
  rounderOrOptions: Rounder | CalculationOptions = defaultRounder,
  visited?: Set<string>
): CalculationState {
  const options: CalculationOptions = isRounder(rounderOrOptions)
    ? { rounder: rounderOrOptions }
    : rounderOrOptions ?? {};

  const rounder = options.rounder ?? defaultRounder;
  return {
    rounder,
    compositions: options.compositions,
    resources: options.resources,
    unitConverter: options.unitConverter ?? defaultUnitConverter,
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    memo: options.memo ?? new Map<string, CompositionResult>(),
    path: visited ? Array.from(visited) : [],
  };
}

function lookup<T>(
  resolver: Map<string, T> | Record<string, T> | ((id: string) => T | undefined) | undefined,
  id: string
): T | undefined {
  if (!resolver) return undefined;
  if (typeof resolver === 'function') return resolver(id);
  if (resolver instanceof Map) return resolver.get(id);
  if (Object.prototype.hasOwnProperty.call(resolver, id)) {
    return (resolver as Record<string, T>)[id];
  }
  return undefined;
}

function emptyComponentBreakdown(): ComponentCostBreakdown {
  return {
    material: new Decimal(0),
    labor: new Decimal(0),
    equipment: new Decimal(0),
    other: new Decimal(0),
    unallocated: new Decimal(0),
    total: new Decimal(0),
  };
}

function finalizeComponentBreakdown(
  parts: Omit<ComponentCostBreakdown, 'total'>
): ComponentCostBreakdown {
  return {
    ...parts,
    total: parts.material
      .plus(parts.labor)
      .plus(parts.equipment)
      .plus(parts.other)
      .plus(parts.unallocated),
  };
}

/**
 * Normaliza um desdobramento de custo, garantindo o invariante
 * `total = material + labor + equipment + other + unallocated`.
 *
 * Valores legados sem `unallocated` têm a diferença calculada automaticamente.
 * Uma composição fechada com total de R$ 150.000 e sem categorias, por exemplo,
 * resulta em `unallocated = 150.000`, sem inventar rateio.
 */
export function normalizeCostBreakdown(cost: CostBreakdown): CostBreakdown {
  const material = toDecimal(cost.material ?? 0);
  const labor = toDecimal(cost.labor ?? 0);
  const equipment = toDecimal(cost.equipment ?? 0);
  const other = toDecimal(cost.other ?? 0);
  const categoriesTotal = material.plus(labor).plus(equipment).plus(other);

  const declaredTotal = toDecimal(cost.total ?? categoriesTotal);
  const unallocated =
    cost.unallocated !== undefined && cost.unallocated !== null
      ? toDecimal(cost.unallocated)
      : declaredTotal.minus(categoriesTotal);

  const total = categoriesTotal.plus(unallocated);

  return {
    material,
    labor,
    equipment,
    other,
    unallocated,
    total,
    // Uma parcela não desdobrada sempre torna o desdobramento indisponível,
    // mesmo que a fonte declare o contrário.
    breakdownUnavailable: cost.breakdownUnavailable === true || !unallocated.isZero(),
  };
}

/** Extrai a parcela não desdobrada, tratando custos legados sem o campo. */
function unallocatedOf(cost: CostBreakdown): Decimal {
  if (cost.unallocated !== undefined && cost.unallocated !== null) {
    return toDecimal(cost.unallocated);
  }
  return toDecimal(cost.total)
    .minus(cost.material)
    .minus(cost.labor)
    .minus(cost.equipment)
    .minus(cost.other);
}

function isProvided(value: string | undefined | null): value is string {
  return value !== undefined && value !== null && value.trim() !== '';
}

function memoKey(compositionId: string, rounder: Rounder): string {
  return `${compositionId}::${policySignature(rounder)}`;
}

function computeComposition(
  composition: CompositionInput,
  state: CalculationState
): CompositionResult {
  const compositionId = composition.id?.trim();
  if (!compositionId) {
    throw new InvalidCompositionError('Composição sem identificador (id) não pode ser calculada.');
  }

  const cycleStart = state.path.indexOf(compositionId);
  if (cycleStart >= 0) {
    throw new CircularCompositionError([
      ...state.path.slice(cycleStart),
      compositionId,
    ]);
  }

  if (state.path.length >= state.maxDepth) {
    throw new InvalidCompositionError(
      `Profundidade máxima de composições excedida (${state.maxDepth}) ao calcular '${compositionId}'. Verifique a estrutura da EAP/composições.`
    );
  }

  const key = memoKey(compositionId, state.rounder);
  const cached = state.memo.get(key);
  if (cached) return cached;

  state.path.push(compositionId);
  try {
    const result =
      composition.type === 'CLOSED'
        ? computeClosedComposition(composition, state)
        : computeAnalyticalComposition(composition, state);
    state.memo.set(key, result);
    return result;
  } finally {
    state.path.pop();
  }
}

/**
 * Composição fechada/sintética.
 *
 * O total de origem é sempre preservado. Quando a fonte não informa as parcelas
 * por categoria, o valor integral fica em `unallocated` e
 * `breakdownUnavailable = true`; nenhuma categoria é inventada.
 * Se as parcelas informadas não fecharem com o total, a diferença também é
 * exposta em `unallocated` em vez de ser distribuída artificialmente.
 */
function computeClosedComposition(
  composition: CompositionInput,
  state: CalculationState
): CompositionResult {
  const rounder = state.rounder;
  const hasMaterial = isProvided(composition.closedMaterialPrice);
  const hasLabor = isProvided(composition.closedLaborPrice);
  const hasEquipment = isProvided(composition.closedEquipmentPrice);
  const hasOther = isProvided(composition.closedOtherPrice);
  const hasTotal = isProvided(composition.closedTotalPrice);
  const hasAnyCategory = hasMaterial || hasLabor || hasEquipment || hasOther;

  if (!hasTotal && !hasAnyCategory) {
    throw new InvalidClosedCompositionError(
      `A composição fechada '${composition.code || composition.id}' não informa valor total nem parcelas por categoria.`
    );
  }

  const material = hasMaterial ? rounder.roundPrice(composition.closedMaterialPrice!) : new Decimal(0);
  const labor = hasLabor ? rounder.roundPrice(composition.closedLaborPrice!) : new Decimal(0);
  const equipment = hasEquipment
    ? rounder.roundPrice(composition.closedEquipmentPrice!)
    : new Decimal(0);
  const other = hasOther ? rounder.roundPrice(composition.closedOtherPrice!) : new Decimal(0);

  const categoriesTotal = material.plus(labor).plus(equipment).plus(other);
  const total = hasTotal ? rounder.roundPrice(composition.closedTotalPrice!) : categoriesTotal;
  const unallocated = total.minus(categoriesTotal);
  const breakdownUnavailable = !hasAnyCategory || !unallocated.isZero();

  const unitCost: CostBreakdown = {
    material,
    labor,
    equipment,
    other,
    unallocated,
    total,
    breakdownUnavailable,
  };

  return {
    compositionId: composition.id,
    unitCost,
    componentDetails: [],
    breakdownUnavailable,
  };
}

/**
 * Composição analítica: percorre insumos e composições auxiliares, aplica
 * encargos sociais, converte unidades e agrega o custo por categoria.
 *
 * Invariantes:
 * - `unitCost.total = material + labor + equipment + other + unallocated`;
 * - `soma(componentDetails[].totalPrice) = unitCost.total`;
 * - cada detalhe carrega seu próprio desdobramento por categoria.
 */
function computeAnalyticalComposition(
  composition: CompositionInput,
  state: CalculationState
): CompositionResult {
  const rounder = state.rounder;
  const components = composition.components ?? [];

  let materialAcc = new Decimal(0);
  let laborAcc = new Decimal(0);
  let equipmentAcc = new Decimal(0);
  let otherAcc = new Decimal(0);
  let unallocatedAcc = new Decimal(0);

  const componentDetails: ComponentDetail[] = [];

  components.forEach((component, index) => {
    const hasInlineResource = component.resource !== undefined && component.resource !== null;
    const hasInlineChild =
      component.childComposition !== undefined && component.childComposition !== null;
    const hasResourceId = isProvided(component.resourceId);
    const hasChildId = isProvided(component.childCompositionId);

    if ((hasInlineResource || hasResourceId) && (hasInlineChild || hasChildId)) {
      throw new InvalidCompositionError(
        `O componente ${index + 1} da composição '${composition.code || composition.id}' informa insumo e composição auxiliar simultaneamente; os vínculos são mutuamente exclusivos.`
      );
    }

    if (!hasInlineResource && !hasResourceId && !hasInlineChild && !hasChildId) {
      throw new UnresolvedComponentError(
        `O componente ${index + 1} da composição '${composition.code || composition.id}' não possui insumo nem composição auxiliar.`
      );
    }

    const componentId =
      component.id ||
      component.resourceId ||
      component.childCompositionId ||
      `${composition.id}-componente-${index + 1}`;

    let coefficient = rounder.roundCoefficient(
      toDecimal(component.coefficient ?? '0', `coeficiente do componente ${componentId}`)
    );

    if (hasInlineResource || hasResourceId) {
      let resource = component.resource;
      if (!resource && hasResourceId) {
        resource = lookup(state.resources, component.resourceId!);
        if (!resource) {
          throw new UnresolvedComponentError(
            `Insumo '${component.resourceId}' do componente '${componentId}' não foi encontrado no catálogo.`
          );
        }
      }

      const conversion = resolveCoefficientConversion(
        component,
        resource!.unit,
        state,
        componentId
      );
      coefficient = rounder.roundCoefficient(coefficient.times(conversion.factor));

      const price = toDecimal(resource!.price, `preço do insumo ${resource!.code || resource!.id}`);
      if (price.isNegative()) {
        throw new InvalidCompositionError(
          `O insumo '${resource!.code || resource!.id}' possui preço negativo (${price.toString()}).`
        );
      }

      const basePrice = rounder.roundPrice(price);
      let effectivePrice = price;
      let laborChargesRate: Decimal | undefined;
      let laborChargesAmount: Decimal | undefined;

      if (resource!.category === 'LABOR' && !resource!.laborChargesIncluded) {
        const rateText = resource!.laborChargesRate;
        if (isProvided(rateText)) {
          laborChargesRate = toPercentage(
            rateText,
            `encargos sociais do insumo ${resource!.code || resource!.id}`
          );
          if (laborChargesRate.isPositive()) {
            effectivePrice = price.plus(percentOf(price, laborChargesRate));
          }
        }
      }

      const unitPrice = rounder.roundPrice(effectivePrice);
      if (laborChargesRate) {
        laborChargesAmount = unitPrice.minus(basePrice);
      }

      const totalPrice = rounder.roundTotal(coefficient.times(unitPrice));

      const parts = emptyComponentBreakdown();
      const key = categoryKey(resource!.category);
      parts[key] = totalPrice;
      const costBreakdown = finalizeComponentBreakdown(parts);

      switch (resource!.category) {
        case 'MATERIAL':
          materialAcc = materialAcc.plus(totalPrice);
          break;
        case 'LABOR':
          laborAcc = laborAcc.plus(totalPrice);
          break;
        case 'EQUIPMENT':
          equipmentAcc = equipmentAcc.plus(totalPrice);
          break;
        case 'OTHER':
        default:
          otherAcc = otherAcc.plus(totalPrice);
          break;
      }

      componentDetails.push({
        componentId,
        description: resource!.description,
        unit: resource!.unit,
        coefficient,
        unitPrice,
        totalPrice,
        category: resource!.category,
        costBreakdown,
        appliedUnitConversionFactor: conversion.applied
          ? conversion.factor
          : undefined,
        sourceUnit: conversion.applied ? conversion.sourceUnit : undefined,
        laborChargesRate,
        laborChargesAmount,
      });
      return;
    }

    // Composição auxiliar (inline ou resolvida por id no catálogo)
    let child: CompositionInput | CompositionResult | undefined = component.childComposition;
    if (!child && hasChildId) {
      child = lookup(state.compositions, component.childCompositionId!);
      if (!child) {
        throw new UnresolvedComponentError(
          `Composição auxiliar '${component.childCompositionId}' do componente '${componentId}' não foi encontrada no catálogo.`
        );
      }
    }

    if (!child) {
      throw new UnresolvedComponentError(
        `Composição auxiliar do componente '${componentId}' não foi resolvida.`
      );
    }

    const isPrecomputed = 'unitCost' in child;
    const childResult: CompositionResult = isPrecomputed
      ? (child as CompositionResult)
      : computeComposition(child as CompositionInput, state);
    const childDescription = isPrecomputed
      ? `Composição ${(child as CompositionResult).compositionId}`
      : (child as CompositionInput).description;
    const childUnit = isPrecomputed
      ? component.unit ?? ''
      : (child as CompositionInput).unit;

    const childCost = normalizeCostBreakdown(childResult.unitCost);
    const conversion = resolveCoefficientConversion(component, childUnit, state, componentId);
    coefficient = rounder.roundCoefficient(coefficient.times(conversion.factor));

    const parts: Omit<ComponentCostBreakdown, 'total'> = {
      material: rounder.roundTotal(coefficient.times(childCost.material)),
      labor: rounder.roundTotal(coefficient.times(childCost.labor)),
      equipment: rounder.roundTotal(coefficient.times(childCost.equipment)),
      other: rounder.roundTotal(coefficient.times(childCost.other)),
      unallocated: rounder.roundTotal(coefficient.times(unallocatedOf(childCost))),
    };
    const costBreakdown = finalizeComponentBreakdown(parts);

    materialAcc = materialAcc.plus(parts.material);
    laborAcc = laborAcc.plus(parts.labor);
    equipmentAcc = equipmentAcc.plus(parts.equipment);
    otherAcc = otherAcc.plus(parts.other);
    unallocatedAcc = unallocatedAcc.plus(parts.unallocated);

    componentDetails.push({
      componentId,
      description: childDescription,
      unit: childUnit,
      coefficient,
      unitPrice: rounder.roundPrice(childCost.total),
      // O total da linha é a soma exata das parcelas propagadas; isso garante
      // que a soma dos detalhes feche com o custo unitário da composição.
      totalPrice: costBreakdown.total,
      category: 'COMPOSITION',
      costBreakdown,
      appliedUnitConversionFactor: conversion.applied ? conversion.factor : undefined,
      sourceUnit: conversion.applied ? conversion.sourceUnit : undefined,
    });
  });

  const material = materialAcc;
  const labor = laborAcc;
  const equipment = equipmentAcc;
  const other = otherAcc;
  const unallocated = unallocatedAcc;
  const total = material.plus(labor).plus(equipment).plus(other).plus(unallocated);
  const breakdownUnavailable = !unallocated.isZero();

  const unitCost: CostBreakdown = {
    material,
    labor,
    equipment,
    other,
    unallocated,
    total,
    breakdownUnavailable,
  };

  return {
    compositionId: composition.id,
    unitCost,
    componentDetails,
    breakdownUnavailable,
  };
}

interface CoefficientConversion {
  factor: Decimal;
  applied: boolean;
  sourceUnit?: string;
}

/**
 * Resolve a conversão do coeficiente para a unidade do insumo/subcomposição.
 *
 * Precedência:
 * 1. `unitConversionFactor` explícito (compatibilidade e conversões comerciais);
 * 2. `component.unit` diferente da unidade de destino, via conversor determinístico.
 */
function resolveCoefficientConversion(
  component: ComponentInput,
  targetUnit: string | undefined,
  state: CalculationState,
  componentId: string
): CoefficientConversion {
  const explicit = component.unitConversionFactor;
  if (explicit !== undefined && explicit !== null && String(explicit).trim() !== '') {
    const factor = toDecimal(explicit, `fator de conversão do componente ${componentId}`);
    if (!factor.isFinite() || factor.lessThanOrEqualTo(0)) {
      throw new UnitConversionError(
        `Fator de conversão inválido no componente '${componentId}': ${factor.toString()} (deve ser maior que zero).`
      );
    }
    return { factor, applied: true, sourceUnit: component.unit };
  }

  if (!isProvided(component.unit)) {
    return { factor: new Decimal(1), applied: false };
  }

  if (!isProvided(targetUnit)) {
    throw new UnitConversionError(
      `O componente '${componentId}' informa a unidade '${component.unit}', mas a unidade de destino não foi informada.`
    );
  }

  const source = state.unitConverter.normalize(component.unit);
  const target = state.unitConverter.normalize(targetUnit);
  if (source === target) {
    return { factor: new Decimal(1), applied: false };
  }

  const factor = state.unitConverter.factor(component.unit, targetUnit);
  return { factor, applied: true, sourceUnit: component.unit };
}

/**
 * Calcula o custo unitário direto de uma composição de serviços.
 *
 * @param composition Dados completos da composição e seus insumos/subcomposições
 * @param rounderOrOptions Executor de arredondamento ou opções completas de cálculo
 * @param visited Conjunto de IDs já visitados (compatibilidade com chamadas legadas)
 * @returns CompositionResult com custo unitário desdobrado e detalhamento por componente
 * @throws CircularCompositionError quando há dependência circular
 */
export function calculateCompositionCost(
  composition: CompositionInput,
  rounderOrOptions: Rounder | CalculationOptions = defaultRounder,
  visited: Set<string> = new Set()
): CompositionResult {
  const state = createState(rounderOrOptions, visited);
  return computeComposition(composition, state);
}

/** Parâmetros de entrada para cálculo de item do orçamento. */
export interface CalculateBudgetItemParams {
  id?: string;
  itemId?: string;
  quantity: string | Decimal | number;
  compositionCost: CostBreakdown;
  bdiRate: string | Decimal | number;
}

export interface ItemCategoryAmounts {
  categoryAmounts: ComponentCostBreakdown;
  subtotal: Decimal;
  roundingResidual: Decimal;
  breakdownAvailable: boolean;
}

/**
 * Calcula os valores de um item por categoria e aloca, de forma determinística,
 * o resíduo de arredondamento na maior categoria (desempate pela ordem fixa
 * MATERIAL, LABOR, EQUIPMENT, OTHER). Assim:
 *
 * `material + labor + equipment + other + unallocated === subtotal`
 *
 * sem depender de arredondamentos intermediários coincidentes.
 */
export function calculateItemCategoryAmounts(
  quantityInput: string | Decimal | number,
  compositionCost: CostBreakdown,
  rounder: Rounder = defaultRounder
): ItemCategoryAmounts {
  const quantity = rounder.roundQuantity(toDecimal(quantityInput, 'quantidade'));
  const unitCost = normalizeCostBreakdown(compositionCost);
  const subtotal = rounder.roundTotal(quantity.times(unitCost.total));

  const amounts: ComponentCostBreakdown = {
    material: rounder.roundTotal(quantity.times(unitCost.material)),
    labor: rounder.roundTotal(quantity.times(unitCost.labor)),
    equipment: rounder.roundTotal(quantity.times(unitCost.equipment)),
    other: rounder.roundTotal(quantity.times(unitCost.other)),
    unallocated: rounder.roundTotal(quantity.times(unallocatedOf(unitCost))),
    total: new Decimal(0),
  };

  const allocated = amounts.material
    .plus(amounts.labor)
    .plus(amounts.equipment)
    .plus(amounts.other)
    .plus(amounts.unallocated);
  const roundingResidual = subtotal.minus(allocated);

  if (!roundingResidual.isZero()) {
    type CategoryKey = 'material' | 'labor' | 'equipment' | 'other';
    const categoryValues: Array<{ key: CategoryKey; value: Decimal }> = [
      { key: 'material', value: amounts.material },
      { key: 'labor', value: amounts.labor },
      { key: 'equipment', value: amounts.equipment },
      { key: 'other', value: amounts.other },
    ];
    const candidates: Array<{ key: CategoryKey; value: Decimal; weight: Decimal }> =
      categoryValues.map((candidate) => {
        const weight = candidate.value.abs();
        return {
          key: candidate.key,
          value: candidate.value,
          // Se o valor arredondado da categoria zerou, o peso unitário ainda
          // identifica qual categoria é materialmente maior.
          weight: weight.isZero() ? toDecimal(unitCost[candidate.key]).abs() : weight,
        };
      });

    const hasAllocatedCategory = candidates.some((candidate) => candidate.weight.greaterThan(0));

    if (!hasAllocatedCategory) {
      amounts.unallocated = amounts.unallocated.plus(roundingResidual);
    } else {
      // Maior peso; a ordem fixa do array resolve empates.
      let target = candidates[0];
      for (const candidate of candidates.slice(1)) {
        if (candidate.weight.greaterThan(target.weight)) {
          target = candidate;
        }
      }
      amounts[target.key] = amounts[target.key].plus(roundingResidual);
    }
  }

  amounts.total = amounts.material
    .plus(amounts.labor)
    .plus(amounts.equipment)
    .plus(amounts.other)
    .plus(amounts.unallocated);

  return {
    categoryAmounts: amounts,
    subtotal,
    roundingResidual,
    breakdownAvailable:
      unallocatedOf(unitCost).isZero() && unitCost.breakdownUnavailable !== true,
  };
}

/**
 * Calcula os valores financeiros de um item da planilha orçamentária:
 *
 *   subtotal = quantity × unitCost.total (arredondado para totalDecimals)
 *   bdiAmount = subtotal × bdiRate / 100 (arredondado uma única vez)
 *   subtotalWithBdi = subtotal + bdiAmount (soma exata, sem resíduo)
 */
export function calculateBudgetItem(
  item: CalculateBudgetItemParams,
  rounder: Rounder = defaultRounder
): BudgetItemResult {
  const unitCost = normalizeCostBreakdown(item.compositionCost);
  const quantity = rounder.roundQuantity(toDecimal(item.quantity, 'quantidade'));

  const subtotal = rounder.roundTotal(quantity.times(unitCost.total));
  const bdi = applyBdi(subtotal, item.bdiRate, rounder);

  const { categoryAmounts, roundingResidual, breakdownAvailable } =
    calculateItemCategoryAmounts(quantity, unitCost, rounder);

  return {
    itemId: item.itemId ?? item.id ?? '',
    quantity,
    unitCost,
    subtotal,
    bdiRate: bdi.rate,
    bdiAmount: bdi.bdiAmount,
    subtotalWithBdi: bdi.total,
    categoryAmounts,
    roundingResidual,
    breakdownAvailable,
  };
}

/** Opções adicionais para cálculo de etapas. */
export type StageCalculationOptions = Omit<
  CalculationOptions,
  'rounder' | 'compositions'
>;

function resolveCompositionForStage(
  compositionId: string,
  state: CalculationState
): CompositionResult {
  const found = lookup(state.compositions, compositionId);
  if (!found) {
    throw new UnresolvedComponentError(
      `Composição '${compositionId}' não encontrada no catálogo para cálculo do item.`
    );
  }

  if ('unitCost' in found) {
    return found as CompositionResult;
  }

  return computeComposition(found as CompositionInput, state);
}

function calculateStageInternal(stage: StageInput, state: CalculationState): StageResult {
  const itemsResults: BudgetItemResult[] = [];

  for (const rawItem of stage.items || []) {
    let cost: CostBreakdown | undefined = rawItem.compositionCost;

    if (!cost && 'compositionId' in rawItem && rawItem.compositionId) {
      const result = resolveCompositionForStage(rawItem.compositionId, state);
      cost = normalizeCostBreakdown(result.unitCost);
    }

    if (!cost) {
      const itemIdentifier = rawItem.itemId || rawItem.id || 'desconhecido';
      throw new UnresolvedComponentError(
        `Não foi possível calcular o item '${itemIdentifier}': custo unitário da composição não informado.`
      );
    }

    itemsResults.push(
      calculateBudgetItem(
        {
          id: rawItem.id,
          itemId: rawItem.itemId,
          quantity: rawItem.quantity,
          compositionCost: cost,
          bdiRate: rawItem.bdiRate,
        },
        state.rounder
      )
    );
  }

  const childStagesResults: StageResult[] = [];
  for (const childStage of stage.childStages || []) {
    childStagesResults.push(calculateStageInternal(childStage, state));
  }

  const directItemsSubtotal = itemsResults.reduce(
    (acc, item) => acc.plus(item.subtotal),
    new Decimal(0)
  );
  const directItemsBdiAmount = itemsResults.reduce(
    (acc, item) => acc.plus(item.bdiAmount),
    new Decimal(0)
  );
  const directItemsSubtotalWithBdi = itemsResults.reduce(
    (acc, item) => acc.plus(item.subtotalWithBdi),
    new Decimal(0)
  );
  const childStagesSubtotal = childStagesResults.reduce(
    (acc, child) => acc.plus(child.subtotal),
    new Decimal(0)
  );
  const childStagesBdiAmount = childStagesResults.reduce(
    (acc, child) => acc.plus(child.bdiAmount),
    new Decimal(0)
  );
  const childStagesSubtotalWithBdi = childStagesResults.reduce(
    (acc, child) => acc.plus(child.subtotalWithBdi),
    new Decimal(0)
  );

  return {
    stageId: stage.id,
    items: itemsResults,
    childStages: childStagesResults,
    subtotal: state.rounder.roundTotal(directItemsSubtotal.plus(childStagesSubtotal)),
    bdiAmount: state.rounder.roundTotal(
      directItemsBdiAmount.plus(childStagesBdiAmount)
    ),
    subtotalWithBdi: state.rounder.roundTotal(
      directItemsSubtotalWithBdi.plus(childStagesSubtotalWithBdi)
    ),
  };
}

/**
 * Calcula recursivamente uma etapa da Estrutura Analítica do Projeto (EAP / WBS).
 *
 * O subtotal da etapa é a soma estrita de seus itens diretos e dos subtotais
 * consolidados das subetapas imediatas, sem dupla contagem.
 */
export function calculateStage(
  stage: StageInput,
  compositions?: CompositionResolver,
  rounder: Rounder = defaultRounder,
  options: StageCalculationOptions = {}
): StageResult {
  const state = createState({ ...options, rounder, compositions });
  return calculateStageInternal(stage, state);
}

/** Resumo consolidado do orçamento completo. */
export interface BudgetTotalsSummary {
  /** Subtotal direto consolidado sem BDI */
  subtotal: Decimal;
  /** Subtotal consolidado final com BDI */
  subtotalWithBdi: Decimal;
  /** Valor monetário absoluto total do BDI (subtotalWithBdi - subtotal) */
  totalBdiAmount: Decimal;
  /** Taxa efetiva global ponderada de BDI em percentual (%) */
  effectiveBdiRate: Decimal;
}

/**
 * Consolida os totais do orçamento a partir da lista de etapas de nível raiz (nível 1).
 * Garante que apenas as etapas do topo da árvore sejam somadas para impedir dupla contagem de subetapas.
 */
export function calculateBudgetTotals(
  rootStages: StageResult[],
  rounder: Rounder = defaultRounder
): BudgetTotalsSummary {
  const subtotal = rounder.roundTotal(
    rootStages.reduce((acc, stage) => acc.plus(stage.subtotal), new Decimal(0))
  );

  const subtotalWithBdi = rounder.roundTotal(
    rootStages.reduce((acc, stage) => acc.plus(stage.subtotalWithBdi), new Decimal(0))
  );

  const totalBdiAmount = rounder.roundTotal(subtotalWithBdi.minus(subtotal));

  const effectiveBdiRate = subtotal.isZero()
    ? new Decimal(0)
    : rounder.roundToDecimals(totalBdiAmount.dividedBy(subtotal).times(100), 4);

  return {
    subtotal,
    subtotalWithBdi,
    totalBdiAmount,
    effectiveBdiRate,
  };
}

/**
 * Resumo consolidado e reconciliado do orçamento com decomposição vertical e horizontal.
 */
export interface ReconciledBudgetSummary extends BudgetTotalsSummary {
  /** Soma total direta de materiais */
  totalMaterial: Decimal;
  /** Soma total direta de mão de obra */
  totalLabor: Decimal;
  /** Soma total direta de equipamentos */
  totalEquipment: Decimal;
  /** Soma total direta de outros custos */
  totalOther: Decimal;
  /** Soma das categorias desdobradas (não inclui parcela não desdobrada) */
  categoryTotal: Decimal;
  /** Custo sem desdobramento por categoria (composições fechadas, etc.) */
  totalUnallocated: Decimal;
  /** Categorias + parcela não desdobrada */
  accountedTotal: Decimal;
  /**
   * Discrepância entre o subtotal vertical e `categoryTotal`.
   * Para itens sem desdobramento, é igual a `totalUnallocated`.
   */
  roundingDiscrepancy: Decimal;
  /** `true` quando `accountedTotal === subtotal` exatamente (reconciliação contábil). */
  isTotalsExact: boolean;
  /**
   * `true` quando, além do fechamento exato, não há nenhuma parcela sem
   * desdobramento por categoria.
   */
  isReconciled: boolean;
}

function collectAllStageItems(stage: StageResult): BudgetItemResult[] {
  const items = [...stage.items];
  for (const child of stage.childStages) {
    items.push(...collectAllStageItems(child));
  }
  return items;
}

/**
 * Reconcilia os totais verticais (subtotais de itens e etapas) com os totais
 * horizontais (decomposição por categoria).
 *
 * Cada item já carrega `categoryAmounts` fechado exatamente com seu subtotal.
 * Portanto `accountedTotal` é sempre idêntico ao subtotal vertical; qualquer
 * parcela sem categoria aparece em `totalUnallocated`, nunca diluída.
 */
export function reconcileBudgetTotals(
  rootStages: StageResult[],
  rounder: Rounder = defaultRounder
): ReconciledBudgetSummary {
  const baseTotals = calculateBudgetTotals(rootStages, rounder);

  const allItems: BudgetItemResult[] = [];
  for (const root of rootStages) {
    allItems.push(...collectAllStageItems(root));
  }

  let totalMaterialAcc = new Decimal(0);
  let totalLaborAcc = new Decimal(0);
  let totalEquipmentAcc = new Decimal(0);
  let totalOtherAcc = new Decimal(0);
  let totalUnallocatedAcc = new Decimal(0);

  for (const item of allItems) {
    const amounts =
      item.categoryAmounts ??
      calculateItemCategoryAmounts(item.quantity, item.unitCost, rounder).categoryAmounts;

    totalMaterialAcc = totalMaterialAcc.plus(amounts.material);
    totalLaborAcc = totalLaborAcc.plus(amounts.labor);
    totalEquipmentAcc = totalEquipmentAcc.plus(amounts.equipment);
    totalOtherAcc = totalOtherAcc.plus(amounts.other);
    totalUnallocatedAcc = totalUnallocatedAcc.plus(amounts.unallocated);
  }

  const totalMaterial = rounder.roundTotal(totalMaterialAcc);
  const totalLabor = rounder.roundTotal(totalLaborAcc);
  const totalEquipment = rounder.roundTotal(totalEquipmentAcc);
  const totalOther = rounder.roundTotal(totalOtherAcc);
  const totalUnallocated = rounder.roundTotal(totalUnallocatedAcc);

  const categoryTotal = rounder.roundTotal(
    totalMaterial.plus(totalLabor).plus(totalEquipment).plus(totalOther)
  );
  const accountedTotal = rounder.roundTotal(categoryTotal.plus(totalUnallocated));
  const roundingDiscrepancy = baseTotals.subtotal.minus(accountedTotal);

  return {
    ...baseTotals,
    totalMaterial,
    totalLabor,
    totalEquipment,
    totalOther,
    categoryTotal,
    totalUnallocated,
    accountedTotal,
    roundingDiscrepancy,
    isTotalsExact: roundingDiscrepancy.isZero(),
    isReconciled: roundingDiscrepancy.isZero() && totalUnallocated.isZero(),
  };
}
