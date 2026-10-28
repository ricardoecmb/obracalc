/**
 * Motor de Relatórios Determinístico — ObraCalc
 *
 * Produz as 4 saídas canônicas de um orçamento de obras:
 *
 * 1. Relatório Analítico: EAP hierárquica completa com desdobramento por
 *    categoria (material, mão de obra, equipamento, outros) e BDI item a item.
 *
 * 2. Relatório Sintético: Agregação por etapa de primeiro nível da EAP, exibindo
 *    total direto, BDI efetivo ponderado e total com BDI.
 *
 * 3. Curva ABC: Pareto 80/20 de itens por impacto financeiro (custo com BDI),
 *    classificados em faixa A (0-50%), B (50-80%) e C (80-100%).
 *
 * 4. Memória de BDI: Equação canônica do Acórdão TCU 2622/2013, parcelas
 *    percentuais detalhadas e verificação formal.
 */

import Decimal from "decimal.js";

// ============================================================================
// TIPOS DE ENTRADA
// ============================================================================

export interface ReportBudgetItem {
  id: string;
  compositionCode: string;
  compositionDescription: string;
  unit: string;
  compositionType: "ANALYTICAL" | "CLOSED";
  quantity: string | number;
  unitCostMaterial: string | number;
  unitCostLabor: string | number;
  unitCostEquipment: string | number;
  unitCostOther: string | number;
  unitCostTotal: string | number;
  subtotal: string | number;
  bdiRate: string | number;
  subtotalWithBdi: string | number;
  notes?: string | null;
  /** BDI diferenciado — nome da configuração usada */
  bdiConfigName?: string | null;
}

export interface ReportStage {
  id: string;
  code: string;
  title: string;
  parentStageId: string | null;
  sortOrder: number;
  items: ReportBudgetItem[];
}

export interface ReportBdiConfig {
  name: string;
  bdiRate: string | number; // percentual, ex: "25.0000"
  ac: string | number; // Administração Central
  cf: string | number; // Custo Financeiro
  s: string | number;  // Seguros
  g: string | number;  // Garantias
  mi: string | number; // Margem de Incerteza / Risco
  tm: string | number; // Tributos Municipais (ISS)
  te: string | number; // Tributos Estaduais
  tf: string | number; // Tributos Federais (PIS, COFINS, CSLL, IR)
  l: string | number;  // Lucratividade
}

export interface ReportRevisionMetadata {
  budgetTitle: string;
  revisionNumber: number;
  projectName: string;
  clientName: string | null;
  technicalResponsible: string | null;
  baseDate: string | null;
  referenceState: string | null;
  referenceMonth: string | null;
  referenceTaxRegime: string | null;
  bdiConfig: ReportBdiConfig | null;
  roundingMode: string;
  roundingTotalDecimals: number;
  snapshotChecksum: string | null;
  finalizedAt: string | null;
}

export interface ReportResourceLineInput {
  code: string;
  description: string;
  unit: string;
  category: string;
  /** Consumo acumulado por unidade do item. */
  coefficient: string | number;
  price: string | number;
  /** Quantidade consumida já multiplicada pela quantidade do item. */
  quantity: string | number;
  /** Valor total consumido. */
  total: string | number;
  synthetic?: boolean;
  compositionCode?: string | null;
}

export interface ReportAuditFindingInput {
  type: string;
  severity: "ERROR" | "WARNING" | "INFO";
  code: string;
  message: string;
  entityType?: string | null;
  entityId?: string | null;
  field?: string | null;
  justification?: string | null;
  resolvedAt?: string | null;
}

export interface ReportExpectedTotals {
  direct: string | number;
  withBdi: string | number;
}

export interface ReportInput {
  metadata: ReportRevisionMetadata;
  stages: ReportStage[];
  /** Linhas de insumos já expandidas (snapshot v2 ou banco no rascunho). */
  resources?: ReportResourceLineInput[];
  /** Achados de auditoria (snapshot v2 ou tabela de auditoria no rascunho). */
  auditFindings?: ReportAuditFindingInput[];
  /** Totais da fonte selecionada, usados para reconciliar a exportação. */
  expectedTotals?: ReportExpectedTotals;
}

// ============================================================================
// TIPOS DE SAÍDA — RELATÓRIO ANALÍTICO
// ============================================================================

export interface AnalyticalItem {
  compositionCode: string;
  compositionDescription: string;
  unit: string;
  quantity: Decimal;
  unitCostMaterial: Decimal;
  unitCostLabor: Decimal;
  unitCostEquipment: Decimal;
  unitCostOther: Decimal;
  unitCostTotal: Decimal;
  subtotal: Decimal;
  bdiRate: Decimal;
  subtotalWithBdi: Decimal;
  weightInStage: Decimal;       // % do total com BDI da etapa
  weightInBudget: Decimal;      // % do total com BDI do orçamento
  bdiConfigName: string | null;
}

