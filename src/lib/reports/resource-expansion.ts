/**
 * Expansão determinística de composições em insumos — ObraCalc
 *
 * Percorre a árvore de composições (incluindo subcomposições) e devolve os
 * insumos folha com o coeficiente acumulado por unidade da composição raiz.
 *
 * Regras:
 * - Composições fechadas nunca são decompostas arbitrariamente. Quando a fonte
 *   informa as parcelas por categoria, elas são preservadas como linhas
 *   sintéticas; caso contrário, uma única linha sintética representa o valor.
 * - Conversões de unidade seguem exatamente a mesma precedência do motor de
 *   cálculo: fator explícito > unidade do componente > unidade de destino.
 * - Nenhum valor é arredondado aqui: a reconciliação é feita no relatório.
 */

import Decimal from "decimal.js";
import { defaultUnitConverter } from "@/lib/engine/units";
import type { CompositionInput, ResourceCategory } from "@/lib/engine/types";

export interface ExpandedResource {
  /** Código do insumo (ou da composição fechada, quando sintética). */
  code: string;
  description: string;
  unit: string;
  category: ResourceCategory;
  /** Consumo acumulado por unidade da composição raiz. */
  coefficient: string;
  /** Preço unitário do insumo. */
  price: string;
  /** `true` quando a linha representa uma composição fechada. */
  synthetic: boolean;
  /** Composição de origem da linha (útil para rastreabilidade). */
  compositionCode: string;
}

const MAX_DEPTH = 32;

function D(value: string | number | Decimal | undefined | null): Decimal {
  if (value instanceof Decimal) return value;
  return new Decimal(value ?? 0);
}

function isClosed(composition: CompositionInput): boolean {
  return (
    composition.type === "CLOSED" ||
    (composition.components.length === 0 &&
      composition.closedTotalPrice !== undefined &&
      composition.closedTotalPrice !== null)
  );
}

function closedLines(composition: CompositionInput): ExpandedResource[] {
  const total = D(composition.closedTotalPrice);
  const parts: Array<{ category: ResourceCategory; price: Decimal; label: string }> = [
    {
      category: "MATERIAL",
      price: D(composition.closedMaterialPrice),
      label: "Material",
    },
    {
      category: "LABOR",
      price: D(composition.closedLaborPrice),
      label: "Mão de obra",
    },
    {
      category: "EQUIPMENT",
      price: D(composition.closedEquipmentPrice),
      label: "Equipamento",
    },
    {
      category: "OTHER",
      price: D(composition.closedOtherPrice),
      label: "Outros",
    },
  ];

  const partsSum = parts.reduce((acc, part) => acc.plus(part.price), new Decimal(0));
  const hasBreakdown = parts.some((part) => !part.price.isZero());

  if (hasBreakdown && partsSum.equals(total)) {
    return parts
      .filter((part) => !part.price.isZero())
      .map((part) => ({
        code: composition.code,
        description: `${composition.description} — ${part.label} (composição fechada)`,
        unit: composition.unit,
        category: part.category,
        coefficient: "1",
        price: part.price.toString(),
        synthetic: true,
        compositionCode: composition.code,
      }));
  }

  return [
    {
      code: composition.code,
      description: `${composition.description} (composição fechada)`,
      unit: composition.unit,
      category: "OTHER",
      coefficient: "1",
      price: total.toString(),
      synthetic: true,
      compositionCode: composition.code,
    },
  ];
}

/**
 * Expande uma composição em insumos folha.
 *
 * @param rootCompositionId Identificador da composição raiz.
 * @param catalog Catálogo contendo a raiz e todas as subcomposições alcançáveis.
 */
export function expandCompositionResources(
  rootCompositionId: string,
  catalog: Map<string, CompositionInput>
): ExpandedResource[] {
  const root = catalog.get(rootCompositionId);
  if (!root) {
    throw new Error(`Composição ${rootCompositionId} não encontrada no catálogo.`);
  }

  const output: ExpandedResource[] = [];
  const path: string[] = [];

  const walk = (composition: CompositionInput, multiplier: Decimal, depth: number): void => {
    if (depth > MAX_DEPTH) {
      throw new Error(
        `Profundidade máxima de composições excedida ao expandir ${rootCompositionId}.`
      );
    }

    if (path.includes(composition.id)) {
      // Ciclo: o motor de custo já sinaliza o erro; aqui evitamos loop infinito.
      return;
    }

    if (isClosed(composition)) {
      closedLines(composition).forEach((line) => {
        output.push({
          ...line,
          coefficient: multiplier.times(D(line.coefficient)).toString(),
        });
      });
      return;
    }

    path.push(composition.id);

    for (const component of composition.components) {
      const rawCoefficient = D(component.coefficient);

      let targetUnit: string | undefined;
      if (component.resource) {
        targetUnit = component.resource.unit;
      } else if (component.childComposition) {
        targetUnit = component.childComposition.unit;
      } else if (component.childCompositionId) {
        targetUnit = catalog.get(component.childCompositionId)?.unit;
      }

      let conversionFactor = new Decimal(1);
      if (
        component.unitConversionFactor !== undefined &&
        component.unitConversionFactor !== null &&
        String(component.unitConversionFactor).trim() !== ""
      ) {
        conversionFactor = D(component.unitConversionFactor);
      } else if (component.unit && targetUnit && component.unit !== targetUnit) {
        if (defaultUnitConverter.canConvert(component.unit, targetUnit)) {
          conversionFactor = defaultUnitConverter.factor(component.unit, targetUnit);
        }
      }

      const nextMultiplier = multiplier.times(rawCoefficient).times(conversionFactor);

      if (component.resource) {
        output.push({
          code: component.resource.code,
          description: component.resource.description,
          unit: component.resource.unit,
          category: component.resource.category,
          coefficient: nextMultiplier.toString(),
          price: component.resource.price,
          synthetic: false,
          compositionCode: composition.code,
        });
      } else if (component.childComposition) {
        walk(component.childComposition, nextMultiplier, depth + 1);
      } else if (component.childCompositionId) {
        const child = catalog.get(component.childCompositionId);
        if (child) {
          walk(child, nextMultiplier, depth + 1);
        }
      }
    }

    path.pop();
  };

  walk(root, new Decimal(1), 0);

  // Ordenação determinística para que snapshot, CSV, XLSX e PDF coincidam.
  return output.sort((a, b) => {
    const byCode = a.code.localeCompare(b.code, "pt-BR", { numeric: true });
    if (byCode !== 0) return byCode;
    const byUnit = a.unit.localeCompare(b.unit, "pt-BR");
    if (byUnit !== 0) return byUnit;
    return a.category.localeCompare(b.category);
  });
}

/**
 * Expande várias composições usando o mesmo catálogo. Útil para montar um
 * relatório de insumos a partir de uma revisão inteira.
 */
export function expandCompositionResourcesMany(
  rootCompositionIds: string[],
  catalog: Map<string, CompositionInput>
): Map<string, ExpandedResource[]> {
  const result = new Map<string, ExpandedResource[]>();
  for (const id of rootCompositionIds) {
    if (!result.has(id)) {
      result.set(id, expandCompositionResources(id, catalog));
    }
  }
  return result;
}
