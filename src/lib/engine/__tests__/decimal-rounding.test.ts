import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import {
  applyPercentage,
  createRounder,
  DEFAULT_ROUNDING_POLICY,
  divideDecimal,
  ENGINE_PRECISION,
  InvalidDecimalError,
  InvalidRoundingPolicyError,
  mapRoundingMode,
  normalizeRoundingPolicy,
  percentOf,
  toDecimal,
  validateRoundingPolicy,
} from '../index';

describe('Etapa 4 - Aritmética decimal e políticas de precisão', () => {
  describe('Aritmética decimal exata', () => {
    it('não sofre com o erro binário de ponto flutuante', () => {
      expect(new Decimal('0.1').plus('0.2').toString()).toBe('0.3');
      expect(toDecimal('0.1').plus(toDecimal('0.2')).toString()).toBe('0.3');
      expect(toDecimal('1.005').times(100).toString()).toBe('100.5');
    });

    it('trabalha com precisão significativa suficiente para coeficientes SINAPI encadeados', () => {
      expect(ENGINE_PRECISION).toBeGreaterThanOrEqual(40);
      expect(Decimal.precision).toBeGreaterThanOrEqual(ENGINE_PRECISION);

      // Cadeia de multiplicações/divisões que excederia a precisão padrão (20)
      let value = toDecimal('123456789.123456789');
      for (let i = 0; i < 8; i++) {
        value = value.dividedBy('3.333333333333333');
        value = value.times('1.000001');
      }
      const first = value.toString();
      for (let i = 0; i < 20; i++) {
        let repeated = toDecimal('123456789.123456789');
        for (let j = 0; j < 8; j++) {
          repeated = repeated.dividedBy('3.333333333333333');
          repeated = repeated.times('1.000001');
        }
        expect(repeated.toString()).toBe(first);
      }
    });

    it('aceita separador decimal brasileiro quando não é ambíguo', () => {
      expect(toDecimal('10,5').toString()).toBe('10.5');
      expect(toDecimal('-0,001').toString()).toBe('-0.001');
    });

    it('rejeita valores inválidos, ambíguos, NaN e infinitos', () => {
      expect(() => toDecimal('')).toThrow(InvalidDecimalError);
      expect(() => toDecimal('   ')).toThrow(InvalidDecimalError);
      expect(() => toDecimal('abc')).toThrow(InvalidDecimalError);
      expect(() => toDecimal('1.234,56')).toThrow(InvalidDecimalError);
      expect(() => toDecimal(Number.NaN)).toThrow(InvalidDecimalError);
      expect(() => toDecimal(Number.POSITIVE_INFINITY)).toThrow(InvalidDecimalError);
      expect(() => toDecimal(undefined as unknown as string)).toThrow(InvalidDecimalError);
    });

    it('calcula percentuais e divisões com erro explícito para divisor zero', () => {
      expect(percentOf('200', '15').toString()).toBe('30');
      expect(applyPercentage('200', '15').toString()).toBe('230');
      expect(applyPercentage('100', '0').toString()).toBe('100');
      expect(() => divideDecimal('10', '0')).toThrow(/Divisão por zero/);
    });
  });

  describe('Política de arredondamento', () => {
    it('valida casas decimais e modo', () => {
      expect(() =>
        validateRoundingPolicy({ ...DEFAULT_ROUNDING_POLICY, totalDecimals: -1 })
      ).toThrow(InvalidRoundingPolicyError);
      expect(() =>
        validateRoundingPolicy({ ...DEFAULT_ROUNDING_POLICY, priceDecimals: 2.5 })
      ).toThrow(InvalidRoundingPolicyError);
      expect(() =>
        validateRoundingPolicy({ ...DEFAULT_ROUNDING_POLICY, coefficientDecimals: 13 })
      ).toThrow(InvalidRoundingPolicyError);
      expect(() =>
        validateRoundingPolicy({
          ...DEFAULT_ROUNDING_POLICY,
          roundingMode: 'ROUND_ALEATORIO' as never,
        })
      ).toThrow(InvalidRoundingPolicyError);
      expect(() => mapRoundingMode('ROUND_ALEATORIO')).toThrow(InvalidRoundingPolicyError);
    });

    it('normaliza políticas parciais mantendo os padrões', () => {
      const policy = normalizeRoundingPolicy({ totalDecimals: 4 });
      expect(policy.totalDecimals).toBe(4);
      expect(policy.priceDecimals).toBe(DEFAULT_ROUNDING_POLICY.priceDecimals);
      expect(policy.roundingMode).toBe('ROUND_HALF_UP');
    });

    it('aplica HALF_UP comercial em empates positivos e negativos', () => {
      const rounder = createRounder({ totalDecimals: 2 });
      expect(rounder.roundTotal('2.345').toString()).toBe('2.35');
      expect(rounder.roundTotal('-2.345').toString()).toBe('-2.35');
      expect(rounder.roundTotal('154.555').toString()).toBe('154.56');
    });

    it('aplica HALF_EVEN (bancário) sem viés estatístico', () => {
      const rounder = createRounder({ totalDecimals: 0, roundingMode: 'ROUND_HALF_EVEN' });
      expect(rounder.roundTotal('2.5').toString()).toBe('2');
      expect(rounder.roundTotal('3.5').toString()).toBe('4');
      expect(rounder.roundTotal('4.5').toString()).toBe('4');
      expect(rounder.roundTotal('-2.5').toString()).toBe('-2');
    });

    it('aplica ROUND_UP, ROUND_DOWN, CEILING e FLOOR corretamente', () => {
      const up = createRounder({ totalDecimals: 2, roundingMode: 'ROUND_UP' });
      const down = createRounder({ totalDecimals: 2, roundingMode: 'ROUND_DOWN' });
      const ceiling = createRounder({ totalDecimals: 2, roundingMode: 'ROUND_CEILING' });
      const floor = createRounder({ totalDecimals: 2, roundingMode: 'ROUND_FLOOR' });

      expect(up.roundTotal('1.231').toString()).toBe('1.24');
      expect(up.roundTotal('-1.231').toString()).toBe('-1.24');
      expect(down.roundTotal('1.239').toString()).toBe('1.23');
      expect(down.roundTotal('-1.239').toString()).toBe('-1.23');
      expect(ceiling.roundTotal('1.231').toString()).toBe('1.24');
      expect(ceiling.roundTotal('-1.231').toString()).toBe('-1.23');
      expect(floor.roundTotal('1.231').toString()).toBe('1.23');
      expect(floor.roundTotal('-1.231').toString()).toBe('-1.24');
    });

    it('respeita políticas com zero e seis casas decimais', () => {
      const zero = createRounder({ totalDecimals: 0, priceDecimals: 0 });
      expect(zero.roundTotal('2.5').toString()).toBe('3');
      expect(zero.roundPrice('10.49').toString()).toBe('10');

      const six = createRounder({ totalDecimals: 6, priceDecimals: 6 });
      expect(six.roundTotal('0.1234565').toString()).toBe('0.123457');
      expect(six.roundPrice('1.0000004').toString()).toBe('1');
    });

    it('é determinística em execuções repetidas', () => {
      const rounder = createRounder({ totalDecimals: 3 });
      const values = ['1.2345', '-9.8765', '0.0005', '99999.9995'];
      const first = values.map((value) => rounder.roundTotal(value).toString());
      for (let i = 0; i < 200; i++) {
        expect(values.map((value) => rounder.roundTotal(value).toString())).toEqual(first);
      }
    });
  });
});