export interface AnalyticalStage {
  id: string;
  code: string;
  title: string;
  depth: number;
  items: AnalyticalItem[];
  childStages: AnalyticalStage[];
  subtotalDirect: Decimal;
  subtotalWithBdi: Decimal;
  subtotalMaterial: Decimal;
  subtotalLabor: Decimal;
  subtotalEquipment: Decimal;
  subtotalOther: Decimal;
  bdiEffective: Decimal;         // BDI médio ponderado da etapa (%)
  weightInBudget: Decimal;       // % do total com BDI do orçamento
}

export interface AnalyticalReport {
  metadata: ReportRevisionMetadata;
  rootStages: AnalyticalStage[];
  totals: {
    direct: Decimal;
    withBdi: Decimal;
    bdiAmount: Decimal;
    effectiveBdi: Decimal;
    material: Decimal;
    labor: Decimal;
    equipment: Decimal;
    other: Decimal;
    itemsCount: number;
  };
}

// ============================================================================
// TIPOS DE SAÍDA — RELATÓRIO SINTÉTICO
// ============================================================================

export interface SyntheticStage {
  code: string;
  title: string;
  subtotalDirect: Decimal;
  subtotalWithBdi: Decimal;
  bdiEffective: Decimal;
  weightInBudget: Decimal;
}

export interface SyntheticReport {
  metadata: ReportRevisionMetadata;
  stages: SyntheticStage[];
  totals: {
    direct: Decimal;
    withBdi: Decimal;
    bdiAmount: Decimal;
    effectiveBdi: Decimal;
  };
}

// ============================================================================
// TIPOS DE SAÍDA — CURVA ABC
// ============================================================================

export type AbcClass = "A" | "B" | "C";

export interface AbcItem {
  rank: number;
  compositionCode: string;
  compositionDescription: string;
  unit: string;
  quantity: Decimal;
  unitCostTotal: Decimal;
  bdiRate: Decimal;
  subtotalWithBdi: Decimal;
  cumulativeWithBdi: Decimal;
  percentageIndividual: Decimal;  // % individual do total
  percentageCumulative: Decimal;  // % acumulado do total
  abcClass: AbcClass;
}

export interface AbcReport {
  metadata: ReportRevisionMetadata;
  items: AbcItem[];
  totals: {
    withBdi: Decimal;
    countA: number; percentA: Decimal;
    countB: number; percentB: Decimal;
    countC: number; percentC: Decimal;
  };
}

// ============================================================================
// TIPOS DE SAÍDA — MEMÓRIA DE BDI
// ============================================================================

export interface BdiMemoryLine {
  symbol: string;
  label: string;
  value: Decimal;    // Como decimal (0.04 = 4%)
  percentFormatted: string; // Ex: "4,00%"
}

export interface BdiMemoryReport {
  metadata: ReportRevisionMetadata;
  formula: string;  // Fórmula canônica TCU textual
  numerator: {
    ac: BdiMemoryLine;
    s: BdiMemoryLine;
    r: BdiMemoryLine;
    g: BdiMemoryLine;
    cf: BdiMemoryLine;
    mi: BdiMemoryLine;
    numeratorSubtotal: Decimal;
  };
  denominator: {
    tm: BdiMemoryLine;
    te: BdiMemoryLine;
    tf: BdiMemoryLine;
    l: BdiMemoryLine;
    denominatorSubtotal: Decimal;
  };
  calculatedBdiRate: Decimal;   // BDI (%) resultado calculado
  storedBdiRate: Decimal;       // BDI (%) armazenado na configuração
  discrepancy: Decimal;         // |calculado - armazenado|
  isConsistent: boolean;        // discrepancy < 0.01
}

// ============================================================================
// AUXILIARES INTERNOS
// ============================================================================

function D(v: string | number | Decimal): Decimal {
  if (v instanceof Decimal) return v;
  return new Decimal(String(v));
}

function buildStageTree(
  stages: ReportStage[],
  totalBudgetWithBdi: Decimal,
  depth = 0
): AnalyticalStage[] {
  const rootNodes = stages.filter((s) => s.parentStageId === null);
  // Ordenar por código
  rootNodes.sort((a, b) => a.sortOrder - b.sortOrder);

  return rootNodes.map((st) => buildSingleStageNode(st, stages, totalBudgetWithBdi, depth));
}

