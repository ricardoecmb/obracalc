import { describe, expect, it } from 'vitest';
import {
  applyBdi,
  BDI_COMPONENT_DEFINITIONS,
  BDI_COMPONENT_KEYS,
  bdiComponentsFromFractions,
  calculateBdi,
  calculateBdiFromFractions,
  calculateBudgetItem,
  calculateStage,
  DEFAULT_BDI_COMPONENTS,
  DEFAULT_BDI_RATE,
  DEFAULT_BDI_RESULT,
  resolveBdi,
  toDecimal,
} from '../index';

/**
 * Componentes do exemplo de referência do Acórdão TCU nº 2622/2013.
 * A = 1 + 0,03 + 0,0059 + 0,008 + 0,008 + 0,0097 = 1,0616
 * B = 1 - (0,025 + 0 + 0,0365 + 0,0616) = 0,8769
 * BDI = (1,0616 / 0,8769 - 1) × 100 = 21,0628349868...%
 */
const REFERENCE_COMPONENTS = {
  ac: '3.00',
  cf: '0.59',
  s: '0.80',
  g: '0.80',
  mi: '0.97',
  tm: '2.50',
  te: '0.00',
  tf: '3.65',
  l: '6.16',
};

describe('Etapa 5 - BDI configurável (Acórdão TCU nº 2622/2013)', () => {
  describe('Cálculo numérico com percentuais', () => {
    it('calcula o exemplo de referência com parcelas A/B e taxa exata', () => {
      const result = calculateBdi(REFERENCE_COMPONENTS);

      expect(result.isValid).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.validationErrors).toHaveLength(0);

      expect(result.factorA.toString()).toBe('1.0616');
      expect(result.factorB.toString()).toBe('0.8769');
      expect(result.rate.toFixed(4)).toBe('21.0628');
      expect(result.percentage.equals(result.rate)).toBe(true);
    });

    it('aceita percentuais inteiros e decimais arbitrários de forma determinística', () => {
      const result = calculateBdi({
        ac: '5.00',
        cf: '1.00',
        s: '1.00',
        g: '1.00',
        mi: '1.00',
        tm: '3.00',
        te: '0.00',
        tf: '5.00',
        l: '8.00',
      });

      expect(result.isValid).toBe(true);
      expect(result.factorA.toString()).toBe('1.09');
      expect(result.factorB.toString()).toBe('0.84');
      expect(result.rate.toFixed(4)).toBe('29.7619');
    });

    it('retorna BDI zero quando todos os componentes são zero', () => {
      const result = calculateBdi({
        ac: 0,
        cf: 0,
        s: 0,
        g: 0,
        mi: 0,
        tm: 0,
        te: 0,
        tf: 0,
        l: 0,
      });

      expect(result.isValid).toBe(true);
      expect(result.factorA.toString()).toBe('1');
      expect(result.factorB.toString()).toBe('1');
      expect(result.rate.isZero()).toBe(true);
    });

    it('respeita a quantidade de casas decimais solicitada', () => {
      const result = calculateBdi(REFERENCE_COMPONENTS, { decimals: 6 });
      expect(result.rate.toFixed(6)).toBe('21.062835');
      expect(result.memory.decimals).toBe(6);
    });

    it('é reproduzível em execuções sucessivas', () => {
      const expected = calculateBdi(REFERENCE_COMPONENTS);
      for (let i = 0; i < 50; i++) {
        const current = calculateBdi(REFERENCE_COMPONENTS);
        expect(current.rate.toString()).toBe(expected.rate.toString());
        expect(current.memory.rawPercentage.toString()).toBe(
          expected.memory.rawPercentage.toString()
        );
      }
    });
  });

  describe('Validações e denominador inválido', () => {
    it('nunca produz Infinity/NaN quando o denominador é exatamente zero', () => {
      const result = calculateBdi({
        ...REFERENCE_COMPONENTS,
        tm: '50.00',
        te: '0.00',
        tf: '0.00',
        l: '50.00',
      });

      expect(result.isValid).toBe(false);
      expect(result.factorB.isZero()).toBe(true);
      expect(result.rate.isZero()).toBe(true);
      expect(result.rate.isFinite()).toBe(true);
      expect(result.memory.ratio.isFinite()).toBe(true);
      expect(result.memory.rawPercentage.isFinite()).toBe(true);
      expect(result.issues.map((issue) => issue.code)).toContain('DENOMINATOR_NOT_POSITIVE');
    });

    it('rejeita denominador negativo sem lançar exceção', () => {
      const result = calculateBdi({
        ...REFERENCE_COMPONENTS,
        tm: '80.00',
        te: '10.00',
        tf: '10.00',
        l: '20.00',
      });

      expect(result.isValid).toBe(false);
      expect(result.factorB.isNegative()).toBe(true);
      expect(result.rate.isZero()).toBe(true);
      expect(result.issues.map((issue) => issue.code)).toContain('DENOMINATOR_NOT_POSITIVE');
      expect(result.issues.map((issue) => issue.code)).toContain('TAXES_AT_OR_ABOVE_100');
    });

    it('rejeita componentes negativos e zera a taxa', () => {
      const result = calculateBdi({ ...REFERENCE_COMPONENTS, ac: '-1.00' });

      expect(result.isValid).toBe(false);
      expect(result.rate.isZero()).toBe(true);
      const issue = result.issues.find((entry) => entry.code === 'NEGATIVE_COMPONENT');
      expect(issue?.field).toBe('ac');
      expect(result.validationErrors.length).toBe(result.issues.length);
    });

    it('rejeita valores não numéricos sem lançar exceção', () => {
      const result = calculateBdi({
        ...REFERENCE_COMPONENTS,
        cf: 'abc' as unknown as string,
      });

      expect(result.isValid).toBe(false);
      expect(result.rate.isZero()).toBe(true);
      expect(result.issues.some((issue) => issue.code === 'INVALID_NUMBER')).toBe(true);
    });

    it('rejeita número inválido de casas decimais', () => {
      const result = calculateBdi(REFERENCE_COMPONENTS, { decimals: 13 });

      expect(result.isValid).toBe(false);
      expect(result.rate.isZero()).toBe(true);
      expect(result.memory.decimals).toBe(4);
      expect(result.issues.some((issue) => issue.code === 'INVALID_DECIMALS')).toBe(true);
    });
  });

  describe('Memória de cálculo', () => {
    it('registra fórmula, entradas, somatórios e passos auditáveis', () => {
      const result = calculateBdi(REFERENCE_COMPONENTS);
      const memory = result.memory;

      expect(memory.formula.numerator).toBe('A = 1 + AC + CF + S + G + MI');
      expect(memory.formula.denominator).toBe('B = 1 - (TM + TE + TF + L)');
      expect(memory.inputsPercent.ac.toString()).toBe('3');
      expect(memory.normalized.ac.toString()).toBe('0.03');
      expect(memory.sums.numeratorComponents.toString()).toBe('0.0616');
      expect(memory.sums.denominatorComponents.toString()).toBe('0.1231');
      expect(memory.sums.taxes.toString()).toBe('0.0615');
      expect(memory.factorA.toString()).toBe('1.0616');
      expect(memory.factorB.toString()).toBe('0.8769');
      expect(memory.rawPercentage.toFixed(10)).toBe('21.0628349869');
      expect(memory.roundedPercentage.toFixed(4)).toBe('21.0628');
      expect(memory.steps.length).toBeGreaterThanOrEqual(10);
      expect(result.calculationSteps).toEqual(memory.steps);
    });

    it('permite reproduzir a taxa a partir da própria memória', () => {
      const result = calculateBdi(REFERENCE_COMPONENTS);
      const recomputed = result.memory.factorA
        .dividedBy(result.memory.factorB)
        .minus(1)
        .times(100);

      expect(recomputed.toString()).toBe(result.memory.rawPercentage.toString());
    });

    it('documenta todos os componentes da fórmula', () => {
      expect(BDI_COMPONENT_DEFINITIONS).toHaveLength(9);
      expect(BDI_COMPONENT_DEFINITIONS.map((entry) => entry.key)).toEqual([
        ...BDI_COMPONENT_KEYS,
      ]);
      expect(new Set(BDI_COMPONENT_DEFINITIONS.map((entry) => entry.label)).size).toBe(9);
    });
  });

  describe('Componentes persistidos em fração unitária', () => {
    it('converte frações do banco (0,03) para percentuais (3,00)', () => {
      const components = bdiComponentsFromFractions({
        ac: '0.03',
        cf: '0.0059',
        s: '0.008',
        g: '0.008',
        mi: '0.0097',
        tm: '0.025',
        te: '0',
        tf: '0.0365',
        l: '0.0616',
      });

      expect(components.ac.toString()).toBe('3');
      expect(components.l.toString()).toBe('6.16');
    });

    it('calcula o mesmo BDI a partir de frações e de percentuais', () => {
      const fromPercent = calculateBdi(REFERENCE_COMPONENTS);
      const fromFractions = calculateBdiFromFractions({
        ac: '0.03',
        cf: '0.0059',
        s: '0.008',
        g: '0.008',
        mi: '0.0097',
        tm: '0.025',
        te: '0',
        tf: '0.0365',
        l: '0.0616',
      });

      expect(fromFractions.rate.toString()).toBe(fromPercent.rate.toString());
      expect(fromFractions.isValid).toBe(true);
    });
  });

  describe('BDI padrão do sistema', () => {
    it('calcula a taxa padrão esperada de 24,1180%', () => {
      expect(DEFAULT_BDI_RESULT.isValid).toBe(true);
      expect(DEFAULT_BDI_RESULT.factorA.toString()).toBe('1.073');
      expect(DEFAULT_BDI_RESULT.factorB.toString()).toBe('0.8645');
      expect(DEFAULT_BDI_RATE.toFixed(4)).toBe('24.1180');
      expect(DEFAULT_BDI_COMPONENTS.ac.toString()).toBe('4.00');
    });
  });

  describe('Resolução da taxa efetiva por precedência', () => {
    it('prioriza a exceção do serviço sobre a revisão e o padrão do sistema', () => {
      const resolution = resolveBdi({
        itemOverride: { id: 'item', name: 'Exceção', rate: '10.00' },
        revisionDefault: { id: 'rev', name: 'Revisão', rate: '20.00' },
        systemDefault: { id: 'sys', name: 'Sistema', rate: '30.00' },
      });

      expect(resolution.rate.toString()).toBe('10');
      expect(resolution.origin).toBe('ITEM_OVERRIDE');
      expect(resolution.configId).toBe('item');
      expect(resolution.isException).toBe(true);
    });

    it('usa o padrão da revisão quando não há exceção do serviço', () => {
      const resolution = resolveBdi({
        revisionDefault: { id: 'rev', name: 'Revisão', rate: '20.00' },
        systemDefault: { id: 'sys', name: 'Sistema', rate: '30.00' },
      });

      expect(resolution.rate.toString()).toBe('20');
      expect(resolution.origin).toBe('REVISION_DEFAULT');
      expect(resolution.isException).toBe(false);
    });

    it('usa o BDI padrão do sistema como último recurso', () => {
      const resolution = resolveBdi();

      expect(resolution.rate.toString()).toBe(DEFAULT_BDI_RATE.toString());
      expect(resolution.origin).toBe('SYSTEM_DEFAULT');
    });

    it('não aplica BDI quando o padrão do sistema é desabilitado', () => {
      const resolution = resolveBdi({ systemDefault: null });

      expect(resolution.origin).toBe('NONE');
      expect(resolution.rate.isZero()).toBe(true);
      expect(resolution.isException).toBe(false);
    });

    it('rejeita taxa negativa na resolução', () => {
      expect(() => resolveBdi({ itemOverride: { rate: '-5' } })).toThrow(
        /não pode ser negativo/
      );
    });
  });

  describe('Aplicação consistente no subtotal e no total', () => {
    it('aplica o BDI arredondando o valor uma única vez e soma exata', () => {
      const application = applyBdi('1000.00', '24.1180');

      expect(application.subtotal.toString()).toBe('1000');
      expect(application.bdiAmount.toString()).toBe('241.18');
      expect(application.total.toString()).toBe('1241.18');
      expect(application.total.equals(application.subtotal.plus(application.bdiAmount))).toBe(
        true
      );
    });

    it('mantém o item reconciliado: subtotal + BDI = total com BDI', () => {
      const item = calculateBudgetItem({
        itemId: 'item-bdi',
        quantity: '3',
        compositionCost: {
          material: toDecimal('10'),
          labor: toDecimal('5'),
          equipment: toDecimal('2'),
          other: toDecimal('1'),
          total: toDecimal('18'),
        },
        bdiRate: '21.0628',
      });

      expect(item.subtotal.toString()).toBe('54');
      expect(item.bdiAmount.toString()).toBe('11.37');
      expect(item.subtotalWithBdi.toString()).toBe('65.37');
      expect(item.subtotalWithBdi.equals(item.subtotal.plus(item.bdiAmount))).toBe(true);
    });

    it('preserva a reconciliação da etapa com taxas distintas por serviço', () => {
      const stage = calculateStage({
        id: 'stage-1',
        items: [
          {
            id: 'a',
            quantity: '2',
            compositionCost: {
              material: toDecimal('10'),
              labor: toDecimal('0'),
              equipment: toDecimal('0'),
              other: toDecimal('0'),
              total: toDecimal('10'),
            },
            bdiRate: '10.00',
          },
          {
            id: 'b',
            quantity: '1',
            compositionCost: {
              material: toDecimal('0'),
              labor: toDecimal('50'),
              equipment: toDecimal('0'),
              other: toDecimal('0'),
              total: toDecimal('50'),
            },
            bdiRate: '30.00',
          },
        ],
      });

      expect(stage.subtotal.toString()).toBe('70');
      expect(stage.bdiAmount.toString()).toBe('17');
      expect(stage.subtotalWithBdi.toString()).toBe('87');
      expect(stage.subtotalWithBdi.equals(stage.subtotal.plus(stage.bdiAmount))).toBe(true);
      expect(stage.items[0].bdiAmount.toString()).toBe('2');
      expect(stage.items[1].bdiAmount.toString()).toBe('15');
    });
  });
});
