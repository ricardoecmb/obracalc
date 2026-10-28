import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import {
  generateAnalyticalReport,
  generateSyntheticReport,
  generateAbcReport,
  generateBdiMemoryReport,
  type ReportInput,
  type ReportRevisionMetadata,
} from "../report-engine";

// ============================================================================
// FIXTURES
// ============================================================================

const testMetadata: ReportRevisionMetadata = {
  budgetTitle: "Residencial Solar Norte",
  revisionNumber: 1,
  projectName: "Condomínio Solar Norte",
  clientName: "Construtora ABC Ltda.",
  technicalResponsible: "Eng. João da Silva — CREA 123456",
  baseDate: "2024-01-15T00:00:00Z",
  referenceState: "SP",
  referenceMonth: "2024/01",
  referenceTaxRegime: "DESONERADO",
  bdiConfig: {
    name: "BDI Obras Civis DESONERADO",
    bdiRate: "25.0000",
    ac: "0.040000",  // 4%
    cf: "0.010000",  // 1%
    s:  "0.005000",  // 0.5%
    g:  "0.005000",  // 0.5%
    mi: "0.010000",  // 1%
    tm: "0.025000",  // 2.5% ISS
    te: "0.000000",  // 0%
    tf: "0.036500",  // 3.65% PIS+COFINS
    l:  "0.080000",  // 8%
  },
  roundingMode: "ROUND_HALF_UP",
  roundingTotalDecimals: 2,
  snapshotChecksum: "abc123def456",
  finalizedAt: "2024-01-20T14:30:00Z",
};

// Composição analítica: alvenaria de blocos cerâmicos
// Material: 0.025 * 1200 = 30.00
// Labor:    0.800 *   25.50 = 20.40
// Total:    50.40 / m²
//
// Quantidade: 120 m²
// Subtotal: 120 * 50.40 = 6048.00
// BDI (25%): 6048 * 1.25 = 7560.00

const alvenaria = {
  id: "item-alv-1",
  compositionCode: "SINAPI-87266",
  compositionDescription: "Alvenaria de vedação com blocos cerâmicos 9x19x19cm, espessura 9cm",
  unit: "m²",
  compositionType: "ANALYTICAL" as const,
  quantity: "120.0000",
  unitCostMaterial: "30.0000",
  unitCostLabor: "20.4000",
  unitCostEquipment: "0.0000",
  unitCostOther: "0.0000",
  unitCostTotal: "50.4000",
  subtotal: "6048.00",
  bdiRate: "25.0000",
  subtotalWithBdi: "7560.00",
};

// Composição: revestimento de argamassa
// Material: 8.20, Labor: 15.80 → Total: 24.00 / m²
// Quantidade: 80 m²  → Subtotal direto: 1920.00 → c/ BDI(25%): 2400.00
const revestimento = {
  id: "item-rev-1",
  compositionCode: "SINAPI-87479",
  compositionDescription: "Revestimento argamassado interno, espessura 2cm, preparo e aplicação",
  unit: "m²",
  compositionType: "ANALYTICAL" as const,
  quantity: "80.0000",
  unitCostMaterial: "8.2000",
  unitCostLabor: "15.8000",
  unitCostEquipment: "0.0000",
  unitCostOther: "0.0000",
  unitCostTotal: "24.0000",
  subtotal: "1920.00",
  bdiRate: "25.0000",
  subtotalWithBdi: "2400.00",
};

// Composição: concreto usinado (equipamento)
// Material: 320.00, Labor: 45.00, Equipment: 85.00 → Total: 450.00 / m³
// Quantidade: 10 m³ → Subtotal: 4500.00 → c/ BDI(25%): 5625.00
const concreto = {
  id: "item-conc-1",
  compositionCode: "SINAPI-94971",
  compositionDescription: "Concreto usinado fck=25MPa, lançado e adensado em pilares",
  unit: "m³",
  compositionType: "ANALYTICAL" as const,
  quantity: "10.0000",
  unitCostMaterial: "320.0000",
  unitCostLabor: "45.0000",
  unitCostEquipment: "85.0000",
  unitCostOther: "0.0000",
  unitCostTotal: "450.0000",
  subtotal: "4500.00",
  bdiRate: "25.0000",
  subtotalWithBdi: "5625.00",
};