function buildSingleStageNode(
  stage: ReportStage,
  allStages: ReportStage[],
  totalBudgetWithBdi: Decimal,
  depth: number,
): AnalyticalStage {
  const children = allStages
    .filter((s) => s.parentStageId === stage.id)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((child) => buildSingleStageNode(child, allStages, totalBudgetWithBdi, depth + 1));

  // Calcular totais diretos dos itens desta etapa
  let stMat = new Decimal(0), stLab = new Decimal(0), stEquip = new Decimal(0), stOth = new Decimal(0);
  let stDirect = new Decimal(0), stWithBdi = new Decimal(0);

  const analyticalItems: AnalyticalItem[] = stage.items.map((it) => {
    const qty = D(it.quantity);
    const uMat = D(it.unitCostMaterial);
    const uLab = D(it.unitCostLabor);
    const uEquip = D(it.unitCostEquipment);
    const uOth = D(it.unitCostOther);
    const uTot = D(it.unitCostTotal);
    const sub = D(it.subtotal);
    const bdi = D(it.bdiRate);
    const subBdi = D(it.subtotalWithBdi);

    stMat = stMat.plus(uMat.times(qty));
    stLab = stLab.plus(uLab.times(qty));
    stEquip = stEquip.plus(uEquip.times(qty));
    stOth = stOth.plus(uOth.times(qty));
    stDirect = stDirect.plus(sub);
    stWithBdi = stWithBdi.plus(subBdi);

    return {
      compositionCode: it.compositionCode,
      compositionDescription: it.compositionDescription,
      unit: it.unit,
      quantity: qty,
      unitCostMaterial: uMat,
      unitCostLabor: uLab,
      unitCostEquipment: uEquip,
      unitCostOther: uOth,
      unitCostTotal: uTot,
      subtotal: sub,
      bdiRate: bdi,
      subtotalWithBdi: subBdi,
      weightInStage: new Decimal(0), // será recalculado pós-agregação
      weightInBudget: totalBudgetWithBdi.gt(0)
        ? subBdi.dividedBy(totalBudgetWithBdi).times(100)
        : new Decimal(0),
      bdiConfigName: it.bdiConfigName ?? null,
    };
  });

  // Agregar subtotais das subetapas filhas
  children.forEach((child) => {
    stMat = stMat.plus(child.subtotalMaterial);
    stLab = stLab.plus(child.subtotalLabor);
    stEquip = stEquip.plus(child.subtotalEquipment);
    stOth = stOth.plus(child.subtotalOther);
    stDirect = stDirect.plus(child.subtotalDirect);
    stWithBdi = stWithBdi.plus(child.subtotalWithBdi);
  });

  // BDI efetivo ponderado da etapa
  const bdiEff = stDirect.gt(0)
    ? stWithBdi.minus(stDirect).dividedBy(stDirect).times(100)
    : new Decimal(0);

  // Pesos intra-etapa para itens diretos
  analyticalItems.forEach((ai) => {
    ai.weightInStage = stWithBdi.gt(0)
      ? ai.subtotalWithBdi.dividedBy(stWithBdi).times(100)
      : new Decimal(0);
  });

  return {
    id: stage.id,
    code: stage.code,
    title: stage.title,
    depth,
    items: analyticalItems,
    childStages: children,
    subtotalDirect: stDirect,
    subtotalWithBdi: stWithBdi,
    subtotalMaterial: stMat,
    subtotalLabor: stLab,
    subtotalEquipment: stEquip,
    subtotalOther: stOth,
    bdiEffective: bdiEff,
    weightInBudget: totalBudgetWithBdi.gt(0)
      ? stWithBdi.dividedBy(totalBudgetWithBdi).times(100)
      : new Decimal(0),
  };
}

// ============================================================================
// GERADOR DE RELATÓRIO ANALÍTICO
// ============================================================================

export function generateAnalyticalReport(input: ReportInput): AnalyticalReport {
  // 1. Calcular total global com BDI para pesos relativos
  let totalWithBdi = new Decimal(0);
  let totalDirect = new Decimal(0);
  let totalMat = new Decimal(0), totalLab = new Decimal(0);
  let totalEquip = new Decimal(0), totalOth = new Decimal(0);
  let itemsCount = 0;

  const flatCount = (stages: ReportStage[]) => {
    stages.forEach((st) => {
      st.items.forEach((it) => {
        totalWithBdi = totalWithBdi.plus(D(it.subtotalWithBdi));
        totalDirect = totalDirect.plus(D(it.subtotal));
        totalMat = totalMat.plus(D(it.unitCostMaterial).times(D(it.quantity)));
        totalLab = totalLab.plus(D(it.unitCostLabor).times(D(it.quantity)));
        totalEquip = totalEquip.plus(D(it.unitCostEquipment).times(D(it.quantity)));
        totalOth = totalOth.plus(D(it.unitCostOther).times(D(it.quantity)));
        itemsCount++;
      });
    });
  };
  flatCount(input.stages);

  // 2. Construir árvore hierárquica com cálculo
  const rootStages = buildStageTree(input.stages, totalWithBdi, 0);

  const bdiAmount = totalWithBdi.minus(totalDirect);
  const effectiveBdi = totalDirect.gt(0)
    ? bdiAmount.dividedBy(totalDirect).times(100)
    : new Decimal(0);

  return {
    metadata: input.metadata,
    rootStages,
    totals: {
      direct: totalDirect,
      withBdi: totalWithBdi,
      bdiAmount,
      effectiveBdi,
      material: totalMat,
      labor: totalLab,
      equipment: totalEquip,
      other: totalOth,
      itemsCount,
    },
  };
}

// ============================================================================
// GERADOR DE RELATÓRIO SINTÉTICO
// ============================================================================

