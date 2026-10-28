import { describe, expect, it } from 'vitest';
import {
  createUnitConverter,
  defaultUnitConverter,
  normalizeUnitSymbol,
  UnitConversionError,
} from '../index';

describe('Etapa 4 - Conversões de unidades', () => {
  describe('Unidades usuais da construção civil', () => {
    it('converte massa, volume, comprimento, área e tempo com fatores exatos', () => {
      expect(defaultUnitConverter.factor('t', 'kg').toString()).toBe('1000');
      expect(defaultUnitConverter.factor('kg', 'g').toString()).toBe('1000');
      expect(defaultUnitConverter.factor('kg', 't').toString()).toBe('0.001');
      expect(defaultUnitConverter.factor('m3', 'l').toString()).toBe('1000');
      expect(defaultUnitConverter.factor('l', 'ml').toString()).toBe('1000');
      expect(defaultUnitConverter.factor('m', 'cm').toString()).toBe('100');
      expect(defaultUnitConverter.factor('km', 'm').toString()).toBe('1000');
      expect(defaultUnitConverter.factor('ha', 'm2').toString()).toBe('10000');
      expect(defaultUnitConverter.factor('h', 'min').toString()).toBe('60');
      expect(defaultUnitConverter.factor('d', 'h').toString()).toBe('24');
      expect(defaultUnitConverter.factor('mil', 'un').toString()).toBe('1000');
    });

    it('converte valores mantendo precisão decimal', () => {
      expect(defaultUnitConverter.convert('2.5', 't', 'kg').toString()).toBe('2500');
      expect(defaultUnitConverter.convert('250', 'kg', 't').toString()).toBe('0.25');
      expect(defaultUnitConverter.convert('0.001', 'm3', 'l').toString()).toBe('1');
      expect(defaultUnitConverter.convert('123.456', 'cm', 'm').toString()).toBe('1.23456');
    });

    it('normaliza símbolos equivalentes', () => {
      expect(normalizeUnitSymbol('M²')).toBe('m2');
      expect(normalizeUnitSymbol('m^2')).toBe('m2');
      expect(normalizeUnitSymbol('m2')).toBe('m2');
      expect(normalizeUnitSymbol('M³')).toBe('m3');
      expect(defaultUnitConverter.normalize('Litros')).toBe('l');
      expect(defaultUnitConverter.normalize('peça')).toBe('un');
      expect(defaultUnitConverter.normalize('TONELADAS')).toBe('t');
    });

    it('informa dimensões e testa compatibilidade', () => {
      expect(defaultUnitConverter.dimensionOf('m³')).toBe('VOLUME');
      expect(defaultUnitConverter.dimensionOf('kg')).toBe('MASS');
      expect(defaultUnitConverter.dimensionOf('h')).toBe('TIME');
      expect(defaultUnitConverter.canConvert('m', 'cm')).toBe(true);
      expect(defaultUnitConverter.canConvert('m', 'kg')).toBe(false);
      expect(defaultUnitConverter.canConvert('saco', 'kg')).toBe(false);
    });

    it('rejeita unidades fisicamente incompatíveis e conversões inexistentes', () => {
      expect(() => defaultUnitConverter.factor('m', 'kg')).toThrow(UnitConversionError);
      expect(() => defaultUnitConverter.factor('saco', 'kg')).toThrow(UnitConversionError);
      expect(() => defaultUnitConverter.factor('m', 'm')).not.toThrow();
      expect(defaultUnitConverter.factor('saco', 'saco').toString()).toBe('1');
    });

    it('marca como não exata a conversão inversa de fator com dízima', () => {
      expect(defaultUnitConverter.resolve('t', 'kg').isExact).toBe(true);
      expect(defaultUnitConverter.resolve('kg', 'lb').isExact).toBe(false);
    });
  });

  describe('Regras customizadas', () => {
    it('aceita regras em array e deriva o inverso', () => {
      const converter = createUnitConverter([
        { fromUnit: 'saco', toUnit: 'kg', factor: '50' },
        { fromUnit: 'caixa', toUnit: 'saco', factor: '12', isExact: true },
      ]);

      expect(converter.factor('saco', 'kg').toString()).toBe('50');
      expect(converter.factor('kg', 'saco').toString()).toBe('0.02');
      expect(converter.factor('caixa', 'kg').toString()).toBe('600');
      expect(converter.factor('kg', 'caixa').toDecimalPlaces(8).toString()).toBe('0.00166667');
      expect(converter.convert('3', 'caixa', 'kg').toString()).toBe('1800');
      expect(converter.dimensionOf('caixa')).toBe('MASS');
    });

    it('aceita Map/objeto com chave "origem->destino"', () => {
      const fromMap = createUnitConverter(new Map([['saco->kg', '50']]));
      expect(fromMap.factor('saco', 'kg').toString()).toBe('50');

      const fromRecord = createUnitConverter({ 'caixa>kg': '600' });
      expect(fromRecord.factor('kg', 'caixa').toDecimalPlaces(8).toString()).toBe('0.00166667');
    });

    it('aceita função resolvedora', () => {
      const converter = createUnitConverter((from, to) => {
        if (from === 'saco' && to === 'kg') return '50';
        return undefined;
      });
      expect(converter.factor('saco', 'kg').toString()).toBe('50');
      expect(() => converter.factor('saco', 't')).toThrow(UnitConversionError);
    });

    it('usa definições para validar dimensões de unidades customizadas', () => {
      const converter = createUnitConverter(
        [{ fromUnit: 'saco', toUnit: 'kg', factor: '50' }],
        { definitions: [{ symbol: 'saco', dimension: 'MASS' }] }
      );
      expect(converter.factor('saco', 't').toString()).toBe('0.05');
      expect(converter.dimensionOf('saco')).toBe('MASS');
    });

    it('rejeita regras conflitantes e inconsistentes com caminhos existentes', () => {
      expect(() =>
        createUnitConverter([{ fromUnit: 'm', toUnit: 'cm', factor: '99' }])
      ).toThrow(/conflitantes|inconsistente/);

      expect(() =>
        createUnitConverter([{ fromUnit: 'cm', toUnit: 'mm', factor: '99' }])
      ).toThrow(/inconsistente/);

      expect(() =>
        createUnitConverter([{ fromUnit: 'm', toUnit: 'kg', factor: '1' }])
      ).toThrow(/incompatíveis/);
    });

    it('rejeita fatores zero, negativos e chaves inválidas', () => {
      expect(() =>
        createUnitConverter([{ fromUnit: 'saco', toUnit: 'kg', factor: '0' }])
      ).toThrow(UnitConversionError);
      expect(() =>
        createUnitConverter([{ fromUnit: 'saco', toUnit: 'kg', factor: '-1' }])
      ).toThrow(UnitConversionError);
      expect(() => createUnitConverter({ saco: '50' })).toThrow(/Chave de conversão inválida/);
    });

    it('permite desabilitar as unidades embutidas', () => {
      const converter = createUnitConverter(
        [{ fromUnit: 'kg', toUnit: 'g', factor: '1000' }],
        { includeBuiltIns: false }
      );
      expect(converter.factor('kg', 'g').toString()).toBe('1000');
      expect(converter.canConvert('m', 'cm')).toBe(false);
    });
  });
});
