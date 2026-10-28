import Decimal from 'decimal.js';
import { DecimalInput, toDecimal } from './decimal';
import { UnitConversionError } from './errors';
import { UnitConversionResolver, UnitConversionRule } from './types';

/** Dimensões físicas reconhecidas pelo conversor. */
export type UnitDimension =
  | 'LENGTH'
  | 'AREA'
  | 'VOLUME'
  | 'MASS'
  | 'TIME'
  | 'COUNT'
  | 'OTHER';

/** Definição de uma unidade adicional (sem fator: use uma regra para isso). */
export interface UnitDefinition {
  symbol: string;
  dimension: UnitDimension;
}

/** Resultado detalhado de uma conversão. */
export interface UnitConversionResult {
  /** Fator multiplicativo de `fromUnit` para `toUnit`. */
  factor: Decimal;
  /** `true` quando o fator é decimal exato (sem dízima periódica). */
  isExact: boolean;
  /** Caminho de unidades percorrido (para auditoria). */
  path: string[];
}

/** Entrada aceita para regras de conversão. */
export type UnitConversionRulesInput =
  | UnitConversionRule[]
  | Map<string, DecimalInput>
  | Record<string, DecimalInput>
  | UnitConversionResolver
  | undefined;

export interface UnitConverterOptions {
  /** Inclui as conversões SI/usual de construção civil (padrão: true). */
  includeBuiltIns?: boolean;
  /** Unidades adicionais e suas dimensões (para validação de compatibilidade). */
  definitions?: UnitDefinition[];
}

/** Contrato público do conversor determinístico de unidades. */
export interface UnitConverter {
  /** Normaliza um símbolo para a chave canônica interna. */
  normalize(unit: string): string;
  /** Dimensão da unidade, quando conhecida. */
  dimensionOf(unit: string): UnitDimension | undefined;
  /** `true` se existe um caminho de conversão entre as unidades. */
  canConvert(fromUnit: string, toUnit: string): boolean;
  /** Resolve fator, exatidão e caminho; lança `UnitConversionError` se impossível. */
  resolve(fromUnit: string, toUnit: string): UnitConversionResult;
  /** Fator multiplicativo `fromUnit -> toUnit`. */
  factor(fromUnit: string, toUnit: string): Decimal;
  /** Converte um valor, sem arredondar (o arredondamento é responsabilidade do Rounder). */
  convert(value: DecimalInput, fromUnit: string, toUnit: string): Decimal;
}

interface BuiltInUnit {
  key: string;
  dimension: UnitDimension;
  /** Fator para a unidade-base da dimensão. */
  factorToBase: string;
  aliases?: string[];
}

const BASE_UNIT_BY_DIMENSION: Record<UnitDimension, string> = {
  LENGTH: 'm',
  AREA: 'm2',
  VOLUME: 'm3',
  MASS: 'kg',
  TIME: 's',
  COUNT: 'un',
  OTHER: 'outro',
};