export function generateSyntheticReport(input: ReportInput): SyntheticReport {
  // Total global
  let globalWithBdi = new Decimal(0);
  let globalDirect = new Decimal(0);

  // Coletar acumulados em passe duplo (iteração segura)
  globalWithBdi = new Decimal(0);
  globalDirect = new Decimal(0);

  // 1. Pré-calcular total
  input.stages.forEach((st) => {
    st.items.forEach((it) => {
      globalWithBdi = globalWithBdi.plus(D(it.subtotalWithBdi));
      globalDirect = globalDirect.plus(D(it.subtotal));
    });
  });

  // 2. Construir síntese por raiz
  const roots = input.stages.filter((s) => !s.parentStageId).sort((a, b) => a.sortOrder - b.sortOrder);

  const accumulateStage = (
    rootId: string,
    allStages: ReportStage[],
    stageId: string
  ): { direct: Decimal; withBdi: Decimal } => {
    const stage = allStages.find((s) => s.id === stageId)!;
    let d = new Decimal(0), w = new Decimal(0);
    stage.items.forEach((it) => {
      d = d.plus(D(it.subtotal));
      w = w.plus(D(it.subtotalWithBdi));
    });
    allStages.filter((s) => s.parentStageId === stageId).forEach((child) => {
      const ct = accumulateStage(rootId, allStages, child.id);
      d = d.plus(ct.direct);
      w = w.plus(ct.withBdi);
    });
    return { direct: d, withBdi: w };
  };

  const syntheticStages: SyntheticStage[] = roots.map((root) => {
    const { direct, withBdi } = accumulateStage(root.id, input.stages, root.id);
    const bdiEff = direct.gt(0)
      ? withBdi.minus(direct).dividedBy(direct).times(100)
      : new Decimal(0);
    return {
      code: root.code,
      title: root.title,
      subtotalDirect: direct,
      subtotalWithBdi: withBdi,
      bdiEffective: bdiEff,
      weightInBudget: globalWithBdi.gt(0)
        ? withBdi.dividedBy(globalWithBdi).times(100)
        : new Decimal(0),
    };
  });

  const bdiAmount = globalWithBdi.minus(globalDirect);
  const effectiveBdi = globalDirect.gt(0)
    ? bdiAmount.dividedBy(globalDirect).times(100)
    : new Decimal(0);

  return {
    metadata: input.metadata,
    stages: syntheticStages,
    totals: {
      direct: globalDirect,
      withBdi: globalWithBdi,
      bdiAmount,
      effectiveBdi,
    },
  };
}

// ============================================================================
// GERADOR DE CURVA ABC
// ============================================================================

export function generateAbcReport(input: ReportInput): AbcReport {
  // 1. Coletar todos os itens de todas as etapas (flat)
  interface FlatItem {
    compositionCode: string;
    compositionDescription: string;
    unit: string;
    quantity: Decimal;
    unitCostTotal: Decimal;
    bdiRate: Decimal;
    subtotalWithBdi: Decimal;
  }

  const flat: FlatItem[] = [];

  const collectAll = (stages: ReportStage[]) => {
    stages.forEach((st) => {
      st.items.forEach((it) => {
        flat.push({
          compositionCode: it.compositionCode,
          compositionDescription: it.compositionDescription,
          unit: it.unit,
          quantity: D(it.quantity),
          unitCostTotal: D(it.unitCostTotal),
          bdiRate: D(it.bdiRate),
          subtotalWithBdi: D(it.subtotalWithBdi),
        });
      });
    });
  };
  collectAll(input.stages);

  // 2. Ordenar por subtotalWithBdi descendente (maior impacto primeiro)
  flat.sort((a, b) => b.subtotalWithBdi.minus(a.subtotalWithBdi).toNumber());

  // 3. Calcular total global
  const totalWithBdi = flat.reduce((acc, it) => acc.plus(it.subtotalWithBdi), new Decimal(0));

  // 4. Calcular acumulados e classificação ABC
  let cumulative = new Decimal(0);
  let countA = 0, countB = 0, countC = 0;
  const percentA = new Decimal(50);
  const percentB = new Decimal(80);

  const abcItems: AbcItem[] = flat.map((it, idx) => {
    cumulative = cumulative.plus(it.subtotalWithBdi);
    const pctIndividual = totalWithBdi.gt(0)
      ? it.subtotalWithBdi.dividedBy(totalWithBdi).times(100)
      : new Decimal(0);
    const pctCumulative = totalWithBdi.gt(0)
      ? cumulative.dividedBy(totalWithBdi).times(100)
      : new Decimal(0);

    let abcClass: AbcClass;
    if (pctCumulative.lte(percentA)) {
      abcClass = "A";
      countA++;
    } else if (pctCumulative.lte(percentB)) {
      abcClass = "B";
      countB++;
    } else {
      abcClass = "C";
      countC++;
    }

    return {
      rank: idx + 1,
      compositionCode: it.compositionCode,
      compositionDescription: it.compositionDescription,
      unit: it.unit,
      quantity: it.quantity,
      unitCostTotal: it.unitCostTotal,
      bdiRate: it.bdiRate,
      subtotalWithBdi: it.subtotalWithBdi,
      cumulativeWithBdi: cumulative,
      percentageIndividual: pctIndividual,
      percentageCumulative: pctCumulative,
      abcClass,
    };
  });

  const countTotal = flat.length;

  return {
    metadata: input.metadata,
    items: abcItems,
    totals: {
      withBdi: totalWithBdi,
      countA,
      percentA: countTotal > 0 ? new Decimal(countA).dividedBy(countTotal).times(100) : new Decimal(0),
      countB,
      percentB: countTotal > 0 ? new Decimal(countB).dividedBy(countTotal).times(100) : new Decimal(0),
      countC,
      percentC: countTotal > 0 ? new Decimal(countC).dividedBy(countTotal).times(100) : new Decimal(0),
    },
  };
}

