import Decimal from 'decimal.js';
import { toDecimal, toPercentage } from './decimal';
import { defaultRounder } from './rounding';
import {
  BdiCalculationMemory,
  BdiComponents,
  BdiConfigReference,
  BdiOrigin,
  BdiResolution,
  BdiResolutionInput,
  BdiResult,
  BdiValidationIssue,
  Rounder,
} from './types';

/**
 * Biblioteca de BDI (Bonificação e Despesas Indiretas) do ObraCalc.
 *
 * Fórmula canônica do Acórdão TCU nº 2622/2013 - Plenário:
 *
 *   A = 1 + AC + CF + S + G + MI
 *   B = 1 - (TM + TE + TF + L)
 *   BDI (%) = [ (A / B) - 1 ] × 100
 *
 * Todos os componentes são informados em base percentual (ex.: 3,00 para 3%).
 * O cálculo é 100% decimal e determinístico: não há ponto flutuante binário,
 * e um denominador inválido (B <= 0) nunca produz Infinity/NaN — o resultado é
 * marcado como inválido e a taxa retornada é zero.
 */

/** Chaves dos componentes do BDI, na ordem canônica da fórmula. */
export const BDI_COMPONENT_KEYS = [
  'ac',
  'cf',
  's',
  'g',
  'mi',
  'tm',
  'te',
  'tf',
  'l',
] as const;

export type BdiComponentKey = (typeof BDI_COMPONENT_KEYS)[number];

/** Metadados de cada componente do BDI. */
export interface BdiComponentDefinition {
  key: BdiComponentKey;
  /** Sigla usada na fórmula (AC, CF, S, G, MI, TM, TE, TF, L). */
  label: string;
  /** Nome legível em português. */
  name: string;
  /** Grupo da fórmula: numerador (custos indiretos) ou denominador (tributos e lucro). */
  group: 'numerator' | 'denominator';
  /** Descrição resumida da finalidade do componente. */
  description: string;
}

/** Definições dos componentes do BDI conforme Acórdão TCU nº 2622/2013. */
export const BDI_COMPONENT_DEFINITIONS: readonly BdiComponentDefinition[] = Object.freeze([
  {
    key: 'ac',
    label: 'AC',
    name: 'Administração Central',
    group: 'numerator',
    description: 'Custos da administração central rateados entre as obras.',
  },
  {
    key: 'cf',
    label: 'CF',
    name: 'Custo Financeiro',
    group: 'numerator',
    description: 'Custo do capital de giro e do financiamento da obra.',
  },
  {
    key: 's',
    label: 'S',
    name: 'Seguros',
    group: 'numerator',
    description: 'Prêmios de seguros contratuais e de responsabilidade civil.',
  },
  {
    key: 'g',
    label: 'G',
    name: 'Garantias',
    group: 'numerator',
    description: 'Custos de garantias contratuais e fianças.',
  },
  {
    key: 'mi',
    label: 'MI',
    name: 'Margem de Incerteza / Riscos',
    group: 'numerator',
    description: 'Provisão para riscos e incertezas não cobertos por seguros.',
  },
  {
    key: 'tm',
    label: 'TM',
    name: 'Tributos Municipais (ISS)',
    group: 'denominator',
    description: 'Imposto Sobre Serviços de competência municipal.',
  },
  {
    key: 'te',
    label: 'TE',
    name: 'Tributos Estaduais (ICMS)',
    group: 'denominator',
    description: 'Tributação estadual quando aplicável ao objeto.',
  },
  {
    key: 'tf',
    label: 'TF',
    name: 'Tributos Federais (PIS, COFINS, CPRB)',
    group: 'denominator',
    description: 'Contribuições federais incidentes sobre a receita.',
  },
  {
    key: 'l',
    label: 'L',
    name: 'Lucro / Remuneração da Construtora',
    group: 'denominator',
    description: 'Lucro líquido esperado pelo contrato.',
  },
]);

/** Fórmula textual canônica, exibida na memória de cálculo. */
export const BDI_FORMULA = Object.freeze({
  expression: 'BDI (%) = [ (A / B) - 1 ] × 100',
  numerator: 'A = 1 + AC + CF + S + G + MI',
  denominator: 'B = 1 - (TM + TE + TF + L)',
});