// Estrutura EAP:
// 1 — SERVIÇOS PRELIMINARES
//   1.1 — Alvenaria (alvenaria)
//   1.2 — Revestimentos (revestimento)
// 2 — ESTRUTURAS
//   (concreto)

const testInput: ReportInput = {
  metadata: testMetadata,
  stages: [
    {
      id: "stage-1",
      code: "1",
      title: "SERVIÇOS DE VEDAÇÃO",
      parentStageId: null,
      sortOrder: 1,
      items: [],
    },
    {
      id: "stage-1-1",
      code: "1.1",
      title: "Alvenaria",
      parentStageId: "stage-1",
      sortOrder: 1,
      items: [alvenaria],
    },
    {
      id: "stage-1-2",
      code: "1.2",
      title: "Revestimentos",
      parentStageId: "stage-1",
      sortOrder: 2,
      items: [revestimento],
    },
    {
      id: "stage-2",
      code: "2",
      title: "ESTRUTURAS DE CONCRETO",
      parentStageId: null,
      sortOrder: 2,
      items: [concreto],
    },
  ],
};

// ============================================================================
// TESTES — RELATÓRIO ANALÍTICO
// ============================================================================

describe("Motor de Relatórios — Analítico", () => {
  it("deve calcular totais globais corretos: direto, BDI e com BDI", () => {
    const report = generateAnalyticalReport(testInput);

    // Total direto = 6048 + 1920 + 4500 = 12468.00
    expect(report.totals.direct.toNumber()).toBe(12468);

    // Total c/ BDI = 7560 + 2400 + 5625 = 15585.00
    expect(report.totals.withBdi.toNumber()).toBe(15585);

    // BDI Amount = 15585 - 12468 = 3117.00
    expect(report.totals.bdiAmount.toNumber()).toBe(3117);

    // BDI Efetivo = 3117 / 12468 * 100 ≈ 24.998...% ≈ 25%
    const eff = report.totals.effectiveBdi;
    expect(eff.minus(25).abs().lte(0.01)).toBe(true);
  });

  it("deve decompor corretamente material, M.O. e equipamento", () => {
    const report = generateAnalyticalReport(testInput);
    const totals = report.totals;

    // Material = 30*120 + 8.20*80 + 320*10 = 3600 + 656 + 3200 = 7456
    expect(totals.material.toNumber()).toBe(7456);

    // Labor = 20.40*120 + 15.80*80 + 45*10 = 2448 + 1264 + 450 = 4162
    expect(totals.labor.toNumber()).toBe(4162);

    // Equipment = 85*10 = 850
    expect(totals.equipment.toNumber()).toBe(850);

    // Other = 0
    expect(totals.other.toNumber()).toBe(0);

    // Reconciliação: Material + Labor + Equip + Other deve = Direct
    const sum = totals.material.plus(totals.labor).plus(totals.equipment).plus(totals.other);
    expect(sum.toNumber()).toBe(12468);
  });

  it("deve construir árvore hierárquica correta (2 raízes, subetapas)", () => {
    const report = generateAnalyticalReport(testInput);

    expect(report.rootStages.length).toBe(2);
    const stage1 = report.rootStages.find((s) => s.code === "1")!;
    expect(stage1.childStages.length).toBe(2);
    expect(stage1.items.length).toBe(0); // Sem itens diretos na etapa raiz 1

    // Etapa 2 tem item direto
    const stage2 = report.rootStages.find((s) => s.code === "2")!;
    expect(stage2.items.length).toBe(1);
    expect(stage2.items[0].compositionCode).toBe("SINAPI-94971");
  });

  it("deve calcular subtotais agregados das etapas incluindo subetapas", () => {
    const report = generateAnalyticalReport(testInput);

    const stage1 = report.rootStages.find((s) => s.code === "1")!;
    // Etapa 1: soma de 1.1 (7560) + 1.2 (2400) = 9960 c/ BDI
    expect(stage1.subtotalWithBdi.toNumber()).toBe(9960);
    // Direto: 6048 + 1920 = 7968
    expect(stage1.subtotalDirect.toNumber()).toBe(7968);

    const stage2 = report.rootStages.find((s) => s.code === "2")!;
    // Etapa 2: 5625 c/ BDI
    expect(stage2.subtotalWithBdi.toNumber()).toBe(5625);
  });

  it("deve calcular pesos relativos corretos (% no orçamento)", () => {
    const report = generateAnalyticalReport(testInput);

    const stage1 = report.rootStages.find((s) => s.code === "1")!;
    const stage2 = report.rootStages.find((s) => s.code === "2")!;

    // Peso da Etapa 1 = 9960 / 15585 * 100 ≈ 63.91%
    const pct1Expected = new Decimal(9960).dividedBy(15585).times(100);
    expect(stage1.weightInBudget.minus(pct1Expected).abs().lte(0.01)).toBe(true);

    // Peso da Etapa 2 = 5625 / 15585 * 100 ≈ 36.09%
    const pct2Expected = new Decimal(5625).dividedBy(15585).times(100);
    expect(stage2.weightInBudget.minus(pct2Expected).abs().lte(0.01)).toBe(true);

    // Soma dos pesos deve ser 100%
    expect(stage1.weightInBudget.plus(stage2.weightInBudget).minus(100).abs().lte(0.01)).toBe(true);
  });
});

