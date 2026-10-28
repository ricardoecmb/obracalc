import { describe, expect, it } from 'vitest';
import {
  calculateBudgetItem,
  calculateBudgetTotals,
  calculateStage,
  createRounder,
  reconcileBudgetTotals,
  StageInput,
  toDecimal,
} from '../index';

function unitCost(material: string, labor: string, equipment: string, other: string) {
  const total = toDecimal(material)
    .plus(labor)
    .plus(equipment)
    .plus(other);
  return {
    material: toDecimal(material),
    labor: toDecimal(labor),
    equipment: toDecimal(equipment),
    other: toDecimal(other),
    total,
  };
}

describe('Etapa 4 - Reconciliação exata dos totais', () => {
  describe('Alocação determinística de resíduos', () => {
    it('aloca o resíduo de arredondamento na maior categoria e fecha o subtotal', () => {
      const item = calculateBudgetItem({
        itemId: 'residuo',
        quantity: '0.375',
        compositionCost: {
          material: toDecimal('0.01'),
          labor: toDecimal('0.01'),
          equipment: toDecimal('0.01'),
          other: toDecimal('0.01'),
          total: toDecimal('0.04'),
        },
        bdiRate: '0',
      });

      // 0,375 × 0,04 = 0,015 -> 0,02 (HALF_UP)
      expect(item.subtotal.toString()).toBe('0.02');
      expect(item.roundingResidual.toString()).toBe('0.02');

      const amounts = item.categoryAmounts;
      // Empate entre as quatro categorias: ordem fixa escolhe MATERIAL.
      expect(amounts.material.toString()).toBe('0.02');
      expect(amounts.labor.toString()).toBe('0');
      expect(amounts.equipment.toString()).toBe('0');
      expect(amounts.other.toString()).toBe('0');
      expect(amounts.unallocated.toString()).toBe('0');
      expect(amounts.total.toString()).toBe('0.02');
      expect(amounts.total.equals(item.subtotal)).toBe(true);
      expect(item.breakdownAvailable).toBe(true);
    });

    it('é reproduzível em 100 itens com coeficientes fracionários', () => {
      const compositionCost = unitCost('1.1111', '2.2222', '3.3333', '4.4444');
      const expected = calculateBudgetItem({
        quantity: '3.3333',
        compositionCost,
        bdiRate: '12.3456',
      });

      for (let i = 0; i < 100; i++) {
        const item = calculateBudgetItem({
          quantity: '3.3333',
          compositionCost,
          bdiRate: '12.3456',
        });
        expect(item.subtotal.toString()).toBe(expected.subtotal.toString());
        expect(item.subtotalWithBdi.toString()).toBe(expected.subtotalWithBdi.toString());
        expect(item.categoryAmounts.material.toString()).toBe(
          expected.categoryAmounts.material.toString()
        );
        expect(item.categoryAmounts.total.equals(item.subtotal)).toBe(true);
      }
    });

    it('mantém o fechamento com políticas de 0, 2 e 4 casas decimais', () => {
      const compositionCost = unitCost('1.1111', '2.2222', '3.3333', '4.4444');

      for (const totalDecimals of [0, 2, 4]) {
        const rounder = createRounder({
          totalDecimals,
          priceDecimals: 4,
          quantityDecimals: 6,
          coefficientDecimals: 6,
        });
        const item = calculateBudgetItem(
          { quantity: '1.234567', compositionCost, bdiRate: '7.77' },
          rounder
        );

        const amounts = item.categoryAmounts;
        expect(
          amounts.material
            .plus(amounts.labor)
            .plus(amounts.equipment)
            .plus(amounts.other)
            .plus(amounts.unallocated)
            .equals(item.subtotal)
        ).toBe(true);
        expect(amounts.total.equals(item.subtotal)).toBe(true);
      }
    });
  });

  describe('Reconciliação vertical x horizontal', () => {
    it('reconcilia exatamente itens analíticos sem tolerância de centavos', () => {
      const stage: StageInput = {
        id: 'stage-analitico',
        items: [
          {
            itemId: 'item-a',
            quantity: '3.3333',
            compositionCost: {
              ...unitCost('1.1111', '2.2222', '3.3333', '4.4444'),
              total: toDecimal('11.111'),
            },
            bdiRate: '12.3456',
          },
        ],
      };

      const stageResult = calculateStage(stage);
      const reconciled = reconcileBudgetTotals([stageResult]);

      expect(reconciled.subtotal.toString()).toBe('37.04');
      expect(reconciled.totalUnallocated.toString()).toBe('0');
      expect(reconciled.roundingDiscrepancy.toString()).toBe('0');
      expect(reconciled.isTotalsExact).toBe(true);
      expect(reconciled.isReconciled).toBe(true);

      expect(
        reconciled.totalMaterial
          .plus(reconciled.totalLabor)
          .plus(reconciled.totalEquipment)
          .plus(reconciled.totalOther)
          .equals(reconciled.categoryTotal)
      ).toBe(true);
      expect(reconciled.categoryTotal.equals(reconciled.subtotal)).toBe(true);
      expect(reconciled.accountedTotal.equals(reconciled.subtotal)).toBe(true);
    });

    it('consolida hierarquia de etapas sem dupla contagem', () => {
      const stage: StageInput = {
        id: 'root',
        items: [
          {
            itemId: 'root-item',
            quantity: '10',
            compositionCost: unitCost('1', '2', '3', '4'),
            bdiRate: '10',
          },
        ],
        childStages: [
          {
            id: 'child',
            items: [
              {
                itemId: 'child-item',
                quantity: '5',
                compositionCost: unitCost('10', '20', '30', '40'),
                bdiRate: '10',
              },
            ],
            childStages: [
              {
                id: 'grandchild',
                items: [
                  {
                    itemId: 'grandchild-item',
                    quantity: '2',
                    compositionCost: unitCost('100', '0', '0', '0'),
                    bdiRate: '10',
                  },
                ],
              },
            ],
          },
        ],
      };

      const root = calculateStage(stage);

      // root: 10 × 10 = 100; child: 5 × 100 = 500; grandchild: 2 × 100 = 200
      expect(root.subtotal.toString()).toBe('800');
      expect(root.subtotalWithBdi.toString()).toBe('880');

      const reconciled = reconcileBudgetTotals([root]);
      expect(reconciled.subtotal.toString()).toBe('800');
      expect(reconciled.categoryTotal.toString()).toBe('800');
      expect(reconciled.totalUnallocated.toString()).toBe('0');
      expect(reconciled.roundingDiscrepancy.toString()).toBe('0');
      expect(reconciled.isReconciled).toBe(true);
    });

    it('separa custo fechado sem desdobramento em totalUnallocated', () => {
      const stage = calculateStage({
        id: 'stage-fechado',
        items: [
          {
            itemId: 'fechado',
            quantity: '2',
            compositionCost: {
              material: toDecimal('0'),
              labor: toDecimal('0'),
              equipment: toDecimal('0'),
              other: toDecimal('0'),
              total: toDecimal('100'),
            },
            bdiRate: '0',
          },
        ],
      });

      const item = stage.items[0];
      expect(item.subtotal.toString()).toBe('200');
      expect(item.categoryAmounts.unallocated.toString()).toBe('200');
      expect(item.breakdownAvailable).toBe(false);

      const reconciled = reconcileBudgetTotals([stage]);
      expect(reconciled.subtotal.toString()).toBe('200');
      expect(reconciled.categoryTotal.toString()).toBe('0');
      expect(reconciled.totalUnallocated.toString()).toBe('200');
      expect(reconciled.accountedTotal.toString()).toBe('200');
      expect(reconciled.roundingDiscrepancy.toString()).toBe('0');
      expect(reconciled.isTotalsExact).toBe(true);
      // Fecha contabilmente, mas não há desdobramento completo por categoria.
      expect(reconciled.isReconciled).toBe(false);
    });

    it('reconcilia orçamento misto (analítico + fechado) mantendo o fechamento contábil', () => {
      const stage = calculateStage({
        id: 'stage-misto',
        items: [
          {
            itemId: 'analitico',
            quantity: '3',
            compositionCost: unitCost('10.005', '20.005', '0', '1.005'),
            bdiRate: '25',
          },
          {
            itemId: 'fechado',
            quantity: '1',
            compositionCost: {
              material: toDecimal('0'),
              labor: toDecimal('0'),
              equipment: toDecimal('0'),
              other: toDecimal('0'),
              total: toDecimal('50.55'),
            },
            bdiRate: '25',
          },
        ],
      });

      const reconciled = reconcileBudgetTotals([stage]);

      expect(reconciled.totalUnallocated.toString()).toBe('50.55');
      expect(reconciled.categoryTotal.plus(reconciled.totalUnallocated).equals(reconciled.subtotal)).toBe(
        true
      );
      expect(reconciled.accountedTotal.equals(reconciled.subtotal)).toBe(true);
      expect(reconciled.roundingDiscrepancy.toString()).toBe('0');
      expect(reconciled.isTotalsExact).toBe(true);
      expect(reconciled.isReconciled).toBe(false);
    });
  });

  describe('Totais e BDI', () => {
    it('consolida subtotais e BDI sem divergência de centavos', () => {
      const stage = calculateStage({
        id: 'bdi-stage',
        items: [
          {
            itemId: 'bdi-1',
            quantity: '10',
            compositionCost: unitCost('4', '3', '2', '1'),
            bdiRate: '10',
          },
          {
            itemId: 'bdi-2',
            quantity: '10',
            compositionCost: unitCost('10', '5', '3', '2'),
            bdiRate: '20',
          },
        ],
      });

      const totals = calculateBudgetTotals([stage]);

      // item 1: 100 direto -> 110 com BDI
      // item 2: 200 direto -> 240 com BDI
      expect(totals.subtotal.toString()).toBe('300');
      expect(totals.subtotalWithBdi.toString()).toBe('350');
      expect(totals.totalBdiAmount.toString()).toBe('50');
      expect(totals.effectiveBdiRate.toString()).toBe('16.6667');

      const reconciled = reconcileBudgetTotals([stage]);
      expect(reconciled.subtotalWithBdi.toString()).toBe(totals.subtotalWithBdi.toString());
      expect(
        reconciled.subtotalWithBdi.minus(reconciled.subtotal).equals(reconciled.totalBdiAmount)
      ).toBe(true);
      expect(reconciled.totalBdiAmount.equals(toDecimal('50'))).toBe(true);
    });

    it('não divide por zero quando o subtotal é zero', () => {
      const stage = calculateStage({
        id: 'zero',
        items: [
          {
            itemId: 'zero-item',
            quantity: '0',
            compositionCost: unitCost('100', '100', '100', '100'),
            bdiRate: '25',
          },
        ],
      });

      const totals = calculateBudgetTotals([stage]);
      expect(totals.subtotal.toString()).toBe('0');
      expect(totals.subtotalWithBdi.toString()).toBe('0');
      expect(totals.totalBdiAmount.toString()).toBe('0');
      expect(totals.effectiveBdiRate.toString()).toBe('0');
    });

    it('produz totais idênticos em execuções repetidas', () => {
      const buildStage = (): StageInput => ({
        id: 'repetivel',
        items: [
          {
            itemId: 'r1',
            quantity: '1.2345',
            compositionCost: unitCost('0.3333', '1.7777', '2.9999', '0.0001'),
            bdiRate: '13.579',
          },
        ],
        childStages: [
          {
            id: 'repetivel-child',
            items: [
              {
                itemId: 'r2',
                quantity: '9.8765',
                compositionCost: unitCost('10.1111', '20.2222', '0.0003', '4.4444'),
                bdiRate: '27.1234',
              },
            ],
          },
        ],
      });

      const snapshot = () => {
        const reconciled = reconcileBudgetTotals([calculateStage(buildStage())]);
        return JSON.stringify({
          subtotal: reconciled.subtotal.toString(),
          subtotalWithBdi: reconciled.subtotalWithBdi.toString(),
          material: reconciled.totalMaterial.toString(),
          labor: reconciled.totalLabor.toString(),
          equipment: reconciled.totalEquipment.toString(),
          other: reconciled.totalOther.toString(),
          unallocated: reconciled.totalUnallocated.toString(),
          categoryTotal: reconciled.categoryTotal.toString(),
          discrepancy: reconciled.roundingDiscrepancy.toString(),
        });
      };

      const expected = snapshot();
      for (let i = 0; i < 50; i++) {
        expect(snapshot()).toBe(expected);
      }
    });
  });
});