/** Casas decimais padrão do percentual de BDI (compatível com Decimal(8,4) do banco). */
export const DEFAULT_BDI_DECIMALS = 4;

/** Limite máximo de casas decimais aceito para o percentual de BDI. */
export const MAX_BDI_DECIMALS = 12;

/**
 * BDI padrão do sistema para edificações, alinhado às faixas medianas/usuais
 * do Acórdão TCU nº 2622/2013 e à configuração inicial da interface:
 *
 * AC 4,00% | CF 1,23% | S 0,40% | G 0,40% | MI 1,27%
 * TM 2,50% | TE 0,00% | TF 3,65% | L 7,40%
 *
 * Resulta em A = 1,0730, B = 0,8645 e BDI ≈ 24,1180%.
 */
export const DEFAULT_BDI_COMPONENTS: BdiComponents = Object.freeze({
  ac: '4.00',
  cf: '1.23',
  s: '0.40',
  g: '0.40',
  mi: '1.27',
  tm: '2.50',
  te: '0.00',
  tf: '3.65',
  l: '7.40',
});

/** Nome canônico do BDI padrão do sistema. */
export const DEFAULT_BDI_NAME = 'BDI Padrão — Edificações (TCU 2622/2013)';

export interface CalculateBdiOptions {
  /** Rounder personalizado para arredondar a taxa final. */
  rounder?: Rounder;
  /** Casas decimais para o percentual final (padrão: 4). */
  decimals?: number;
}

function parseComponent(
  key: BdiComponentKey,
  definition: BdiComponentDefinition,
  value: Decimal | string | number | undefined,
  issues: BdiValidationIssue[]
): Decimal {
  try {
    const parsed = toDecimal(value ?? 0, `componente ${definition.label}`);
    if (parsed.isNegative()) {
      issues.push({
        code: 'NEGATIVE_COMPONENT',
        field: key,
        message: `O componente ${definition.label} (${definition.name}) não pode ser negativo (valor informado: ${parsed.toString()}%).`,
      });
    }
    return parsed;
  } catch (error) {
    issues.push({
      code: 'INVALID_NUMBER',
      field: key,
      message:
        error instanceof Error
          ? error.message
          : `O componente ${definition.label} (${definition.name}) não é um número válido.`,
    });
    return new Decimal(0);
  }
}

function buildNormalized(
  inputsPercent: Record<BdiComponentKey, Decimal>
): Record<BdiComponentKey, Decimal> {
  const normalized = {} as Record<BdiComponentKey, Decimal>;
  for (const key of BDI_COMPONENT_KEYS) {
    normalized[key] = inputsPercent[key].dividedBy(100);
  }
  return normalized;
}

function buildMemory(
  inputsPercent: Record<BdiComponentKey, Decimal>,
  normalized: Record<BdiComponentKey, Decimal>,
  partialSums: BdiCalculationMemory['sums'],
  factorA: Decimal,
  factorB: Decimal,
  ratio: Decimal,
  rawPercentage: Decimal,
  roundedPercentage: Decimal,
  decimals: number,
  steps: string[]
): BdiCalculationMemory {
  return {
    formula: { ...BDI_FORMULA },
    inputsPercent: { ...inputsPercent },
    normalized: { ...normalized },
    sums: { ...partialSums },
    factorA,
    factorB,
    ratio,
    rawPercentage,
    roundedPercentage,
    decimals,
    steps: [...steps],
  };
}

/**
 * Calcula a taxa de BDI (Bonificação e Despesas Indiretas) com a fórmula
 * especificada do TCU (Acórdão nº 2622/2013 - Plenário).
 *
 * Regras de negócio:
 * 1. Componentes são percentuais (ex.: 3,00 para 3%) e normalizados por 100.
 * 2. Nenhum componente pode ser negativo nem não numérico.
 * 3. TM + TE + TF deve ser inferior a 100%.
 * 4. O denominador B = 1 - (TM + TE + TF + L) deve ser estritamente > 0.
 * 5. Entradas inválidas jamais lançam exceção: retornam `isValid = false`,
 *    `rate = 0` e a lista estruturada de `issues`.
 *
 * @param components Percentuais de cada componente do BDI.
 * @param options Opções de arredondamento do percentual final.
 * @returns Resultado com taxa, parcelas A/B, validações e memória de cálculo.
 */