// ============================================================================
// TESTES — RELATÓRIO SINTÉTICO
// ============================================================================

describe("Motor de Relatórios — Sintético", () => {
  it("deve gerar 2 linhas de etapas de 1º nível apenas (sem subetapas)", () => {
    const report = generateSyntheticReport(testInput);
    expect(report.stages.length).toBe(2);
  });

  it("deve calcular totais sintéticos corretos", () => {
    const report = generateSyntheticReport(testInput);

    // Etapa 1 agregada: 7968 direto, 9960 c/ BDI
    const s1 = report.stages.find((s) => s.code === "1")!;
    expect(s1.subtotalDirect.toNumber()).toBe(7968);
    expect(s1.subtotalWithBdi.toNumber()).toBe(9960);

    // Etapa 2: 4500 direto, 5625 c/ BDI
    const s2 = report.stages.find((s) => s.code === "2")!;
    expect(s2.subtotalDirect.toNumber()).toBe(4500);
    expect(s2.subtotalWithBdi.toNumber()).toBe(5625);

    // Totais globais
    expect(report.totals.direct.toNumber()).toBe(12468);
    expect(report.totals.withBdi.toNumber()).toBe(15585);
  });
});

// ============================================================================
// TESTES — CURVA ABC
// ============================================================================

describe("Motor de Relatórios — Curva ABC", () => {
  it("deve ordenar itens por valor decrescente (maior impacto primeiro)", () => {
    const report = generateAbcReport(testInput);

    // Concreto: 5625 > Alvenaria: 7560 — espera-se alvenaria (7560) > concreto (5625) > revestimento (2400)
    expect(report.items[0].compositionCode).toBe("SINAPI-87266"); // alvenaria = 7560
    expect(report.items[1].compositionCode).toBe("SINAPI-94971"); // concreto = 5625
    expect(report.items[2].compositionCode).toBe("SINAPI-87479"); // revestimento = 2400
  });

  it("deve ter rank sequencial a partir de 1", () => {
    const report = generateAbcReport(testInput);
    report.items.forEach((it, idx) => {
      expect(it.rank).toBe(idx + 1);
    });
  });

  it("deve calcular percentual acumulado corretamente", () => {
    const report = generateAbcReport(testInput);
    const total = 15585;

    // Item 1 (alvenaria = 7560): % individual = 7560/15585*100 ≈ 48.51%
    const pct1 = new Decimal(7560).dividedBy(total).times(100);
    expect(report.items[0].percentageIndividual.minus(pct1).abs().lte(0.01)).toBe(true);

    // Item 3 (revestimento): % acumulado deve ser ≈ 100%
    const lastCum = report.items[report.items.length - 1].percentageCumulative;
    expect(lastCum.minus(100).abs().lte(0.01)).toBe(true);
  });

  it("deve classificar pelo acumulado incluindo o item e respeitar o limite de 80%", () => {
    const report = generateAbcReport(testInput);

    // Com 3 itens e totais: 7560, 5625, 2400 (total 15585):
    // Acumulado após item 1 = 7560/15585 ≈ 48.5% → Classe A
    // Acumulado após item 2 = 13185/15585 ≈ 84.6% → Classe C (> 80%)
    // Acumulado após item 3 = 15585/15585 = 100% → Classe C
    expect(report.items.map((it) => it.abcClass)).toEqual(["A", "C", "C"]);

    expect(report.totals.countA).toBe(1);
    expect(report.totals.countB).toBe(0);
    expect(report.totals.countC).toBe(2);
  });

  it("deve preencher as faixas A, B e C quando o acumulado passa por 50% e 80%", () => {
    const input: ReportInput = {
      ...testInput,
      stages: testInput.stages.map((stage) =>
        stage.id === "stage-2"
          ? {
              ...stage,
              items: [
                concreto,
                {
                  ...concreto,
                  id: "item-extra-1",
                  compositionCode: "EXTRA-1",
                  compositionDescription: "Item adicional para completar a faixa B",
                  subtotalWithBdi: "4415.00",
                },
              ],
            }
          : stage
      ),
    };

    const report = generateAbcReport(input);

    // Total = 7560 + 5625 + 4415 + 2400 = 20000
    // Acumulados: 37,8% (A), 65,9% (B), 88,0% (C), 100% (C)
    expect(report.items.map((it) => it.abcClass)).toEqual(["A", "B", "C", "C"]);
    expect(report.totals.countA).toBe(1);
    expect(report.totals.countB).toBe(1);
    expect(report.totals.countC).toBe(2);
  });
});