const BUILT_IN_UNITS: readonly BuiltInUnit[] = Object.freeze([
  // Comprimento (base: m)
  { key: 'm', dimension: 'LENGTH', factorToBase: '1', aliases: ['metro', 'metros'] },
  { key: 'cm', dimension: 'LENGTH', factorToBase: '0.01', aliases: ['centimetro', 'centimetros'] },
  { key: 'mm', dimension: 'LENGTH', factorToBase: '0.001', aliases: ['milimetro', 'milimetros'] },
  { key: 'km', dimension: 'LENGTH', factorToBase: '1000', aliases: ['quilometro', 'quilometros'] },
  {
    key: 'in',
    dimension: 'LENGTH',
    factorToBase: '0.0254',
    aliases: ['pol', 'polegada', 'polegadas'],
  },
  { key: 'ft', dimension: 'LENGTH', factorToBase: '0.3048', aliases: ['pe', 'pes'] },

  // Área (base: m²)
  { key: 'm2', dimension: 'AREA', factorToBase: '1', aliases: ['metro2', 'metros2'] },
  { key: 'cm2', dimension: 'AREA', factorToBase: '0.0001', aliases: ['centimetro2'] },
  { key: 'mm2', dimension: 'AREA', factorToBase: '0.000001', aliases: ['milimetro2'] },
  { key: 'km2', dimension: 'AREA', factorToBase: '1000000', aliases: ['quilometro2'] },
  { key: 'ha', dimension: 'AREA', factorToBase: '10000', aliases: ['hectare', 'hectares'] },

  // Volume (base: m³)
  { key: 'm3', dimension: 'VOLUME', factorToBase: '1', aliases: ['metro3', 'metros3'] },
  {
    key: 'l',
    dimension: 'VOLUME',
    factorToBase: '0.001',
    aliases: ['lt', 'litro', 'litros'],
  },
  { key: 'ml', dimension: 'VOLUME', factorToBase: '0.000001', aliases: ['mililitro', 'mililitros'] },
  { key: 'cm3', dimension: 'VOLUME', factorToBase: '0.000001', aliases: ['centimetro3'] },
  { key: 'dm3', dimension: 'VOLUME', factorToBase: '0.001', aliases: ['decimetro3'] },

  // Massa (base: kg)
  { key: 'kg', dimension: 'MASS', factorToBase: '1', aliases: ['quilograma', 'quilogramas'] },
  { key: 'g', dimension: 'MASS', factorToBase: '0.001', aliases: ['grama', 'gramas'] },
  { key: 'mg', dimension: 'MASS', factorToBase: '0.000001', aliases: ['miligrama'] },
  {
    key: 't',
    dimension: 'MASS',
    factorToBase: '1000',
    aliases: ['ton', 'tonelada', 'toneladas'],
  },
  { key: 'lb', dimension: 'MASS', factorToBase: '0.45359237', aliases: ['libra', 'libras'] },

  // Tempo (base: s)
  { key: 's', dimension: 'TIME', factorToBase: '1', aliases: ['seg', 'segundo', 'segundos'] },
  { key: 'min', dimension: 'TIME', factorToBase: '60', aliases: ['minuto', 'minutos'] },
  { key: 'h', dimension: 'TIME', factorToBase: '3600', aliases: ['hr', 'hora', 'horas'] },
  { key: 'd', dimension: 'TIME', factorToBase: '86400', aliases: ['dia', 'dias'] },

  // Contagem (base: un)
  {
    key: 'un',
    dimension: 'COUNT',
    factorToBase: '1',
    aliases: ['und', 'unid', 'unidade', 'unidades', 'pc', 'pca', 'peca', 'pecas'],
  },
  {
    key: 'mil',
    dimension: 'COUNT',
    factorToBase: '1000',
    aliases: ['milheiro', 'milheiros'],
  },

  // Unidades usuais sem dimensão física (verbas, meses, kgf etc.)
  { key: 'vb', dimension: 'OTHER', factorToBase: '1', aliases: ['verba', 'verbas'] },
  { key: 'mes', dimension: 'OTHER', factorToBase: '1', aliases: ['meses'] },
  { key: 'kgf', dimension: 'OTHER', factorToBase: '1' },
]);

/**
 * Normaliza um símbolo de unidade:
 * - minúsculas, sem acentos e sem espaços;
 * - `m²`/`m^2`/`m2` convergem para a mesma chave;
 * - aliases textuais (`litro`, `tonelada`, `peça`) são resolvidos pelo dicionário.
 */
export function normalizeUnitSymbol(unit: string): string {
  if (typeof unit !== 'string' || unit.trim().length === 0) {
    throw new UnitConversionError('O símbolo de unidade não pode ser vazio.');
  }

  return unit
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '')
    .replace(/²/g, '2')
    .replace(/³/g, '3')
    .replace(/\^/g, '');
}

interface Edge {
  to: string;
  factor: Decimal;
  isExact: boolean;
}

/** Verifica se 1/n tem expansão decimal finita (denominador só com fatores 2 e 5). */
function hasTerminatingInverse(value: Decimal): boolean {
  if (value.isZero()) return false;
  try {
    const [, denominator] = value.toFraction();
    return onlyFactorsTwoAndFive(new Decimal(denominator).abs());
  } catch {
    return false;
  }
}

function onlyFactorsTwoAndFive(value: Decimal): boolean {
  let rest = value.abs();
  if (rest.isZero()) return false;
  while (rest.modulo(2).isZero()) rest = rest.dividedBy(2);
  while (rest.modulo(5).isZero()) rest = rest.dividedBy(5);
  return rest.equals(1);
}

function gcdDecimal(a: Decimal, b: Decimal): Decimal {
  let left = a.abs();
  let right = b.abs();
  while (!right.isZero()) {
    const remainder = left.modulo(right);
    left = right;
    right = remainder;
  }
  return left;
}

/**
 * Verifica se `numerator / denominator` tem expansão decimal finita.
 * Ex.: 3600/60 = 60 (exato); 1/0.45359237 (não exato).
 */