export function calculateBdi(
  components: BdiComponents,
  options: CalculateBdiOptions = {}
): BdiResult {
  const issues: BdiValidationIssue[] = [];
  const calculationSteps: string[] = [];
  const one = new Decimal(1);
  const hundred = new Decimal(100);
  const zero = new Decimal(0);

  const requestedDecimals = options.decimals ?? DEFAULT_BDI_DECIMALS;
  let decimals = requestedDecimals;
  if (
    !Number.isInteger(requestedDecimals) ||
    requestedDecimals < 0 ||
    requestedDecimals > MAX_BDI_DECIMALS
  ) {
    issues.push({
      code: 'INVALID_DECIMALS',
      message: `O número de casas decimais do BDI deve ser um inteiro entre 0 e ${MAX_BDI_DECIMALS} (recebido: ${requestedDecimals}).`,
    });
    decimals = DEFAULT_BDI_DECIMALS;
  }

  // 1. Entrada percentual
  const inputsPercent = {} as Record<BdiComponentKey, Decimal>;
  calculationSteps.push('1. Parâmetros de entrada informados (em base percentual %):');
  for (const definition of BDI_COMPONENT_DEFINITIONS) {
    const value = parseComponent(
      definition.key,
      definition,
      components[definition.key],
      issues
    );
    inputsPercent[definition.key] = value;
    calculationSteps.push(
      `   - ${definition.label} (${definition.name}): ${value.toFixed(DEFAULT_BDI_DECIMALS)}%`
    );
  }

  // 2. Normalização percentual -> taxa unitária
  const normalized = buildNormalized(inputsPercent);
  calculationSteps.push('2. Normalização dos coeficientes decimais (% / 100):');
  calculationSteps.push(
    `   - Numerador: ac=${normalized.ac.toString()}, cf=${normalized.cf.toString()}, s=${normalized.s.toString()}, g=${normalized.g.toString()}, mi=${normalized.mi.toString()}`
  );
  calculationSteps.push(
    `   - Denominador: tm=${normalized.tm.toString()}, te=${normalized.te.toString()}, tf=${normalized.tf.toString()}, l=${normalized.l.toString()}`
  );

  // 3. Validação dos tributos
  const taxes = normalized.tm.plus(normalized.te).plus(normalized.tf);
  const taxesPercent = inputsPercent.tm.plus(inputsPercent.te).plus(inputsPercent.tf);
  if (taxes.greaterThanOrEqualTo(one)) {
    issues.push({
      code: 'TAXES_AT_OR_ABOVE_100',
      message: `A soma dos tributos (TM + TE + TF) deve ser inferior a 100%. Total informado: ${taxesPercent.toString()}%.`,
    });
  }

  // 4. Parcela A (numerador)
  const numeratorComponents = normalized.ac
    .plus(normalized.cf)
    .plus(normalized.s)
    .plus(normalized.g)
    .plus(normalized.mi);
  const factorA = one.plus(numeratorComponents);

  calculationSteps.push('3. Cálculo da Parcela A (Numerador - Custos Indiretos):');
  calculationSteps.push(`   Fórmula: ${BDI_FORMULA.numerator}`);
  calculationSteps.push(
    `   A = 1 + ${normalized.ac.toString()} + ${normalized.cf.toString()} + ${normalized.s.toString()} + ${normalized.g.toString()} + ${normalized.mi.toString()}`
  );
  calculationSteps.push(`   A = ${factorA.toString()}`);

  // 5. Parcela B (denominador)
  const denominatorComponents = taxes.plus(normalized.l);
  const factorB = one.minus(denominatorComponents);
  const taxesAndProfitPercent = taxesPercent.plus(inputsPercent.l);

  calculationSteps.push('4. Cálculo da Parcela B (Denominador - Margem Líquida Remanescente):');
  calculationSteps.push(`   Fórmula: ${BDI_FORMULA.denominator}`);
  calculationSteps.push(
    `   B = 1 - (${normalized.tm.toString()} + ${normalized.te.toString()} + ${normalized.tf.toString()} + ${normalized.l.toString()})`
  );
  calculationSteps.push(
    `   B = 1 - ${denominatorComponents.toString()} = ${factorB.toString()}`
  );

  if (factorB.lessThanOrEqualTo(zero)) {
    issues.push({
      code: 'DENOMINATOR_NOT_POSITIVE',
      message: `O denominador B da fórmula do BDI deve ser estritamente maior que zero (1 - tributos - lucro = ${factorB.toString()}). A soma de tributos e lucro atingiu ${taxesAndProfitPercent.toString()}%, o que inviabiliza o cálculo.`,
    });
  }

  const partialSums: BdiCalculationMemory['sums'] = {
    numeratorComponents,
    denominatorComponents,
    taxes,
    taxesAndProfit: taxesAndProfitPercent.dividedBy(100),
  };

  // 6. Cálculo da taxa, somente quando B > 0 e não há erros
  let ratio = zero;
  let rawPercentage = zero;
  let roundedPercentage = zero;

  if (factorB.greaterThan(zero)) {
    ratio = factorA.dividedBy(factorB);
    rawPercentage = ratio.minus(one).times(hundred);

    if (issues.length === 0) {
      roundedPercentage = options.rounder
        ? options.rounder.roundToDecimals(rawPercentage, decimals)
        : rawPercentage.toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP);

      calculationSteps.push('5. Aplicação da fórmula do BDI (Acórdão TCU nº 2622/2013):');
      calculationSteps.push(`   Fórmula: ${BDI_FORMULA.expression}`);
      calculationSteps.push(
        `   BDI (%) = [ (${factorA.toString()} / ${factorB.toString()}) - 1 ] × 100`
      );
      calculationSteps.push(
        `   BDI (%) = [ ${ratio.toString()} - 1 ] × 100 = ${rawPercentage.toString()}%`
      );
      calculationSteps.push(
        `6. Taxa final calculada e arredondada para ${decimals} casas decimais: ${roundedPercentage.toFixed(decimals)}%`
      );
    } else {
      calculationSteps.push(
        '5. Taxa bruta calculada, porém inválida devido a inconsistências nos parâmetros de entrada.'
      );
    }
  } else {
    calculationSteps.push(
      '5. Status: Cálculo interrompido porque o denominador B não é positivo.'
    );
  }

  if (issues.length > 0 && factorB.greaterThan(zero)) {
    calculationSteps.push(
      '6. Status: Cálculo interrompido devido a inconsistências nos parâmetros de entrada.'
    );
  }

  const isValid = issues.length === 0;
  const rate = isValid ? roundedPercentage : zero;

  return {
    rate,
    factorA,
    factorB,
    percentage: rate,
    isValid,
    validationErrors: issues.map((issue) => issue.message),
    issues,
    calculationSteps,
    memory: buildMemory(
      inputsPercent,
      normalized,
      partialSums,
      factorA,
      factorB,
      ratio,
      rawPercentage,
      roundedPercentage,
      decimals,
      calculationSteps
    ),
  };
}