// ============================================================================
// GERADOR DE MEMÓRIA DE BDI (ACÓRDÃO TCU 2622/2013)
// ============================================================================

/**
 * Fórmula canônica do Acórdão TCU 2622/2013:
 *
 *         (1 + AC + S + R + G + CF + MI)
 * BDI = [ -------------------------------- - 1 ] × 100
 *              (1 - TM - TE - TF - L)
 *
 * Onde:
 *   AC  = Administração Central
 *   S   = Seguros
 *   R   = Riscos (aqui tratado como MI - Margem de Incerteza)
 *   G   = Garantias
 *   CF  = Custo Financeiro
 *   MI  = Margem de Incerteza
 *   TM  = Tributos Municipais (ISS)
 *   TE  = Tributos Estaduais
 *   TF  = Tributos Federais (PIS + COFINS + CSLL + IRPJ)
 *   L   = Lucratividade
 */
export function generateBdiMemoryReport(input: ReportInput): BdiMemoryReport {
  const bdi = input.metadata.bdiConfig;

  const FORMULA = `BDI = [(1 + AC + S + G + CF + MI) / (1 - ISS - TE - TF - L) − 1] × 100`;

  if (!bdi) {
    const zero = new Decimal(0);
    const zeroLine = (sym: string, label: string): BdiMemoryLine => ({
      symbol: sym, label, value: zero, percentFormatted: "0,00%",
    });
    return {
      metadata: input.metadata,
      formula: FORMULA,
      numerator: {
        ac: zeroLine("AC", "Administração Central"),
        s: zeroLine("S", "Seguros"),
        r: zeroLine("R", "Riscos"),
        g: zeroLine("G", "Garantias"),
        cf: zeroLine("CF", "Custo Financeiro"),
        mi: zeroLine("MI", "Margem de Incerteza"),
        numeratorSubtotal: zero,
      },
      denominator: {
        tm: zeroLine("ISS", "ISS / Tributos Municipais"),
        te: zeroLine("TE", "Tributos Estaduais"),
        tf: zeroLine("TF", "Tributos Federais"),
        l: zeroLine("L", "Lucratividade"),
        denominatorSubtotal: zero,
      },
      calculatedBdiRate: zero,
      storedBdiRate: zero,
      discrepancy: zero,
      isConsistent: true,
    };
  }

  const fmt = (v: Decimal): string =>
    v.times(100).toFixed(2).replace(".", ",") + "%";

  const makeLine = (sym: string, label: string, raw: string | number): BdiMemoryLine => {
    const val = D(raw);
    return { symbol: sym, label, value: val, percentFormatted: fmt(val) };
  };

  const ac = makeLine("AC", "Administração Central", bdi.ac);
  const s  = makeLine("S",  "Seguros",               bdi.s);
  const g  = makeLine("G",  "Garantias",             bdi.g);
  const cf = makeLine("CF", "Custo Financeiro",      bdi.cf);
  const mi = makeLine("MI", "Margem de Incerteza / Riscos", bdi.mi);
  const r  = makeLine("R",  "Riscos",                bdi.mi); // mesmo campo que MI neste modelo

  const tm = makeLine("ISS", "ISS / Tributos Municipais", bdi.tm);
  const te = makeLine("TE",  "Tributos Estaduais",         bdi.te);
  const tf = makeLine("TF",  "Tributos Federais",           bdi.tf);
  const l  = makeLine("L",   "Lucratividade",               bdi.l);

  // Numerador: (1 + AC + S + G + CF + MI)
  const numeratorSubtotal = new Decimal(1)
    .plus(ac.value)
    .plus(s.value)
    .plus(g.value)
    .plus(cf.value)
    .plus(mi.value);

  // Denominador: (1 - TM - TE - TF - L)
  const denominatorSubtotal = new Decimal(1)
    .minus(tm.value)
    .minus(te.value)
    .minus(tf.value)
    .minus(l.value);

  // BDI = [(numerador / denominador) - 1] × 100
  const calculatedBdiRate = denominatorSubtotal.gt(0)
    ? numeratorSubtotal.dividedBy(denominatorSubtotal).minus(1).times(100)
    : new Decimal(0);

  const storedBdiRate = D(bdi.bdiRate);
  const discrepancy = calculatedBdiRate.minus(storedBdiRate).abs();
  const isConsistent = discrepancy.lt(new Decimal("0.01"));

  return {
    metadata: input.metadata,
    formula: FORMULA,
    numerator: {
      ac, s, r, g, cf, mi,
      numeratorSubtotal,
    },
    denominator: {
      tm, te, tf, l,
      denominatorSubtotal,
    },
    calculatedBdiRate,
    storedBdiRate,
    discrepancy,
    isConsistent,
  };
}

