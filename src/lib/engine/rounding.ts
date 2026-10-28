import Decimal from 'decimal.js';
import { InvalidRoundingPolicyError } from './errors';
import { toDecimal } from './decimal';
import { Rounder, RoundingMode, RoundingPolicy } from './types';

/**
 * Política de arredondamento padrão do ObraCalc, alinhada com as práticas
 * da construção civil brasileira e bases referenciais como SINAPI e SICRO:
 * - Preços unitários com 4 casas decimais para manter a precisão de insumos miúdos.
 * - Quantidades com 4 casas decimais.
 * - Coeficientes de consumo com 5 casas decimais (essencial para insumos de baixo coeficiente, ex.: pregos, conectores).
 * - Totais financeiros com 2 casas decimais (centavos de Real - R$).
 * - Modo ROUND_HALF_UP (arredondamento comercial padrão ABNT / NBR).
 */
export const DEFAULT_ROUNDING_POLICY: RoundingPolicy = Object.freeze({
  priceDecimals: 4,
  quantityDecimals: 4,
  coefficientDecimals: 5,
  totalDecimals: 2,
  roundingMode: 'ROUND_HALF_UP',
});

/** Modos de arredondamento aceitos pela política. */
export const ROUNDING_MODES: readonly RoundingMode[] = Object.freeze([
  'ROUND_HALF_UP',
  'ROUND_HALF_EVEN',
  'ROUND_UP',
  'ROUND_DOWN',
  'ROUND_CEILING',
  'ROUND_FLOOR',
]);

/** Limite superior de casas decimais aceito em qualquer campo da política. */
export const MAX_POLICY_DECIMALS = 12;

function assertDecimals(decimals: number, field: string): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_POLICY_DECIMALS) {
    throw new InvalidRoundingPolicyError(
      `A política de precisão é inválida: '${field}' deve ser um inteiro entre 0 e ${MAX_POLICY_DECIMALS} (recebido: ${decimals}).`
    );
  }
}

/**
 * Valida uma política completa e devolve uma cópia congelada.
 * A validação é intencionalmente estrita: uma política inconsistente produziria
 * totais irreconciliáveis e não pode ser aceita silenciosamente.
 */
export function validateRoundingPolicy(policy: RoundingPolicy): RoundingPolicy {
  assertDecimals(policy.priceDecimals, 'priceDecimals');
  assertDecimals(policy.quantityDecimals, 'quantityDecimals');
  assertDecimals(policy.coefficientDecimals, 'coefficientDecimals');
  assertDecimals(policy.totalDecimals, 'totalDecimals');

  if (!ROUNDING_MODES.includes(policy.roundingMode as RoundingMode)) {
    throw new InvalidRoundingPolicyError(
      `Modo de arredondamento desconhecido: '${policy.roundingMode}'. Valores aceitos: ${ROUNDING_MODES.join(', ')}.`
    );
  }

  return Object.freeze({ ...policy });
}

/** Combina uma política parcial com os padrões e valida o resultado. */
export function normalizeRoundingPolicy(
  policy: Partial<RoundingPolicy> = {}
): RoundingPolicy {
  return validateRoundingPolicy({ ...DEFAULT_ROUNDING_POLICY, ...policy });
}

/**
 * Mapeia o nome do modo de arredondamento textual para a respectiva constante numérica do Decimal.js.
 *
 * @param mode Modo de arredondamento (ex.: 'ROUND_HALF_UP', 'ROUND_HALF_EVEN')
 * @returns Constante de arredondamento do Decimal.js (ex.: Decimal.ROUND_HALF_UP)
 */
export function mapRoundingMode(mode: RoundingMode | string): Decimal.Rounding {
  switch (mode) {
    case 'ROUND_HALF_UP':
      return Decimal.ROUND_HALF_UP;
    case 'ROUND_HALF_EVEN':
      return Decimal.ROUND_HALF_EVEN;
    case 'ROUND_UP':
      return Decimal.ROUND_UP;
    case 'ROUND_DOWN':
      return Decimal.ROUND_DOWN;
    case 'ROUND_CEILING':
      return Decimal.ROUND_CEIL;
    case 'ROUND_FLOOR':
      return Decimal.ROUND_FLOOR;
    default:
      throw new InvalidRoundingPolicyError(
        `Modo de arredondamento desconhecido: '${mode}'. Valores aceitos: ${ROUNDING_MODES.join(', ')}.`
      );
  }
}

/**
 * Cria uma instância de `Rounder` configurada com a política de arredondamento fornecida.
 * Todos os cálculos utilizam exclusivamente a biblioteca Decimal.js para evitar erros de ponto flutuante.
 *
 * @param policy Política contendo número de casas decimais e modo de arredondamento
 * @returns Objeto com métodos determinísticos de arredondamento
 */
export function createRounder(
  policy: Partial<RoundingPolicy> = DEFAULT_ROUNDING_POLICY
): Rounder {
  const normalized = normalizeRoundingPolicy(policy);
  const decimalRounding = mapRoundingMode(normalized.roundingMode);

  return {
    policy: normalized,

    roundPrice(value: Decimal | string | number): Decimal {
      return toDecimal(value, 'preço').toDecimalPlaces(
        normalized.priceDecimals,
        decimalRounding
      );
    },

    roundQuantity(value: Decimal | string | number): Decimal {
      return toDecimal(value, 'quantidade').toDecimalPlaces(
        normalized.quantityDecimals,
        decimalRounding
      );
    },

    roundCoefficient(value: Decimal | string | number): Decimal {
      return toDecimal(value, 'coeficiente').toDecimalPlaces(
        normalized.coefficientDecimals,
        decimalRounding
      );
    },

    roundTotal(value: Decimal | string | number): Decimal {
      return toDecimal(value, 'total').toDecimalPlaces(
        normalized.totalDecimals,
        decimalRounding
      );
    },

    roundToDecimals(value: Decimal | string | number, decimals: number): Decimal {
      assertDecimals(decimals, 'decimals');
      return toDecimal(value, 'valor').toDecimalPlaces(decimals, decimalRounding);
    },
  };
}

/**
 * Instância padrão pré-configurada do executor de arredondamento com a política padrão do sistema.
 */
export const defaultRounder: Rounder = createRounder(DEFAULT_ROUNDING_POLICY);

// Reexporta a conversão decimal para preservar a API histórica do módulo.
export { toDecimal };