function hasTerminatingQuotient(numerator: Decimal, denominator: Decimal): boolean {
  if (denominator.isZero()) return false;
  try {
    const [numA, denA] = numerator.toFraction();
    const [numB, denB] = denominator.toFraction();
    const num = numA.times(denB);
    const den = denA.times(numB);
    if (den.isZero()) return false;
    const gcd = gcdDecimal(num, den);
    const reducedDenominator = den.dividedBy(gcd).abs();
    return onlyFactorsTwoAndFive(reducedDenominator);
  } catch {
    return false;
  }
}

function parseRuleKey(key: string): { from: string; to: string } {
  for (const separator of ['->', '=>', '>', ':']) {
    const index = key.indexOf(separator);
    if (index > 0) {
      return {
        from: key.slice(0, index),
        to: key.slice(index + separator.length),
      };
    }
  }
  throw new UnitConversionError(
    `Chave de conversão inválida: "${key}". Use o formato "origem->destino".`
  );
}

/**
 * Cria um conversor de unidades determinístico.
 *
 * Fontes de regras aceitas:
 * - array de `UnitConversionRule` (fator de `fromUnit` para `toUnit`);
 * - `Map`/objeto com chaves `"origem->destino"`;
 * - função resolvedora `(from, to) => fator | undefined`.
 *
 * As conversões usuais (m, cm, m², m³, L, kg, t, h, min, un, mil etc.) já vêm
 * habilitadas. Regras conflitantes são rejeitadas em vez de escolhidas por
 * ordem de inserção — o que preserva a reprodutibilidade.
 */