/**
 * Converte componentes armazenados como fração unitária (ex.: 0,04 para 4%,
 * formato do banco de dados) para a base percentual aceita por `calculateBdi`.
 */
export function bdiComponentsFromFractions(
  fractions: Partial<Record<BdiComponentKey, Decimal | string | number>>
): BdiComponents {
  const result = {} as BdiComponents;
  for (const definition of BDI_COMPONENT_DEFINITIONS) {
    const raw = fractions[definition.key] ?? 0;
    result[definition.key] = toDecimal(raw, `componente ${definition.label}`).times(100);
  }
  return result;
}

/** Calcula o BDI a partir de componentes persistidos em fração unitária. */
export function calculateBdiFromFractions(
  fractions: Partial<Record<BdiComponentKey, Decimal | string | number>>,
  options: CalculateBdiOptions = {}
): BdiResult {
  return calculateBdi(bdiComponentsFromFractions(fractions), options);
}

// ----------------------------------------------------------------------------
// BDI PADRÃO E RESOLUÇÃO POR SERVIÇO
// ----------------------------------------------------------------------------

const defaultBdiResult = calculateBdi(DEFAULT_BDI_COMPONENTS);

/** Taxa do BDI padrão do sistema, já calculada e arredondada (%). */
export const DEFAULT_BDI_RATE: Decimal = defaultBdiResult.rate;