// ============================================================================
// HELPER: Formatar moeda BRL com Decimal.js
// ============================================================================

export function formatDecimalBRL(val: Decimal): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val.toNumber());
}

export function formatDecimalPct(val: Decimal, decimals = 2): string {
  return val.toFixed(decimals).replace(".", ",") + "%";
}

// ============================================================================
// TOTAIS AUXILIARES
// ============================================================================

export interface ReportStageTotals {
  direct: Decimal;
  withBdi: Decimal;
  bdiAmount: Decimal;
  effectiveBdi: Decimal;
  itemsCount: number;
}

/** Soma todos os itens de todas as etapas, sem considerar a hierarquia. */
export function computeStageTotals(stages: ReportStage[]): ReportStageTotals {
  let direct = new Decimal(0);
  let withBdi = new Decimal(0);
  let itemsCount = 0;

  for (const stage of stages) {
    for (const item of stage.items) {
      direct = direct.plus(D(item.subtotal));
      withBdi = withBdi.plus(D(item.subtotalWithBdi));
      itemsCount += 1;
    }
  }

  const bdiAmount = withBdi.minus(direct);
  const effectiveBdi = direct.gt(0)
    ? bdiAmount.dividedBy(direct).times(100)
    : new Decimal(0);

  return { direct, withBdi, bdiAmount, effectiveBdi, itemsCount };
}

// ============================================================================
// TIPOS DE SAÍDA — RELATÓRIO DE INSUMOS
// ============================================================================

export interface ResourceReportLine {
  code: string;
  description: string;
  unit: string;
  category: string;
  quantity: Decimal;
  weightedPrice: Decimal;
  total: Decimal;
  percentage: Decimal;
  synthetic: boolean;
  compositionCode: string | null;
}

export interface ResourceCategoryTotal {
  category: string;
  total: Decimal;
  percentage: Decimal;
}

export interface ResourcesReport {
  metadata: ReportRevisionMetadata;
  lines: ResourceReportLine[];
  categories: ResourceCategoryTotal[];
  totals: {
    direct: Decimal;
    withBdi: Decimal;
    bdiAmount: Decimal;
    effectiveBdi: Decimal;
    resourcesRawTotal: Decimal;
    adjustment: Decimal;
    itemsCount: number;
  };
  reconciliation: {
    reconciled: boolean;
    difference: Decimal;
  };
}

// ============================================================================
// GERADOR DE RELATÓRIO DE INSUMOS
// ============================================================================

