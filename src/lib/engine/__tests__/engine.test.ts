import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import {
  calculateBdi,
  calculateBudgetItem,
  calculateBudgetTotals,
  reconcileBudgetTotals,
  calculateCompositionCost,
  calculateStage,
  createRounder,
  DEFAULT_ROUNDING_POLICY,
  defaultRounder,
  CompositionInput,
  StageInput,
} from '../index';

describe('ObraCalc - Engine de Cálculo', () => {
  describe('Arredondamento e Políticas Decimais (rounding.ts)', () => {
    it('deve usar a política padrão corretamente', () => {
      expect(DEFAULT_ROUNDING_POLICY.priceDecimals).toBe(4);
      expect(DEFAULT_ROUNDING_POLICY.quantityDecimals).toBe(4);
      expect(DEFAULT_ROUNDING_POLICY.coefficientDecimals).toBe(5);
      expect(DEFAULT_ROUNDING_POLICY.totalDecimals).toBe(2);
      expect(DEFAULT_ROUNDING_POLICY.roundingMode).toBe('ROUND_HALF_UP');
    });

    it('deve arredondar preços para 4 casas decimais', () => {
      const rounded = defaultRounder.roundPrice(new Decimal('12.34567'));
      expect(rounded.toString()).toBe('12.3457');
    });

    it('deve arredondar quantidades para 4 casas decimais', () => {
      const rounded = defaultRounder.roundQuantity('100.12345');
      expect(rounded.toString()).toBe('100.1235');
    });

    it('deve arredondar coeficientes para 5 casas decimais', () => {
      const rounded = defaultRounder.roundCoefficient('0.00123456');
      expect(rounded.toString()).toBe('0.00123');
    });

    it('deve arredondar totais para 2 casas decimais (centavos)', () => {
      const rounded = defaultRounder.roundTotal('154.555');
      expect(rounded.toString()).toBe('154.56');
    });

    it('deve suportar modo ROUND_HALF_EVEN (Banker\'s rounding)', () => {
      const rounder = createRounder({
        ...DEFAULT_ROUNDING_POLICY,
        roundingMode: 'ROUND_HALF_EVEN',
      });
      // 2.5 arredonda para o par mais próximo (2), 3.5 arredonda para o par mais próximo (4)
      expect(rounder.roundToDecimals('2.5', 0).toString()).toBe('2');
      expect(rounder.roundToDecimals('3.5', 0).toString()).toBe('4');
    });

    it('deve suportar modo ROUND_DOWN (truncamento)', () => {
      const rounder = createRounder({
        ...DEFAULT_ROUNDING_POLICY,
        roundingMode: 'ROUND_DOWN',
      });
      expect(rounder.roundTotal('10.999').toString()).toBe('10.99');
    });
  });

  describe('Cálculo de BDI (bdi.ts - Acórdão TCU 2622/2013)', () => {
    it('deve calcular BDI com precisão determinística conforme fórmula do TCU', () => {
      // Exemplo prático de BDI da construção civil brasileira:
      // AC = 3.00%, CF = 0.59%, S = 0.80%, G = 0.80%, MI = 0.97%
      // TM (ISS) = 2.50%, TE = 0%, TF (PIS+COFINS) = 3.65%, L = 6.16%
      const result = calculateBdi({
        ac: '3.00',
        cf: '0.59',
        s: '0.80',
        g: '0.80',
        mi: '0.97',
        tm: '2.50',
        te: '0.00',
        tf: '3.65',
        l: '6.16',
      });

      expect(result.isValid).toBe(true);
      expect(result.validationErrors).toHaveLength(0);

      // Numerador A = 1 + 0.03 + 0.0059 + 0.008 + 0.008 + 0.0097 = 1.0616
      expect(result.factorA.toFixed(4)).toBe('1.0616');

      // Denominador B = 1 - (0.025 + 0 + 0.0365 + 0.0616) = 1 - 0.1231 = 0.8769
      expect(result.factorB.toFixed(4)).toBe('0.8769');

      // BDI = ((1.0616 / 0.8769) - 1) * 100 = 21.062835... -> 21.0628%
      expect(result.rate.toFixed(4)).toBe('21.0628');
      expect(result.percentage.toFixed(4)).toBe('21.0628');
      expect(result.calculationSteps.length).toBeGreaterThan(0);
    });

    it('deve invalidar quando componentes forem negativos', () => {
      const result = calculateBdi({
        ac: '-1.00',
        cf: '0.50',
        s: '0.50',
        g: '0.50',
        mi: '1.00',
        tm: '2.00',
        te: '0.00',
        tf: '3.65',
        l: '5.00',
      });

      expect(result.isValid).toBe(false);
      expect(result.validationErrors.some((e) => e.includes('AC'))).toBe(true);
      expect(result.rate.toString()).toBe('0');
    });

    it('deve invalidar quando a soma de tributos e lucro for >= 100% (B <= 0)', () => {
      const result = calculateBdi({
        ac: '3.00',
        cf: '1.00',
        s: '1.00',
        g: '1.00',
        mi: '1.00',
        tm: '50.00',
        te: '30.00',
        tf: '25.00', // tributos = 105%
        l: '10.00',
      });

      expect(result.isValid).toBe(false);
      expect(result.validationErrors.some((e) => e.includes('inferior a 100%'))).toBe(true);
    });
  });

  describe('Cálculo de Composições de Custos (calculator.ts)', () => {
    it('deve calcular composição analítica agregando por categoria', () => {
      const composition: CompositionInput = {
        id: 'comp-1',
        code: 'SINAPI-88247',
        description: 'PINTURA COM TINTA LÁTEX ACRÍLICA EM PAREDES',
        unit: 'm²',
        type: 'ANALYTICAL',
        components: [
          {
            coefficient: '0.25000', // 0.25 L de tinta
            resource: {
              id: 'res-tinta',
              code: '00007356',
              description: 'Tinta látex acrílica premium',
              unit: 'L',
              category: 'MATERIAL',
              price: '24.5000',
              laborChargesIncluded: true,
            },
          },
          {
            coefficient: '0.15000', // 0.15 h de pintor
            resource: {
              id: 'res-pintor',
              code: '00004750',
              description: 'Pintor com encargos complementares',
              unit: 'h',
              category: 'LABOR',
              price: '28.0000',
              laborChargesIncluded: true,
            },
          },
        ],
      };

      const result = calculateCompositionCost(composition, defaultRounder);

      // Material: 0.25 * 24.50 = 6.125 -> roundTotal = 6.13
      expect(result.unitCost.material.toString()).toBe('6.13');

      // Mão de obra: 0.15 * 28.00 = 4.20 -> roundTotal = 4.20
      expect(result.unitCost.labor.toString()).toBe('4.2');

      // Equipamento e Outros = 0
      expect(result.unitCost.equipment.toString()).toBe('0');
      expect(result.unitCost.other.toString()).toBe('0');

      // Total = 6.13 + 4.20 = 10.33
      expect(result.unitCost.total.toString()).toBe('10.33');
      expect(result.componentDetails).toHaveLength(2);
    });

    it('deve aplicar encargos sociais quando laborChargesIncluded = false', () => {
      const composition: CompositionInput = {
        id: 'comp-encargos',
        code: 'TESTE-01',
        description: 'Serviço com encargos não inclusos na hora base',
        unit: 'h',
        type: 'ANALYTICAL',
        components: [
          {
            coefficient: '1.00000',
            resource: {
              id: 'res-pedreiro-base',
              code: '00004751',
              description: 'Pedreiro (salário base seco)',
              unit: 'h',
              category: 'LABOR',
              price: '10.0000',
              laborChargesIncluded: false,
              laborChargesRate: '80.00', // 80% de encargos sociais
            },
          },
        ],
      };

      const result = calculateCompositionCost(composition, defaultRounder);
      // Preço com encargos: 10 * (1 + 0.80) = 18.0000
      expect(result.unitCost.labor.toString()).toBe('18');
      expect(result.unitCost.total.toString()).toBe('18');
    });

    it('deve resolver composições auxiliares aninhadas mantendo desdobramento de categorias', () => {
      // Subcomposição (ex.: Argamassa de cimento e areia)
      const subComposition: CompositionInput = {
        id: 'sub-argamassa',
        code: 'SINAPI-87292',
        description: 'Argamassa traço 1:3',
        unit: 'm³',
        type: 'ANALYTICAL',
        components: [
          {
            coefficient: '400.00000',
            resource: {
              id: 'res-cimento',
              code: '00001379',
              description: 'Cimento Portland',
              unit: 'kg',
              category: 'MATERIAL',
              price: '0.6500',
              laborChargesIncluded: true,
            },
          },
          {
            coefficient: '5.00000',
            resource: {
              id: 'res-servente-arg',
              code: '00006111',
              description: 'Servente',
              unit: 'h',
              category: 'LABOR',
              price: '20.0000',
              laborChargesIncluded: true,
            },
          },
        ],
      };

      // Composição principal (ex.: Alvenaria que consome 0.05 m³ de argamassa)
      const mainComposition: CompositionInput = {
        id: 'main-alvenaria',
        code: 'SINAPI-87500',
        description: 'Alvenaria de vedação',
        unit: 'm²',
        type: 'ANALYTICAL',
        components: [
          {
            coefficient: '0.05000',
            childComposition: subComposition,
          },
        ],
      };

      const result = calculateCompositionCost(mainComposition, defaultRounder);

      // Subcomposição unitCost:
      // Cimento: 400 * 0.65 = 260.00 (Material)
      // Servente: 5 * 20.00 = 100.00 (Mão de obra)
      // Total sub = 360.00
      //
      // Consumo na principal: 0.05
      // Material propagado: 0.05 * 260.00 = 13.00
      // Mão de obra propagada: 0.05 * 100.00 = 5.00
      // Total principal = 18.00
      expect(result.unitCost.material.toString()).toBe('13');
      expect(result.unitCost.labor.toString()).toBe('5');
      expect(result.unitCost.total.toString()).toBe('18');
      expect(result.componentDetails[0].category).toBe('COMPOSITION');
    });

    it('deve detectar dependência circular e lançar erro claro', () => {
      const compA: CompositionInput = {
        id: 'comp-a',
        code: 'A',
        description: 'Composição A',
        unit: 'un',
        type: 'ANALYTICAL',
        components: [],
      };

      const compB: CompositionInput = {
        id: 'comp-b',
        code: 'B',
        description: 'Composição B',
        unit: 'un',
        type: 'ANALYTICAL',
        components: [
          {
            coefficient: '1.00000',
            childComposition: compA,
          },
        ],
      };

      // Faz A depender de B (ciclo A -> B -> A)
      compA.components.push({
        coefficient: '1.00000',
        childComposition: compB,
      });

      expect(() => calculateCompositionCost(compA, defaultRounder)).toThrow(
        /Dependência circular detectada/
      );
    });

    it('deve processar composições fechadas (CLOSED) sem inventar desdobramento', () => {
      const closedComp: CompositionInput = {
        id: 'comp-fechada',
        code: 'COTACAO-999',
        description: 'Subestação blindada fornecida por terceiro',
        unit: 'un',
        type: 'CLOSED',
        closedTotalPrice: '150000.00',
        components: [],
      };

      const result = calculateCompositionCost(closedComp, defaultRounder);

      expect(result.unitCost.total.toString()).toBe('150000');
      expect(result.unitCost.material.toString()).toBe('0');
      expect(result.unitCost.labor.toString()).toBe('0');
      expect(result.breakdownUnavailable).toBe(true);
      expect(result.componentDetails).toHaveLength(0);
    });
  });

  describe('Cálculo de Item Orçamentário e Etapas (calculator.ts)', () => {
    it('deve calcular item do orçamento com subtotal e BDI', () => {
      const itemResult = calculateBudgetItem(
        {
          itemId: 'item-10',
          quantity: '50.0000',
          compositionCost: {
            material: new Decimal('100.00'),
            labor: new Decimal('50.00'),
            equipment: new Decimal('0.00'),
            other: new Decimal('0.00'),
            total: new Decimal('150.00'),
          },
          bdiRate: '25.00', // 25% de BDI
        },
        defaultRounder
      );

      // Subtotal = 50 * 150 = 7.500,00
      expect(itemResult.subtotal.toString()).toBe('7500');

      // Subtotal com BDI = 7.500 * (1 + 0.25) = 7.500 * 1.25 = 9.375,00
      expect(itemResult.subtotalWithBdi.toString()).toBe('9375');
    });

    it('deve calcular etapa e subetapas recursivas sem dupla contagem', () => {
      const stageHierarchy: StageInput = {
        id: 'stage-1',
        title: '1. INFRAESTRUTURA',
        items: [
          {
            itemId: 'item-1-1',
            quantity: '10.00',
            compositionCost: {
              material: new Decimal('20.00'),
              labor: new Decimal('10.00'),
              equipment: new Decimal('0'),
              other: new Decimal('0'),
              total: new Decimal('30.00'),
            },
            bdiRate: '20.00',
          },
        ],
        childStages: [
          {
            id: 'stage-1-1',
            title: '1.1 Movimento de Terra',
            items: [
              {
                itemId: 'item-1-1-1',
                quantity: '5.00',
                compositionCost: {
                  material: new Decimal('0'),
                  labor: new Decimal('50.00'),
                  equipment: new Decimal('50.00'),
                  other: new Decimal('0'),
                  total: new Decimal('100.00'),
                },
                bdiRate: '20.00',
              },
            ],
            childStages: [],
          },
        ],
      };

      const stageResult = calculateStage(stageHierarchy, undefined, defaultRounder);

      // Item direto da etapa 1: 10 * 30 = 300; com BDI (20%): 360
      expect(stageResult.items[0].subtotal.toString()).toBe('300');
      expect(stageResult.items[0].subtotalWithBdi.toString()).toBe('360');

      // Subetapa 1.1: 5 * 100 = 500; com BDI (20%): 600
      const childStage = stageResult.childStages[0];
      expect(childStage.subtotal.toString()).toBe('500');
      expect(childStage.subtotalWithBdi.toString()).toBe('600');

      // Total consolidado da etapa 1 (itens diretos + subetapas sem duplicidade):
      // subtotal = 300 + 500 = 800
      // subtotalWithBdi = 360 + 600 = 960
      expect(stageResult.subtotal.toString()).toBe('800');
      expect(stageResult.subtotalWithBdi.toString()).toBe('960');
    });

    it('deve consolidar totais do orçamento a partir de etapas de topo', () => {
      const stage1Result = calculateStage({
        id: 'stage-1',
        items: [
          {
            itemId: 'item-a',
            quantity: '10',
            compositionCost: {
              material: new Decimal('10'),
              labor: new Decimal('0'),
              equipment: new Decimal('0'),
              other: new Decimal('0'),
              total: new Decimal('10'),
            },
            bdiRate: '20',
          },
        ],
      });

      const stage2Result = calculateStage({
        id: 'stage-2',
        items: [
          {
            itemId: 'item-b',
            quantity: '20',
            compositionCost: {
              material: new Decimal('20'),
              labor: new Decimal('0'),
              equipment: new Decimal('0'),
              other: new Decimal('0'),
              total: new Decimal('20'),
            },
            bdiRate: '20',
          },
        ],
      });

      const budgetSummary = calculateBudgetTotals([stage1Result, stage2Result]);

      // Stage 1: subtotal = 100, withBdi = 120
      // Stage 2: subtotal = 400, withBdi = 480
      // Total subtotal = 500, withBdi = 600
      // Total BDI = 100
      // Taxa efetiva = (100 / 500) * 100 = 20.0000%
      expect(budgetSummary.subtotal.toString()).toBe('500');
      expect(budgetSummary.subtotalWithBdi.toString()).toBe('600');
      expect(budgetSummary.totalBdiAmount.toString()).toBe('100');
      expect(budgetSummary.effectiveBdiRate.toString()).toBe('20');
    });

    it('deve suportar conversão de unidades em componentes da composição com precisão decimal', () => {
      // Insumo comercializado em tonelada (t) a R$ 6.000,00/t
      // Consumo na composição em kg: 1 t = 1000 kg -> fator 0.001
      // Coeficiente na composição: 250 kg
      // Custo esperado: 250 * 0.001 * 6000 = 1500.00
      const compWithConversion: CompositionInput = {
        id: 'comp-aco',
        code: 'EST-01',
        description: 'Armadura com insumo convertido de t para kg',
        unit: 'm³',
        type: 'ANALYTICAL',
        components: [
          {
            id: 'c-1',
            coefficient: '250',
            unitConversionFactor: '0.001',
            resource: {
              id: 'res-aco',
              code: 'ACO-TON',
              description: 'Aço CA-50 em tonelada',
              unit: 't',
              category: 'MATERIAL',
              price: '6000.0000',
              laborChargesIncluded: false,
            },
          },
        ],
      };

      const result = calculateCompositionCost(compWithConversion, defaultRounder);
      expect(result.unitCost.material.toString()).toBe('1500');
      expect(result.unitCost.total.toString()).toBe('1500');
      expect(result.componentDetails[0].coefficient.toString()).toBe('0.25');
    });

    it('deve calcular recursão em 3 níveis (Composição Nível 1 -> Nível 2 -> Nível 3) propagando categorias', () => {
      // Nível 3: Argamassa
      const argamassa: CompositionInput = {
        id: 'comp-argamassa',
        code: 'ARG-01',
        description: 'Argamassa traço 1:3',
        unit: 'm³',
        type: 'ANALYTICAL',
        components: [
          {
            coefficient: '400', // 400 kg de cimento a R$ 0,70 = R$ 280
            resource: {
              id: 'res-cimento',
              code: 'CIM-01',
              description: 'Cimento',
              unit: 'kg',
              category: 'MATERIAL',
              price: '0.70',
              laborChargesIncluded: false,
            },
          },
          {
            coefficient: '4', // 4 h de servente a R$ 15,00 = R$ 60
            resource: {
              id: 'res-serv',
              code: 'SER-01',
              description: 'Servente',
              unit: 'h',
              category: 'LABOR',
              price: '15.00',
              laborChargesIncluded: true,
            },
          },
        ],
      };
      // Argamassa total = 280 (mat) + 60 (mo) = 340 / m³

      // Nível 2: Alvenaria (consome 0,05 m³ de argamassa + tijolos)
      const alvenaria: CompositionInput = {
        id: 'comp-alvenaria',
        code: 'ALV-01',
        description: 'Alvenaria de vedação',
        unit: 'm²',
        type: 'ANALYTICAL',
        components: [
          {
            coefficient: '0.05', // 0,05 m³ de argamassa
            childComposition: argamassa,
          },
          {
            coefficient: '25', // 25 tijolos a R$ 1,20 = R$ 30 (mat)
            resource: {
              id: 'res-tijolo',
              code: 'TIJ-01',
              description: 'Tijolo',
              unit: 'un',
              category: 'MATERIAL',
              price: '1.20',
              laborChargesIncluded: false,
            },
          },
          {
            coefficient: '1.5', // 1,5 h pedreiro a R$ 24,00 = R$ 36 (mo)
            resource: {
              id: 'res-pedreiro',
              code: 'PED-01',
              description: 'Pedreiro',
              unit: 'h',
              category: 'LABOR',
              price: '24.00',
              laborChargesIncluded: true,
            },
          },
        ],
      };
      // Alvenaria:
      // Material = (0,05 * 280 = 14) + 30 = 44
      // Labor = (0,05 * 60 = 3) + 36 = 39
      // Total alvenaria = 83 / m²

      // Nível 1: Parede Pronta (consome 1 m² de alvenaria + pintura)
      const parede: CompositionInput = {
        id: 'comp-parede',
        code: 'PAR-01',
        description: 'Parede acabada com pintura',
        unit: 'm²',
        type: 'ANALYTICAL',
        components: [
          {
            coefficient: '1.0',
            childComposition: alvenaria,
          },
          {
            coefficient: '0.2', // 0,2 l tinta a R$ 25 = R$ 5 (mat)
            resource: {
              id: 'res-tinta',
              code: 'TIN-01',
              description: 'Tinta Acrílica',
              unit: 'l',
              category: 'MATERIAL',
              price: '25.00',
              laborChargesIncluded: false,
            },
          },
        ],
      };

      const result = calculateCompositionCost(parede, defaultRounder);

      // Material final: 44 + 5 = 49
      expect(result.unitCost.material.toString()).toBe('49');
      // Mão de obra final: 39
      expect(result.unitCost.labor.toString()).toBe('39');
      // Total final: 49 + 39 = 88
      expect(result.unitCost.total.toString()).toBe('88');
    });

    it('deve realizar reconciliação exata dos totais verticais e horizontais sem discrepâncias', () => {
      // Cria etapas com itens contendo material e mão de obra
      const stageRoot = calculateStage({
        id: 'stg-root',
        items: [
          {
            itemId: 'item-1',
            quantity: '10',
            compositionCost: {
              material: new Decimal('40.00'),
              labor: new Decimal('20.00'),
              equipment: new Decimal('5.00'),
              other: new Decimal('0'),
              total: new Decimal('65.00'),
            },
            bdiRate: '20.00',
          },
          {
            itemId: 'item-2',
            quantity: '5',
            compositionCost: {
              material: new Decimal('100.00'),
              labor: new Decimal('50.00'),
              equipment: new Decimal('0'),
              other: new Decimal('10.00'),
              total: new Decimal('160.00'),
            },
            bdiRate: '20.00',
          },
        ],
      });

      // Reconciliação dos totais
      const reconciled = reconcileBudgetTotals([stageRoot], defaultRounder);

      // Item 1: 10 * 65 = 650 (mat: 400, mo: 200, eq: 50, out: 0)
      // Item 2: 5 * 160 = 800 (mat: 500, mo: 250, eq: 0, out: 50)
      // Total vertical subtotal = 1450.00
      expect(reconciled.subtotal.toString()).toBe('1450');

      // Totais horizontais por categoria:
      expect(reconciled.totalMaterial.toString()).toBe('900'); // 400 + 500
      expect(reconciled.totalLabor.toString()).toBe('450'); // 200 + 250
      expect(reconciled.totalEquipment.toString()).toBe('50'); // 50 + 0
      expect(reconciled.totalOther.toString()).toBe('50'); // 0 + 50
      expect(reconciled.categoryTotal.toString()).toBe('1450'); // 900 + 450 + 50 + 50

      // Reconciliação comprovada: discrepância zero!
      expect(reconciled.roundingDiscrepancy.toString()).toBe('0');
      expect(reconciled.isReconciled).toBe(true);

      // Com BDI (20%): 1450 * 1.20 = 1740.00
      expect(reconciled.subtotalWithBdi.toString()).toBe('1740');
      expect(reconciled.totalBdiAmount.toString()).toBe('290');
    });

    it('deve garantir resultados 100% reproduzíveis sob a mesma política de arredondamento', () => {
      const compSample: CompositionInput = {
        id: 'comp-reprod',
        code: 'REP-01',
        description: 'Amostra de teste determinístico',
        unit: 'm²',
        type: 'ANALYTICAL',
        components: [
          {
            coefficient: '0.33333',
            resource: {
              id: 'res-r1',
              code: 'R1',
              description: 'Insumo 1',
              unit: 'un',
              category: 'MATERIAL',
              price: '14.2857',
              laborChargesIncluded: false,
            },
          },
        ],
      };

      // Executa 5 vezes seguidas
      const run1 = calculateCompositionCost(compSample, defaultRounder);
      const run2 = calculateCompositionCost(compSample, defaultRounder);
      const run3 = calculateCompositionCost(compSample, defaultRounder);
      const run4 = calculateCompositionCost(compSample, defaultRounder);
      const run5 = calculateCompositionCost(compSample, defaultRounder);

      expect(run1.unitCost.total.toString()).toBe(run2.unitCost.total.toString());
      expect(run2.unitCost.total.toString()).toBe(run3.unitCost.total.toString());
      expect(run3.unitCost.total.toString()).toBe(run4.unitCost.total.toString());
      expect(run4.unitCost.total.toString()).toBe(run5.unitCost.total.toString());
    });
  });
});
