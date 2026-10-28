import Decimal from 'decimal.js';
import { InvalidDecimalError, InvalidPercentageError } from './errors';

/**
 * Precisão mínima de trabalho do motor (dígitos significativos).
 *
 * O padrão do Decimal.js é 20 dígitos, insuficiente para coeficientes SINAPI
 * (18,6) encadeados em vários níveis e para divisões de conversão de unidade.
 * O motor eleva a precisão global para 40 dígitos, sem reduzi-la caso o processo
 * já esteja configurado com precisão maior.
 */
export const ENGINE_PRECISION = 40;

if (Decimal.precision < ENGINE_PRECISION) {
  Decimal.set({ precision: ENGINE_PRECISION });
}

/** Entrada aceita por todas as funções aritméticas do motor. */
export type DecimalInput = Decimal | string | number;

/**
 * Converte uma entrada em `Decimal`, aceitando strings decimais canônicas e,
 * por conveniência, o separador decimal brasileiro (vírgula) quando não houver
 * ponto no mesmo valor.
 *
 * Rejeita explicitamente `NaN`, `Infinity`, strings vazias e valores ambíguos.
 */
export function toDecimal(value: DecimalInput, field = 'valor'): Decimal {
  if (Decimal.isDecimal(value)) {
    return value as Decimal;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new InvalidDecimalError(`O ${field} deve ser um número finito (recebido: ${value}).`);
    }
    return new Decimal(value);
  }

  if (typeof value === 'string') {
    const raw = value.trim();
    if (raw.length === 0) {
      throw new InvalidDecimalError(`O ${field} não pode ser vazio.`);
    }

    let normalized = raw;
    if (raw.includes(',')) {
      if (raw.includes('.')) {
        throw new InvalidDecimalError(
          `O ${field} possui separadores decimais ambíguos (vírgula e ponto): "${value}".`
        );
      }
      normalized = raw.replace(',', '.');
    }

    let parsed: Decimal;
    try {
      parsed = new Decimal(normalized);
    } catch {
      throw new InvalidDecimalError(`O ${field} não é um número decimal válido: "${value}".`);
    }

    if (!parsed.isFinite()) {
      throw new InvalidDecimalError(`O ${field} deve ser finito (recebido: "${value}").`);
    }
    return parsed;
  }

  throw new InvalidDecimalError(
    `O ${field} deve ser Decimal, string ou number (recebido: ${typeof value}).`
  );
}

/** Soma uma coleção de valores decimais, começando em zero. */
export function sumDecimals(values: Iterable<DecimalInput>): Decimal {
  let total = new Decimal(0);
  for (const value of values) {
    total = total.plus(toDecimal(value));
  }
  return total;
}

/** Retorna `percent` por cento de `value` (ex.: 15% de 200 = 30). */
export function percentOf(value: DecimalInput, percent: DecimalInput): Decimal {
  return toDecimal(value).times(toDecimal(percent, 'percentual')).dividedBy(100);
}

/**
 * Aplica uma taxa percentual sobre um valor:
 * `value × (1 + percent / 100)`.
 */
export function applyPercentage(value: DecimalInput, percent: DecimalInput): Decimal {
  const rate = toDecimal(percent, 'percentual');
  if (rate.isNegative()) {
    throw new InvalidPercentageError(
      `O percentual não pode ser negativo (recebido: ${rate.toString()}%).`
    );
  }
  return toDecimal(value).times(new Decimal(1).plus(rate.dividedBy(100)));
}

/** Valida que um percentual é finito e não negativo, retornando-o em Decimal. */
export function toPercentage(value: DecimalInput, field = 'percentual'): Decimal {
  const percentage = toDecimal(value, field);
  if (percentage.isNegative()) {
    throw new InvalidPercentageError(
      `O ${field} não pode ser negativo (recebido: ${percentage.toString()}%).`
    );
  }
  return percentage;
}

/** `true` quando o valor é exatamente zero. */
export function isZero(value: DecimalInput): boolean {
  return toDecimal(value).isZero();
}

/**
 * Divisão decimal com erro explícito para divisor zero.
 * O Decimal.js retornaria `Infinity`, o que contaminaria totais silenciosamente.
 */
export function divideDecimal(dividend: DecimalInput, divisor: DecimalInput): Decimal {
  const d = toDecimal(divisor, 'divisor');
  if (d.isZero()) {
    throw new InvalidDecimalError('Divisão por zero não é permitida no motor de cálculo.');
  }
  return toDecimal(dividend, 'dividendo').dividedBy(d);
}

/** Converte um Decimal em string canônica (sem notação científica para valores usuais). */
export function decimalToString(value: DecimalInput): string {
  return toDecimal(value).toString();
}
