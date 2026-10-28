import { describe, expect, it } from 'vitest';
import {
  calculateCompositionCost,
  CircularCompositionError,
  CompositionInput,
  createUnitConverter,
  defaultUnitConverter,
  InvalidClosedCompositionError,
  InvalidCompositionError,
  InvalidPercentageError,
  normalizeCostBreakdown,
  ResourceInput,
  toDecimal,
  UnresolvedComponentError,
  UnitConversionError,
} from '../index';

function resource(overrides: Partial<ResourceInput> & Pick<ResourceInput, 'id' | 'category'>): ResourceInput {
  return {
    code: overrides.code ?? overrides.id,
    description: overrides.description ?? `Insumo ${overrides.id}`,
    unit: overrides.unit ?? 'un',
    price: overrides.price ?? '1.00',
    laborChargesIncluded: overrides.laborChargesIncluded ?? true,
    ...overrides,
  };
}

function analytical(
  id: string,
  components: CompositionInput['components'],
  unit = 'un'
): CompositionInput {
  return {
    id,
    code: id.toUpperCase(),
    description: `Composição ${id}`,
    unit,
    type: 'ANALYTICAL',
    components,
  };
}

describe('Etapa 4 - Cálculo recursivo de composições', () => {
  describe('Composição auxiliar', () => {
    it('resolve subcomposição inline e propaga categorias proporcionalmente', () => {
      const sub = analytical(
        'argamassa',
        [
          {
            coefficient: '400',
            resource: resource({ id: 'cimento', category: 'MATERIAL', unit: 'kg', price: '0.65' }),
          },
          {
            coefficient: '5',
            resource: resource({ id: 'servente', category: 'LABOR', unit: 'h', price: '20' }),
          },
        ],
        'm3'
      );

      const main = analytical(
        'alvenaria',
        [{ coefficient: '0.05', childComposition: sub }],
        'm2'
      );

      const result = calculateCompositionCost(main);

      expect(result.unitCost.material.toString()).toBe('13');
      expect(result.unitCost.labor.toString()).toBe('5');
      expect(result.unitCost.total.toString()).toBe('18');
      expect(result.unitCost.unallocated?.toString()).toBe('0');
      expect(result.breakdownUnavailable).toBe(false);
      expect(result.componentDetails[0].category).toBe('COMPOSITION');
      expect(result.componentDetails[0].costBreakdown?.material.toString()).toBe('13');
      expect(result.componentDetails[0].costBreakdown?.total.toString()).toBe('18');
    });

    it('resolve subcomposição por childCompositionId em catálogo, inclusive aninhada em 3 níveis', () => {
      const leaf = analytical(
        'leaf',
        [
          {
            coefficient: '2',
            resource: resource({ id: 'mat', category: 'MATERIAL', unit: 'kg', price: '10' }),
          },
          {
            coefficient: '1',
            resource: resource({ id: 'lab', category: 'LABOR', unit: 'h', price: '30' }),
          },
        ],
        'kg'
      );

      const middle = analytical(
        'middle',
        [
          { coefficient: '2', childCompositionId: 'leaf' },
          {
            coefficient: '1',
            resource: resource({ id: 'mat2', category: 'MATERIAL', price: '5' }),
          },
        ]
      );

      const root = analytical(
        'root',
        [
          { coefficient: '0.5', childCompositionId: 'middle' },
          {
            coefficient: '1',
            resource: resource({ id: 'equip', category: 'EQUIPMENT', price: '7' }),
          },
        ]
      );

      const catalog = new Map<string, CompositionInput>([
        ['leaf', leaf],
        ['middle', middle],
        ['root', root],
      ]);

      const result = calculateCompositionCost(root, { compositions: catalog });

      // leaf: mat 20 + lab 30 = 50
      // middle: 2 * 50 (mat 40 + lab 60) + mat 5 = 105 (mat 45, lab 60)
      // root: 0.5 * 105 (mat 22.5, lab 30) + equip 7 = 59.5
      expect(result.unitCost.material.toString()).toBe('22.5');
      expect(result.unitCost.labor.toString()).toBe('30');
      expect(result.unitCost.equipment.toString()).toBe('7');
      expect(result.unitCost.other.toString()).toBe('0');
      expect(result.unitCost.total.toString()).toBe('59.5');
      expect(result.componentDetails).toHaveLength(2);
    });

    it('reaproveita subcomposição repetida via memoização determinística', () => {
      let evaluations = 0;
      const sub = {
        ...analytical(
          'shared',
          [
            {
              coefficient: '1',
              resource: resource({ id: 'm', category: 'MATERIAL', price: '10' }),
            },
          ]
        ),
        get type() {
          evaluations += 1;
          return 'ANALYTICAL' as const;
        },
      } satisfies CompositionInput;

      const root = analytical('root-memo', [
        { coefficient: '1', childCompositionId: 'shared' },
        { coefficient: '2', childCompositionId: 'shared' },
      ]);

      const result = calculateCompositionCost(root, {
        compositions: new Map([['shared', sub]]),
      });

      expect(evaluations).toBe(1);
      expect(result.unitCost.material.toString()).toBe('30');
    });

    it('propaga resíduo de arredondamento das categorias sem perder o fechamento do detalhe', () => {
      const sub = analytical(
        'sub-redondo',
        [
          {
            coefficient: '1',
            resource: resource({ id: 'm', category: 'MATERIAL', price: '1' }),
          },
          {
            coefficient: '1',
            resource: resource({ id: 'l', category: 'LABOR', price: '1' }),
          },
          {
            coefficient: '1',
            resource: resource({ id: 'e', category: 'EQUIPMENT', price: '1' }),
          },
        ]
      );

      const root = analytical('root-redondo', [
        { coefficient: '0.333', childComposition: sub },
      ]);

      const result = calculateCompositionCost(root);
      const detail = result.componentDetails[0];

      // 0,333 × 1,00 = 0,33 em cada categoria; total da linha = 0,99.
      expect(detail.costBreakdown?.material.toString()).toBe('0.33');
      expect(detail.costBreakdown?.labor.toString()).toBe('0.33');
      expect(detail.costBreakdown?.equipment.toString()).toBe('0.33');
      expect(detail.totalPrice.toString()).toBe('0.99');
      expect(result.unitCost.total.toString()).toBe('0.99');
      expect(
        result.unitCost.total.minus(
          result.unitCost.material
            .plus(result.unitCost.labor)
            .plus(result.unitCost.equipment)
            .plus(result.unitCost.other)
            .plus(result.unitCost.unallocated ?? 0)
        ).isZero()
      ).toBe(true);
    });
  });

  describe('Dependências circulares', () => {
    it('detecta ciclo entre composições resolvidas por catálogo', () => {
      const a = analytical('A', [{ coefficient: '1', childCompositionId: 'B' }]);
      const b = analytical('B', [{ coefficient: '1', childCompositionId: 'A' }]);

      try {
        calculateCompositionCost(a, {
          compositions: new Map([
            ['A', a],
            ['B', b],
          ]),
        });
        throw new Error('Deveria ter lançado CircularCompositionError');
      } catch (error) {
        expect(error).toBeInstanceOf(CircularCompositionError);
        expect((error as CircularCompositionError).cycle).toEqual(['A', 'B', 'A']);
        expect((error as Error).message).toContain('A -> B -> A');
      }
    });

    it('detecta auto-dependência', () => {
      const self = analytical('self', [{ coefficient: '1', childCompositionId: 'self' }]);
      expect(() =>
        calculateCompositionCost(self, {
          compositions: new Map([['self', self]]),
        })
      ).toThrow(CircularCompositionError);
    });

    it('detecta ciclo com composições inline', () => {
      const a = analytical('inline-a', []);
      const b = analytical('inline-b', [{ coefficient: '1', childComposition: a }]);
      a.components.push({ coefficient: '1', childComposition: b });

      expect(() => calculateCompositionCost(a)).toThrow(CircularCompositionError);
    });
  });

  describe('Composições fechadas', () => {
    it('preserva o total e sinaliza ausência de desdobramento sem inventar categorias', () => {
      const closed: CompositionInput = {
        id: 'closed-sem-categorias',
        code: 'COT-1',
        description: 'Subestação fornecida por terceiro',
        unit: 'un',
        type: 'CLOSED',
        closedTotalPrice: '150000.00',
        components: [],
      };

      const result = calculateCompositionCost(closed);

      expect(result.unitCost.total.toString()).toBe('150000');
      expect(result.unitCost.material.toString()).toBe('0');
      expect(result.unitCost.labor.toString()).toBe('0');
      expect(result.unitCost.unallocated?.toString()).toBe('150000');
      expect(result.breakdownUnavailable).toBe(true);
      expect(result.componentDetails).toHaveLength(0);
    });

    it('mantém desdobramento quando as parcelas fecham exatamente com o total', () => {
      const closed: CompositionInput = {
        id: 'closed-completa',
        code: 'COT-2',
        description: 'Serviço com parcelas informadas',
        unit: 'un',
        type: 'CLOSED',
        closedTotalPrice: '1000.00',
        closedMaterialPrice: '400.00',
        closedLaborPrice: '300.00',
        closedEquipmentPrice: '200.00',
        closedOtherPrice: '100.00',
        components: [],
      };

      const result = calculateCompositionCost(closed);

      expect(result.unitCost.total.toString()).toBe('1000');
      expect(result.unitCost.material.toString()).toBe('400');
      expect(result.unitCost.labor.toString()).toBe('300');
      expect(result.unitCost.equipment.toString()).toBe('200');
      expect(result.unitCost.other.toString()).toBe('100');
      expect(result.unitCost.unallocated?.toString()).toBe('0');
      expect(result.breakdownUnavailable).toBe(false);
    });

    it('expõe divergência entre parcelas e total como parcela não desdobrada', () => {
      const closed: CompositionInput = {
        id: 'closed-divergente',
        code: 'COT-3',
        description: 'Parcelas divergentes da fonte',
        unit: 'un',
        type: 'CLOSED',
        closedTotalPrice: '100.00',
        closedMaterialPrice: '60.00',
        closedLaborPrice: '30.00',
        components: [],
      };

      const result = calculateCompositionCost(closed);

      expect(result.unitCost.total.toString()).toBe('100');
      expect(result.unitCost.material.toString()).toBe('60');
      expect(result.unitCost.labor.toString()).toBe('30');
      expect(result.unitCost.unallocated?.toString()).toBe('10');
      expect(result.breakdownUnavailable).toBe(true);
    });

    it('rejeita composição fechada sem total e sem parcelas', () => {
      expect(() =>
        calculateCompositionCost({
          id: 'closed-vazia',
          code: 'COT-4',
          description: 'Sem dados',
          unit: 'un',
          type: 'CLOSED',
          components: [],
        })
      ).toThrow(InvalidClosedCompositionError);
    });

    it('propaga parcela fechada não desdobrada para a composição pai', () => {
      const closed: CompositionInput = {
        id: 'closed-filha',
        code: 'COT-5',
        description: 'Equipamento fechado',
        unit: 'un',
        type: 'CLOSED',
        closedTotalPrice: '50.00',
        components: [],
      };

      const parent = analytical('parent-closed', [
        { coefficient: '2', childComposition: closed },
      ]);

      const result = calculateCompositionCost(parent);
      expect(result.unitCost.total.toString()).toBe('100');
      expect(result.unitCost.unallocated?.toString()).toBe('100');
      expect(result.breakdownUnavailable).toBe(true);
      expect(result.componentDetails[0].costBreakdown?.unallocated.toString()).toBe('100');
      expect(result.componentDetails[0].totalPrice.toString()).toBe('100');
    });
  });

  describe('Encargos sociais', () => {
    it('aplica encargos quando não estão inclusos no preço base', () => {
      const comp = analytical('encargos', [
        {
          coefficient: '1',
          resource: resource({
            id: 'pedreiro',
            category: 'LABOR',
            unit: 'h',
            price: '10',
            laborChargesIncluded: false,
            laborChargesRate: '80',
          }),
        },
      ]);

      const result = calculateCompositionCost(comp);
      expect(result.unitCost.labor.toString()).toBe('18');
      expect(result.componentDetails[0].unitPrice.toString()).toBe('18');
      expect(result.componentDetails[0].laborChargesRate?.toString()).toBe('80');
      expect(result.componentDetails[0].laborChargesAmount?.toString()).toBe('8');
    });

    it('não aplica encargos duas vezes quando já estão inclusos', () => {
      const comp = analytical('encargos-inclusos', [
        {
          coefficient: '1',
          resource: resource({
            id: 'pedreiro-incluso',
            category: 'LABOR',
            unit: 'h',
            price: '20',
            laborChargesIncluded: true,
            laborChargesRate: '100',
          }),
        },
      ]);

      const result = calculateCompositionCost(comp);
      expect(result.unitCost.labor.toString()).toBe('20');
      expect(result.componentDetails[0].laborChargesRate).toBeUndefined();
      expect(result.componentDetails[0].laborChargesAmount).toBeUndefined();
    });

    it('não aplica encargos a materiais e rejeita percentual negativo', () => {
      const material = analytical('encargos-material', [
        {
          coefficient: '1',
          resource: resource({
            id: 'material',
            category: 'MATERIAL',
            price: '10',
            laborChargesIncluded: false,
            laborChargesRate: '80',
          }),
        },
      ]);
      expect(calculateCompositionCost(material).unitCost.material.toString()).toBe('10');

      const invalid = analytical('encargos-invalidos', [
        {
          coefficient: '1',
          resource: resource({
            id: 'pedreiro-invalido',
            category: 'LABOR',
            price: '10',
            laborChargesIncluded: false,
            laborChargesRate: '-1',
          }),
        },
      ]);
      expect(() => calculateCompositionCost(invalid)).toThrow(InvalidPercentageError);
    });
  });

  describe('Conversões de unidade na composição', () => {
    it('converte coeficiente em kg para preço em tonelada', () => {
      const comp = analytical('aco', [
        {
          coefficient: '250',
          unit: 'kg',
          resource: resource({
            id: 'aco-t',
            category: 'MATERIAL',
            unit: 't',
            price: '6000',
          }),
        },
      ]);

      const result = calculateCompositionCost(comp, {
        unitConverter: defaultUnitConverter,
      });

      expect(result.componentDetails[0].coefficient.toString()).toBe('0.25');
      expect(result.componentDetails[0].appliedUnitConversionFactor?.toString()).toBe('0.001');
      expect(result.componentDetails[0].sourceUnit).toBe('kg');
      expect(result.unitCost.material.toString()).toBe('1500');
      expect(result.unitCost.total.toString()).toBe('1500');
    });

    it('converte coeficiente de subcomposição (L para m³)', () => {
      const sub = analytical(
        'sub-m3',
        [
          {
            coefficient: '1',
            resource: resource({ id: 'm3-insumo', category: 'MATERIAL', unit: 'm3', price: '100' }),
          },
        ],
        'm3'
      );

      const root = analytical('root-litro', [
        { coefficient: '500', unit: 'L', childComposition: sub },
      ]);

      const result = calculateCompositionCost(root);
      expect(result.componentDetails[0].coefficient.toString()).toBe('0.5');
      expect(result.componentDetails[0].appliedUnitConversionFactor?.toString()).toBe('0.001');
      expect(result.unitCost.material.toString()).toBe('50');
    });

    it('usa conversor customizado e rejeita unidades incompatíveis', () => {
      const converter = createUnitConverter([{ fromUnit: 'saco', toUnit: 'kg', factor: '50' }]);
      const comp = analytical('saco', [
        {
          coefficient: '2',
          unit: 'saco',
          resource: resource({
            id: 'cimento-kg',
            category: 'MATERIAL',
            unit: 'kg',
            price: '5',
          }),
        },
      ]);

      const result = calculateCompositionCost(comp, { unitConverter: converter });
      expect(result.unitCost.material.toString()).toBe('500');
      expect(result.componentDetails[0].coefficient.toString()).toBe('100');

      const invalid = analytical('incompativel', [
        {
          coefficient: '1',
          unit: 'm',
          resource: resource({
            id: 'kg',
            category: 'MATERIAL',
            unit: 'kg',
            price: '1',
          }),
        },
      ]);
      expect(() => calculateCompositionCost(invalid)).toThrow(UnitConversionError);
    });

    it('aceita fator explícito legado com precedência', () => {
      const comp = analytical('fator-legado', [
        {
          coefficient: '250',
          unit: 'kg',
          unitConversionFactor: '0.001',
          resource: resource({
            id: 'aco-legado',
            category: 'MATERIAL',
            unit: 't',
            price: '6000',
          }),
        },
      ]);

      const result = calculateCompositionCost(comp);
      expect(result.componentDetails[0].coefficient.toString()).toBe('0.25');
      expect(result.unitCost.total.toString()).toBe('1500');
    });
  });

  describe('Validação de componentes', () => {
    it('rejeita componente sem insumo nem composição', () => {
      const comp = analytical('sem-vinculo', [{ coefficient: '1' }]);
      expect(() => calculateCompositionCost(comp)).toThrow(UnresolvedComponentError);
    });

    it('rejeita vínculo simultâneo de insumo e composição', () => {
      const comp = analytical('vinculo-duplo', [
        {
          coefficient: '1',
          resource: resource({ id: 'r', category: 'MATERIAL' }),
          childComposition: analytical('c', []),
        },
      ]);
      expect(() => calculateCompositionCost(comp)).toThrow(InvalidCompositionError);
    });

    it('rejeita ids não encontrados no catálogo', () => {
      const child = analytical('sem-catalogo', [
        { coefficient: '1', childCompositionId: 'inexistente' },
      ]);
      expect(() => calculateCompositionCost(child)).toThrow(UnresolvedComponentError);

      const resourceComp = analytical('sem-insumo', [
        { coefficient: '1', resourceId: 'inexistente' },
      ]);
      expect(() => calculateCompositionCost(resourceComp)).toThrow(
        UnresolvedComponentError
      );
    });
  });

  describe('Invariantes e reprodutibilidade', () => {
    it('mantém total = categorias + não desdobrado e soma dos detalhes = total', () => {
      const comp = analytical(
        'invariantes',
        [
          {
            coefficient: '0.33333',
            resource: resource({ id: 'a', category: 'MATERIAL', price: '14.2857' }),
          },
          {
            coefficient: '1.23456',
            resource: resource({ id: 'b', category: 'LABOR', price: '37.7777' }),
          },
          {
            coefficient: '0.00001',
            resource: resource({ id: 'c', category: 'EQUIPMENT', price: '1234.5678' }),
          },
          {
            coefficient: '9.87654',
            resource: resource({ id: 'd', category: 'OTHER', price: '0.0001' }),
          },
        ],
        'm2'
      );

      const result = calculateCompositionCost(comp);
      const unit = result.unitCost;
      const categoriesAndUnallocated = unit.material
        .plus(unit.labor)
        .plus(unit.equipment)
        .plus(unit.other)
        .plus(unit.unallocated ?? 0);
      const detailsTotal = result.componentDetails.reduce(
        (acc, detail) => acc.plus(detail.totalPrice),
        toDecimal(0)
      );

      expect(unit.total.equals(categoriesAndUnallocated)).toBe(true);
      expect(detailsTotal.equals(unit.total)).toBe(true);

      for (const detail of result.componentDetails) {
        const detailCategories = detail.costBreakdown!;
        expect(
          detailCategories.total.equals(
            detailCategories.material
              .plus(detailCategories.labor)
              .plus(detailCategories.equipment)
              .plus(detailCategories.other)
              .plus(detailCategories.unallocated)
          )
        ).toBe(true);
        expect(detail.totalPrice.equals(detailCategories.total)).toBe(true);
      }
    });

    it('produz resultados idênticos em execuções repetidas', () => {
      const comp = analytical('repetivel', [
        {
          coefficient: '0.33333',
          resource: resource({ id: 'r1', category: 'MATERIAL', price: '14.2857' }),
        },
        {
          coefficient: '1.77777',
          resource: resource({ id: 'r2', category: 'LABOR', price: '3.14159' }),
        },
      ]);

      const snapshot = (input: CompositionInput) => {
        const result = calculateCompositionCost(input);
        return JSON.stringify({
          material: result.unitCost.material.toString(),
          labor: result.unitCost.labor.toString(),
          total: result.unitCost.total.toString(),
          details: result.componentDetails.map((d) => ({
            coefficient: d.coefficient.toString(),
            unitPrice: d.unitPrice.toString(),
            total: d.totalPrice.toString(),
          })),
        });
      };

      const expected = snapshot(comp);
      for (let i = 0; i < 50; i++) {
        expect(snapshot(comp)).toBe(expected);
      }
    });

    it('normaliza desdobramentos legados sem unallocated', () => {
      const normalized = normalizeCostBreakdown({
        material: toDecimal('1'),
        labor: toDecimal('2'),
        equipment: toDecimal('3'),
        other: toDecimal('4'),
        total: toDecimal('20'),
      });

      expect(normalized.unallocated?.toString()).toBe('10');
      expect(normalized.total.toString()).toBe('20');
      expect(normalized.breakdownUnavailable).toBe(true);
    });

    it('trata composição analítica vazia como custo zero determinístico', () => {
      const result = calculateCompositionCost(analytical('vazia', []));
      expect(result.unitCost.total.toString()).toBe('0');
      expect(result.componentDetails).toHaveLength(0);
      expect(result.breakdownUnavailable).toBe(false);
    });
  });
});