export function createUnitConverter(
  rules?: UnitConversionRulesInput,
  options: UnitConverterOptions = {}
): UnitConverter {
  const includeBuiltIns = options.includeBuiltIns !== false;
  const dimensions = new Map<string, UnitDimension>();
  const aliases = new Map<string, string>();
  const edges = new Map<string, Map<string, Edge>>();
  const factorToBase = new Map<string, Decimal>();
  let customResolver:
    | ((fromUnit: string, toUnit: string) => Decimal | string | number | undefined)
    | undefined;

  function registerAlias(alias: string, canonical: string): void {
    const normalized = normalizeUnitSymbol(alias);
    const existing = aliases.get(normalized);
    if (existing && existing !== canonical) {
      throw new UnitConversionError(
        `Alias de unidade ambíguo: "${alias}" aponta para "${existing}" e "${canonical}".`
      );
    }
    aliases.set(normalized, canonical);
  }

  function canonicalKey(unit: string): string {
    const normalized = normalizeUnitSymbol(unit);
    return aliases.get(normalized) ?? normalized;
  }

  function registerDimension(key: string, dimension: UnitDimension): void {
    const existing = dimensions.get(key);
    if (existing && existing !== dimension) {
      throw new UnitConversionError(
        `Dimensão conflitante para a unidade "${key}": "${existing}" e "${dimension}".`
      );
    }
    dimensions.set(key, dimension);
  }

  function addEdge(
    from: string,
    to: string,
    factor: Decimal,
    isExact: boolean,
    context: string
  ): void {
    if (!factor.isFinite() || factor.lessThanOrEqualTo(0)) {
      throw new UnitConversionError(
        `Fator de conversão inválido em ${context}: ${factor.toString()} (deve ser finito e maior que zero).`
      );
    }

    if (!edges.has(from)) edges.set(from, new Map());
    const outgoing = edges.get(from)!;
    const existing = outgoing.get(to);
    if (existing) {
      if (!existing.factor.equals(factor)) {
        throw new UnitConversionError(
          `Regras de conversão conflitantes para ${from} -> ${to}: ${existing.factor.toString()} e ${factor.toString()}.`
        );
      }
      if (!existing.isExact && isExact) {
        outgoing.set(to, { to, factor, isExact });
      }
      return;
    }
    outgoing.set(to, { to, factor, isExact });
  }

  function addBidirectionalRule(
    from: string,
    to: string,
    factor: Decimal,
    isExact: boolean,
    context: string
  ): void {
    addEdge(from, to, factor, isExact, context);
    const inverseExact = isExact && hasTerminatingInverse(factor);
    addEdge(to, from, new Decimal(1).dividedBy(factor), inverseExact, context);
  }

  // 1. Unidades e conversões embutidas
  if (includeBuiltIns) {
    for (const unit of BUILT_IN_UNITS) {
      registerDimension(unit.key, unit.dimension);
      registerAlias(unit.key, unit.key);
      for (const alias of unit.aliases ?? []) registerAlias(alias, unit.key);
    }

    for (const unit of BUILT_IN_UNITS) {
      const base = BASE_UNIT_BY_DIMENSION[unit.dimension];
      registerDimension(base, unit.dimension);
      if (unit.dimension !== 'OTHER') {
        factorToBase.set(base, new Decimal(1));
        factorToBase.set(unit.key, toDecimal(unit.factorToBase, `fator de ${unit.key}`));
      }
      // Dimensão OTHER agrupa unidades heterogêneas (verba, mês, kgf); não há
      // base física comum, portanto elas permanecem isoladas umas das outras.
      if (unit.dimension === 'OTHER') continue;
      if (unit.key === base) continue;
      const factor = factorToBase.get(unit.key)!;
      addBidirectionalRule(unit.key, base, factor, true, `unidade embutida ${unit.key}`);
    }
  }

  // 2. Definições adicionais de dimensão
  for (const definition of options.definitions ?? []) {
    const key = canonicalKey(definition.symbol);
    registerAlias(definition.symbol, key);
    registerDimension(key, definition.dimension);
  }

  // 3. Regras informadas
  function registerRule(fromUnit: string, toUnit: string, factorInput: DecimalInput): void {
    const from = canonicalKey(fromUnit);
    const to = canonicalKey(toUnit);
    if (from === to) {
      throw new UnitConversionError(
        `Regra de conversão redundante: "${fromUnit}" e "${toUnit}" são a mesma unidade.`
      );
    }

    const fromDimension = dimensions.get(from);
    const toDimension = dimensions.get(to);
    if (fromDimension && toDimension && fromDimension !== toDimension) {
      throw new UnitConversionError(
        `Unidades incompatíveis: "${fromUnit}" (${fromDimension}) e "${toUnit}" (${toDimension}).`
      );
    }

    const factor = toDecimal(factorInput, `fator ${fromUnit}->${toUnit}`);
    if (!factor.isFinite() || factor.lessThanOrEqualTo(0)) {
      throw new UnitConversionError(
        `Fator de conversão inválido para ${fromUnit} -> ${toUnit}: ${factor.toString()}.`
      );
    }

    if (fromDimension && !toDimension) registerDimension(to, fromDimension);
    if (!fromDimension && toDimension) registerDimension(from, toDimension);

    const effectiveFromDimension = dimensions.get(from);
    const effectiveToDimension = dimensions.get(to);
    const fromBase = factorToBase.get(from);
    const toBase = factorToBase.get(to);

    // Consistência contra a razão de unidades-base (quando ambas são conhecidas).
    if (
      effectiveFromDimension &&
      effectiveToDimension &&
      effectiveFromDimension === effectiveToDimension &&
      effectiveFromDimension !== 'OTHER' &&
      fromBase &&
      toBase
    ) {
      const expected = fromBase.dividedBy(toBase);
      if (!expected.equals(factor)) {
        throw new UnitConversionError(
          `Regra de conversão inconsistente para ${fromUnit} -> ${toUnit}: ${factor.toString()} contradiz o fator derivado ${expected.toString()} (${from} -> base -> ${to}).`
        );
      }
    }

    // Se já existe um caminho (inclusive indireto), o novo fator precisa ser
    // consistente com ele. Isso impede que uma regra direta "cm->mm = 99"
    // contradiga silenciosamente "cm->m->mm = 10".
    const previous = findPath(from, to);
    if (previous && !previous.factor.equals(factor)) {
      throw new UnitConversionError(
        `Regra de conversão inconsistente para ${fromUnit} -> ${toUnit}: ${factor.toString()} contradiz o fator já derivado ${previous.factor.toString()} (${previous.path.join(' -> ')}).`
      );
    }

    addBidirectionalRule(from, to, factor, true, `regra ${fromUnit} -> ${toUnit}`);

    // Completa a âncora na unidade-base para permitir razões exatas futuras.
    if (
      effectiveFromDimension &&
      effectiveToDimension &&
      effectiveFromDimension === effectiveToDimension &&
      effectiveFromDimension !== 'OTHER'
    ) {
      if (fromBase && !toBase) {
        factorToBase.set(to, fromBase.dividedBy(factor));
      } else if (!fromBase && toBase) {
        factorToBase.set(from, toBase.times(factor));
      }
    }
  }

  if (Array.isArray(rules)) {
    for (const rule of rules) {
      registerRule(
        rule.fromUnit,
        rule.toUnit,
        rule.factor instanceof Decimal ? rule.factor : toDecimal(rule.factor as DecimalInput)
      );
    }
  } else if (rules instanceof Map) {
    for (const [key, factor] of rules.entries()) {
      const { from, to } = parseRuleKey(key);
      registerRule(from, to, factor);
    }
  } else if (typeof rules === 'function') {
    customResolver = rules;
  } else if (rules && typeof rules === 'object') {
    for (const [key, factor] of Object.entries(rules)) {
      const { from, to } = parseRuleKey(key);
      registerRule(from, to, factor);
    }
  }

  function dimensionOf(unit: string): UnitDimension | undefined {
    return dimensions.get(canonicalKey(unit));
  }

  function findPath(from: string, to: string): UnitConversionResult | undefined {
    interface SearchNode {
      unit: string;
      factor: Decimal;
      isExact: boolean;
      path: string[];
    }

    const queue: SearchNode[] = [
      { unit: from, factor: new Decimal(1), isExact: true, path: [from] },
    ];
    const visited = new Set<string>([from]);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const outgoing = edges.get(current.unit);
      if (!outgoing) continue;

      // Ordenação lexical garante caminho determinístico quando há mais de uma rota.
      const neighbours = Array.from(outgoing.keys()).sort();
      for (const neighbour of neighbours) {
        if (visited.has(neighbour)) continue;
        const edge = outgoing.get(neighbour)!;
        const factor = current.factor.times(edge.factor);
        const isExact = current.isExact && edge.isExact;
        const path = [...current.path, neighbour];

        if (neighbour === to) {
          return { factor, isExact, path };
        }

        visited.add(neighbour);
        queue.push({ unit: neighbour, factor, isExact, path });
      }
    }

    return undefined;
  }

  function resolvePath(fromUnit: string, toUnit: string): UnitConversionResult {
    const from = canonicalKey(fromUnit);
    const to = canonicalKey(toUnit);

    if (from === to) {
      return { factor: new Decimal(1), isExact: true, path: [from] };
    }

    const fromDimension = dimensions.get(from);
    const toDimension = dimensions.get(to);
    if (fromDimension && toDimension && fromDimension !== toDimension) {
      throw new UnitConversionError(
        `Unidades incompatíveis: "${fromUnit}" (${fromDimension}) e "${toUnit}" (${toDimension}).`
      );
    }

    if (customResolver) {
      const resolved = customResolver(fromUnit, toUnit);
      if (resolved !== undefined && resolved !== null) {
        const factor = toDecimal(resolved as DecimalInput, `fator ${fromUnit}->${toUnit}`);
        if (!factor.isFinite() || factor.lessThanOrEqualTo(0)) {
          throw new UnitConversionError(
            `Fator de conversão inválido para ${fromUnit} -> ${toUnit}: ${factor.toString()}.`
          );
        }
        return { factor, isExact: true, path: [from, to] };
      }
    }

    // Quando ambas as unidades estão ancoradas na mesma base, a razão direta
    // evita amplificar dízimas de arestas inversas (ex.: h -> min = 3600/60).
    if (
      fromDimension &&
      toDimension &&
      fromDimension === toDimension &&
      fromDimension !== 'OTHER'
    ) {
      const fromBase = factorToBase.get(from);
      const toBase = factorToBase.get(to);
      if (fromBase && toBase) {
        return {
          factor: fromBase.dividedBy(toBase),
          isExact: hasTerminatingQuotient(fromBase, toBase),
          path: [from, BASE_UNIT_BY_DIMENSION[fromDimension], to],
        };
      }
    }

    const found = findPath(from, to);
    if (found) return found;

    throw new UnitConversionError(
      `Não há regra de conversão entre "${fromUnit}" e "${toUnit}". Informe o fator explicitamente ou cadastre a conversão.`
    );
  }

  return {
    normalize: canonicalKey,
    dimensionOf,
    canConvert(fromUnit: string, toUnit: string): boolean {
      try {
        resolvePath(fromUnit, toUnit);
        return true;
      } catch {
        return false;
      }
    },
    resolve: resolvePath,
    factor(fromUnit: string, toUnit: string): Decimal {
      return resolvePath(fromUnit, toUnit).factor;
    },
    convert(value: DecimalInput, fromUnit: string, toUnit: string): Decimal {
      return toDecimal(value, 'valor a converter').times(resolvePath(fromUnit, toUnit).factor);
    },
  };
}

/** Conversor padrão com as unidades usuais da construção civil. */
export const defaultUnitConverter: UnitConverter = createUnitConverter();