export function generateResourcesReport(input: ReportInput): ResourcesReport {
  const stageTotals = computeStageTotals(input.stages);

  interface Group {
    code: string;
    description: string;
    unit: string;
    category: string;
    quantity: Decimal;
    total: Decimal;
    synthetic: boolean;
    compositionCode: string | null;
  }

  const groups = new Map<string, Group>();

  for (const line of input.resources ?? []) {
    const quantity = D(line.quantity);
    const providedTotal = D(line.total);
    const total = providedTotal.isZero() && !quantity.isZero()
      ? quantity.times(D(line.price))
      : providedTotal;
    const synthetic = line.synthetic === true;
    const key = [
      synthetic ? "SYNTHETIC" : "RESOURCE",
      line.code,
      line.unit,
      line.category,
    ].join("::");

    const current = groups.get(key);
    if (current) {
      current.quantity = current.quantity.plus(quantity);
      current.total = current.total.plus(total);
    } else {
      groups.set(key, {
        code: line.code,
        description: line.description,
        unit: line.unit,
        category: line.category,
        quantity,
        total,
        synthetic,
        compositionCode: line.compositionCode ?? null,
      });
    }
  }

  const rawTotal = Array.from(groups.values()).reduce(
    (acc, group) => acc.plus(group.total),
    new Decimal(0)
  );

  // Garante que a soma das linhas de insumos seja exatamente igual ao custo
  // direto da revisão selecionada. A diferença (resíduo de arredondamento das
  // composições) vira uma linha explícita e auditável.
  const adjustment = stageTotals.direct.minus(rawTotal);
  if (!adjustment.isZero()) {
    groups.set("ADJUSTMENT::RECONCILIATION", {
      code: "AJUSTE",
      description: "Ajuste de arredondamento (reconciliação com a planilha)",
      unit: "—",
      category: "OTHER",
      quantity: new Decimal(1),
      total: adjustment,
      synthetic: true,
      compositionCode: null,
    });
  }

  const lines: ResourceReportLine[] = Array.from(groups.values())
    .map((group) => ({
      code: group.code,
      description: group.description,
      unit: group.unit,
      category: group.category,
      quantity: group.quantity,
      weightedPrice: group.quantity.isZero()
        ? new Decimal(0)
        : group.total.dividedBy(group.quantity),
      total: group.total,
      percentage: stageTotals.direct.gt(0)
        ? group.total.dividedBy(stageTotals.direct).times(100)
        : new Decimal(0),
      synthetic: group.synthetic,
      compositionCode: group.compositionCode,
    }))
    .sort((a, b) => {
      const byTotal = b.total.minus(a.total).toNumber();
      if (byTotal !== 0) return byTotal;
      return a.code.localeCompare(b.code, "pt-BR", { numeric: true });
    });

  const categoryMap = new Map<string, Decimal>();
  lines.forEach((line) => {
    categoryMap.set(
      line.category,
      (categoryMap.get(line.category) ?? new Decimal(0)).plus(line.total)
    );
  });

  const categories: ResourceCategoryTotal[] = Array.from(categoryMap.entries())
    .map(([category, total]) => ({
      category,
      total,
      percentage: stageTotals.direct.gt(0)
        ? total.dividedBy(stageTotals.direct).times(100)
        : new Decimal(0),
    }))
    .sort((a, b) => b.total.minus(a.total).toNumber());

  return {
    metadata: input.metadata,
    lines,
    categories,
    totals: {
      direct: stageTotals.direct,
      withBdi: stageTotals.withBdi,
      bdiAmount: stageTotals.bdiAmount,
      effectiveBdi: stageTotals.effectiveBdi,
      resourcesRawTotal: rawTotal,
      adjustment,
      itemsCount: stageTotals.itemsCount,
    },
    reconciliation: {
      reconciled: adjustment.abs().lt(new Decimal("0.01")),
      difference: adjustment,
    },
  };
}

// ============================================================================
// TIPOS DE SAÍDA — RESUMO DE ETAPAS (EAP COMPLETA)
// ============================================================================

export interface StageSummaryRow {
  code: string;
  title: string;
  level: number;
  parentCode: string | null;
  direct: Decimal;
  withBdi: Decimal;
  bdiEffective: Decimal;
  percentage: Decimal;
  itemsCount: number;
}

export interface StageSummaryReport {
  metadata: ReportRevisionMetadata;
  rows: StageSummaryRow[];
  totals: {
    direct: Decimal;
    withBdi: Decimal;
    bdiAmount: Decimal;
    effectiveBdi: Decimal;
    itemsCount: number;
    stagesCount: number;
  };
}

// ============================================================================
// GERADOR DE RESUMO DE ETAPAS
// ============================================================================

export function generateStageSummaryReport(input: ReportInput): StageSummaryReport {
  const totals = computeStageTotals(input.stages);
  const byId = new Map(input.stages.map((stage) => [stage.id, stage]));
  const childMap = new Map<string | null, ReportStage[]>();

  for (const stage of input.stages) {
    const parentId = stage.parentStageId && byId.has(stage.parentStageId)
      ? stage.parentStageId
      : null;
    const list = childMap.get(parentId) ?? [];
    list.push(stage);
    childMap.set(parentId, list);
  }

  childMap.forEach((list) => list.sort((a, b) => a.sortOrder - b.sortOrder));

  const accumulated = new Map<
    string,
    { direct: Decimal; withBdi: Decimal; itemsCount: number }
  >();

  const accumulate = (
    stage: ReportStage,
    visiting: Set<string>
  ): { direct: Decimal; withBdi: Decimal; itemsCount: number } => {
    const cached = accumulated.get(stage.id);
    if (cached) return cached;

    if (visiting.has(stage.id)) {
      return { direct: new Decimal(0), withBdi: new Decimal(0), itemsCount: 0 };
    }
    visiting.add(stage.id);

    let direct = new Decimal(0);
    let withBdi = new Decimal(0);
    let itemsCount = 0;

    for (const item of stage.items) {
      direct = direct.plus(D(item.subtotal));
      withBdi = withBdi.plus(D(item.subtotalWithBdi));
      itemsCount += 1;
    }

    for (const child of childMap.get(stage.id) ?? []) {
      const childTotals = accumulate(child, visiting);
      direct = direct.plus(childTotals.direct);
      withBdi = withBdi.plus(childTotals.withBdi);
      itemsCount += childTotals.itemsCount;
    }

    visiting.delete(stage.id);
    const result = { direct, withBdi, itemsCount };
    accumulated.set(stage.id, result);
    return result;
  };

  const rows: StageSummaryRow[] = [];
  const visited = new Set<string>();

  const visit = (stage: ReportStage, level: number, parentCode: string | null) => {
    if (visited.has(stage.id)) return;
    visited.add(stage.id);

    const stageTotals = accumulate(stage, new Set());
    const bdiEffective = stageTotals.direct.gt(0)
      ? stageTotals.withBdi.minus(stageTotals.direct).dividedBy(stageTotals.direct).times(100)
      : new Decimal(0);

    rows.push({
      code: stage.code,
      title: stage.title,
      level,
      parentCode,
      direct: stageTotals.direct,
      withBdi: stageTotals.withBdi,
      bdiEffective,
      percentage: totals.withBdi.gt(0)
        ? stageTotals.withBdi.dividedBy(totals.withBdi).times(100)
        : new Decimal(0),
      itemsCount: stageTotals.itemsCount,
    });

    for (const child of childMap.get(stage.id) ?? []) {
      visit(child, level + 1, stage.code);
    }
  };

  (childMap.get(null) ?? []).forEach((root) => visit(root, 0, null));

  // Etapas órfãs (dados legados sem hierarquia consistente) não podem sumir.
  input.stages.forEach((stage) => {
    if (!visited.has(stage.id)) visit(stage, 0, null);
  });

  return {
    metadata: input.metadata,
    rows,
    totals: {
      direct: totals.direct,
      withBdi: totals.withBdi,
      bdiAmount: totals.bdiAmount,
      effectiveBdi: totals.effectiveBdi,
      itemsCount: totals.itemsCount,
      stagesCount: input.stages.length,
    },
  };
}