/** Resultado completo do BDI padrão do sistema. */
export const DEFAULT_BDI_RESULT: BdiResult = defaultBdiResult;

/** Referência canônica do BDI padrão do sistema. */
export const DEFAULT_BDI_REFERENCE: BdiConfigReference = Object.freeze({
  name: DEFAULT_BDI_NAME,
  rate: DEFAULT_BDI_RATE,
});

/**
 * Resolve a taxa de BDI efetiva de um serviço, com precedência explícita:
 *
 *   1. exceção do serviço (`itemOverride`);
 *   2. BDI padrão da revisão/orçamento (`revisionDefault`);
 *   3. BDI padrão do sistema (`systemDefault`, por omissão o `DEFAULT_BDI_REFERENCE`).
 *
 * Um `systemDefault: null` desabilita o fallback e resulta em `origin = 'NONE'`
 * com taxa zero. Taxas negativas ou não numéricas lançam erro de percentual.
 */
export function resolveBdi(input: BdiResolutionInput = {}): BdiResolution {
  const systemDefault =
    input.systemDefault === undefined ? DEFAULT_BDI_REFERENCE : input.systemDefault;

  const candidates: Array<{
    origin: Exclude<BdiOrigin, 'NONE'>;
    reference: BdiConfigReference | null | undefined;
    isException: boolean;
  }> = [
    { origin: 'ITEM_OVERRIDE', reference: input.itemOverride, isException: true },
    { origin: 'REVISION_DEFAULT', reference: input.revisionDefault, isException: false },
    { origin: 'SYSTEM_DEFAULT', reference: systemDefault, isException: false },
  ];

  for (const candidate of candidates) {
    if (!candidate.reference) continue;
    return {
      rate: toPercentage(candidate.reference.rate, 'taxa de BDI'),
      origin: candidate.origin,
      configId: candidate.reference.id,
      name: candidate.reference.name,
      isException: candidate.isException,
    };
  }

  return { rate: new Decimal(0), origin: 'NONE', isException: false };
}

// ----------------------------------------------------------------------------
// APLICAÇÃO SOBRE SUBTOTAL E TOTAL
// ----------------------------------------------------------------------------

/** Resultado da aplicação do BDI sobre um subtotal direto. */
export interface BdiApplication {
  /** Subtotal direto, arredondado pela política. */
  subtotal: Decimal;
  /** Taxa percentual aplicada. */
  rate: Decimal;
  /** Valor monetário do BDI, arredondado pela política. */
  bdiAmount: Decimal;
  /** Total com BDI: `subtotal + bdiAmount` (soma exata). */
  total: Decimal;
}

/**
 * Aplica uma taxa percentual de BDI sobre o subtotal direto.
 *
 * O valor do BDI é arredondado uma única vez (`bdiAmount`) e o total é obtido
 * por soma exata: `total = subtotal + bdiAmount`. Isso elimina resíduos entre
 * o subtotal, o BDI e o total, preservando a reconciliação contábil.
 */
export function applyBdi(
  subtotalInput: Decimal | string | number,
  rateInput: Decimal | string | number,
  rounder: Rounder = defaultRounder
): BdiApplication {
  const subtotal = rounder.roundTotal(toDecimal(subtotalInput, 'subtotal'));
  const rate = toPercentage(rateInput, 'taxa de BDI');
  const bdiAmount = rounder.roundTotal(subtotal.times(rate).dividedBy(100));
  const total = rounder.roundTotal(subtotal.plus(bdiAmount));

  return { subtotal, rate, bdiAmount, total };
}