// ============================================================================
// TESTES — MEMÓRIA DE BDI (ACÓRDÃO TCU 2622/2013)
// ============================================================================

describe("Motor de Relatórios — Memória de BDI (TCU)", () => {
  it("deve calcular BDI pela fórmula canônica do Acórdão TCU 2622/2013", () => {
    const report = generateBdiMemoryReport(testInput);

    // Numerador = 1 + 0.04 + 0.005 + 0.005 + 0.01 + 0.01 = 1.070
    expect(report.numerator.numeratorSubtotal.toNumber()).toBeCloseTo(1.070, 5);

    // Denominador = 1 - 0.025 - 0 - 0.0365 - 0.08 = 0.8585
    expect(report.denominator.denominatorSubtotal.toNumber()).toBeCloseTo(0.8585, 4);

    // BDI = (1.070 / 0.8585 - 1) * 100 ≈ 24.636%
    const expectedBdi = (1.070 / 0.8585 - 1) * 100;
    expect(report.calculatedBdiRate.toNumber()).toBeCloseTo(expectedBdi, 2);
  });

  it("deve detectar inconsistência quando BDI armazenado difere do calculado por mais de 0.01%", () => {
    const report = generateBdiMemoryReport(testInput);

    // BDI armazenado é 25.0000, calculado ≈ 24.636%, diferença ≈ 0.364%
    // Portanto deve sinalizar inconsistência (discrepância > 0.01%)
    expect(report.discrepancy.gt(new Decimal("0.01"))).toBe(true);
    expect(report.isConsistent).toBe(false);
  });

  it("deve retornar todas as parcelas do BDI com valores corretos", () => {
    const report = generateBdiMemoryReport(testInput);

    expect(report.numerator.ac.value.toNumber()).toBe(0.04);
    expect(report.numerator.s.value.toNumber()).toBe(0.005);
    expect(report.numerator.g.value.toNumber()).toBe(0.005);
    expect(report.numerator.cf.value.toNumber()).toBe(0.01);
    expect(report.denominator.tm.value.toNumber()).toBe(0.025);
    expect(report.denominator.tf.value.toNumber()).toBe(0.0365);
    expect(report.denominator.l.value.toNumber()).toBe(0.08);
  });

  it("deve marcar como consistente quando BDI armazenado coincide com calculado dentro de 0.01%", () => {
    // Criar input com BDI configurado ≈ calculado
    const calculatedRate = (1.070 / 0.8585 - 1) * 100;
    const consistentInput: ReportInput = {
      ...testInput,
      metadata: {
        ...testMetadata,
        bdiConfig: {
          ...testMetadata.bdiConfig!,
          bdiRate: calculatedRate.toFixed(4),
        },
      },
    };

    const report = generateBdiMemoryReport(consistentInput);
    expect(report.isConsistent).toBe(true);
    expect(report.discrepancy.lt(new Decimal("0.01"))).toBe(true);
  });

  it("deve retornar BDI zero e consistente quando não há bdiConfig configurado", () => {
    const noConfigInput: ReportInput = {
      ...testInput,
      metadata: { ...testMetadata, bdiConfig: null },
    };

    const report = generateBdiMemoryReport(noConfigInput);
    expect(report.calculatedBdiRate.toNumber()).toBe(0);
    expect(report.isConsistent).toBe(true);
  });
});