// ============================================================================
// TIPOS DE SAÍDA — RELATÓRIO DE AUDITORIA
// ============================================================================

export interface AuditReportFinding {
  type: string;
  severity: "ERROR" | "WARNING" | "INFO";
  code: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  field: string | null;
  justification: string | null;
  resolvedAt: string | null;
}

export interface AuditReport {
  metadata: ReportRevisionMetadata;
  findings: AuditReportFinding[];
  summary: {
    errors: number;
    warnings: number;
    infos: number;
    total: number;
    blocking: boolean;
  };
  byType: Array<{ type: string; count: number }>;
  totals: {
    direct: Decimal;
    withBdi: Decimal;
    itemsCount: number;
  };
}

// ============================================================================
// GERADOR DE RELATÓRIO DE AUDITORIA
// ============================================================================

export function generateAuditReport(input: ReportInput): AuditReport {
  const findings: AuditReportFinding[] = (input.auditFindings ?? []).map((finding) => ({
    type: finding.type,
    severity: finding.severity,
    code: finding.code,
    message: finding.message,
    entityType: finding.entityType ?? null,
    entityId: finding.entityId ?? null,
    field: finding.field ?? null,
    justification: finding.justification ?? null,
    resolvedAt: finding.resolvedAt ?? null,
  }));

  const byTypeMap = new Map<string, number>();
  findings.forEach((finding) => {
    byTypeMap.set(finding.type, (byTypeMap.get(finding.type) ?? 0) + 1);
  });

  const errors = findings.filter((finding) => finding.severity === "ERROR").length;
  const warnings = findings.filter((finding) => finding.severity === "WARNING").length;
  const infos = findings.filter((finding) => finding.severity === "INFO").length;
  const totals = computeStageTotals(input.stages);

  return {
    metadata: input.metadata,
    findings,
    summary: {
      errors,
      warnings,
      infos,
      total: findings.length,
      blocking: errors > 0,
    },
    byType: Array.from(byTypeMap.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    totals: {
      direct: totals.direct,
      withBdi: totals.withBdi,
      itemsCount: totals.itemsCount,
    },
  };
}

// ============================================================================
// RECONCILIAÇÃO DE TOTAIS
// ============================================================================

export interface ReportReconciliation {
  source: "SNAPSHOT" | "DATABASE";
  expectedDirect: Decimal;
  computedDirect: Decimal;
  expectedWithBdi: Decimal;
  computedWithBdi: Decimal;
  directDifference: Decimal;
  withBdiDifference: Decimal;
  reconciled: boolean;
}

/**
 * Compara os totais calculados pelo motor com os totais da fonte selecionada
 * (snapshot imutável ou rascunho). Diferenças iguais ou superiores a 0,01
 * indicam inconsistência de exportação.
 */
export function reconcileReportTotals(params: {
  source: "SNAPSHOT" | "DATABASE";
  stages: ReportStage[];
  expected?: ReportExpectedTotals;
}): ReportReconciliation {
  const computed = computeStageTotals(params.stages);
  const expectedDirect = params.expected
    ? D(params.expected.direct)
    : computed.direct;
  const expectedWithBdi = params.expected
    ? D(params.expected.withBdi)
    : computed.withBdi;

  const directDifference = computed.direct.minus(expectedDirect);
  const withBdiDifference = computed.withBdi.minus(expectedWithBdi);
  const tolerance = new Decimal("0.01");

  return {
    source: params.source,
    expectedDirect,
    computedDirect: computed.direct,
    expectedWithBdi,
    computedWithBdi: computed.withBdi,
    directDifference,
    withBdiDifference,
    reconciled:
      directDifference.abs().lt(tolerance) &&
      withBdiDifference.abs().lt(tolerance),
  };
}
