import Decimal from 'decimal.js';

/**
 * Modos de arredondamento suportados pelo Decimal.js e configuráveis no ObraCalc.
 *
 * - ROUND_HALF_UP: Arredonda para o mais próximo; se equidistante, arredonda para cima (padrão comercial brasileiro).
 * - ROUND_HALF_EVEN: Arredondamento bancário (Banker's rounding) para minimizar viés estatístico.
 * - ROUND_UP: Sempre afasta de zero (arredondamento para cima absoluto).
 * - ROUND_DOWN: Sempre trunca em direção a zero.
 * - ROUND_CEILING: Arredonda em direção ao infinito positivo.
 * - ROUND_FLOOR: Arredonda em direção ao infinito negativo.
 */
export type RoundingMode =
  | 'ROUND_HALF_UP'
  | 'ROUND_HALF_EVEN'
  | 'ROUND_UP'
  | 'ROUND_DOWN'
  | 'ROUND_CEILING'
  | 'ROUND_FLOOR';

/**
 * Política de arredondamento e precisão decimal do orçamento.
 * Define casas decimais independentes para preços, quantidades, coeficientes e totais.
 */
export interface RoundingPolicy {
  /** Quantidade de casas decimais para preços unitários (padrão: 4) */
  priceDecimals: number;
  /** Quantidade de casas decimais para quantidades na planilha (padrão: 4) */
  quantityDecimals: number;
  /** Quantidade de casas decimais para coeficientes/consumos de insumos (padrão: 5) */
  coefficientDecimals: number;
  /** Quantidade de casas decimais para subtotais e totais finais (padrão: 2) */
  totalDecimals: number;
  /** Modo de arredondamento a ser aplicado */
  roundingMode: RoundingMode | string;
}

/**
 * Categorias de insumos conforme padrão SINAPI/SICRO.
 *
 * - MATERIAL: Materiais de construção (cimento, aço, areia, blocos, etc.).
 * - LABOR: Mão de obra operacional e encarregados (pedreiro, servente, etc.).
 * - EQUIPMENT: Equipamentos mecânicos, máquinas e veículos (betoneira, caminhão, etc.).
 * - OTHER: Serviços de terceiros, taxas ou outros custos diretos.
 */
export type ResourceCategory = 'MATERIAL' | 'LABOR' | 'EQUIPMENT' | 'OTHER';

/**
 * Dados de entrada de um insumo para cálculo.
 */
export interface ResourceInput {
  /** Identificador único do insumo */
  id: string;
  /** Código do insumo (ex.: SINAPI 00001379) */
  code: string;
  /** Descrição técnica completa do insumo */
  description: string;
  /** Unidade de medida (ex.: kg, m³, h, un) */
  unit: string;
  /** Categoria do insumo */
  category: ResourceCategory;
  /** Preço unitário expresso como string decimal (ex.: "12.4500") */
  price: string;
  /** Indica se os encargos sociais já estão embutidos no preço */
  laborChargesIncluded: boolean;
  /** Percentual de encargos sociais caso não estejam inclusos (ex.: "84.50" para 84,5%) */
  laborChargesRate?: string;
}

/**
 * Tipo de composição de custos unitários.
 *
 * - ANALYTICAL: Composição analítica detalhada em insumos e composições auxiliares.
 * - CLOSED: Composição fechada/sintética, cujo valor total provém de tabela externa e não deve ser decomposta arbitrariamente.
 */
export type CompositionType = 'ANALYTICAL' | 'CLOSED';

/**
 * Regra de conversão entre unidades de medida com fator de escala determinístico.
 */
export interface UnitConversionRule {
  fromUnit: string;
  toUnit: string;
  /** Fator multiplicador para converter fromUnit para toUnit (ex.: 1 t = 1000 kg -> fator 1000) */
  factor: Decimal | string | number;
  isExact?: boolean;
}

/**
 * Função ou dicionário para resolução de fatores de conversão entre unidades.
 */
export type UnitConversionResolver =
  | Map<string, Decimal | string | number>
  | Record<string, Decimal | string | number>
  | ((fromUnit: string, toUnit: string) => Decimal | string | number | undefined);

/**
 * Componente que integra uma composição (pode ser insumo OU composição auxiliar).
 */
export interface ComponentInput {
  /** Identificador opcional do vínculo/componente */
  id?: string;
  /** ID do insumo vinculado (se for insumo direto) */
  resourceId?: string;
  /** ID da composição auxiliar vinculada (se for subcomposição) */
  childCompositionId?: string;
  /** Unidade de consumo na composição (se diferente da unidade do insumo/subcomposição) */
  unit?: string;
  /** Fator explícito de conversão de unidade aplicado ao componente */
  unitConversionFactor?: string | Decimal | number;
  /** Coeficiente de consumo unitário em formato string decimal (ex.: "0.01500") */
  coefficient: string;
  /** Dados completos do insumo (quando resolvido) */
  resource?: ResourceInput;
  /** Dados completos da composição auxiliar (quando resolvida) */
  childComposition?: CompositionInput;
}

/**
 * Dados de entrada de uma composição de custos unitários.
 */
export interface CompositionInput {
  /** Identificador único da composição */
  id: string;
  /** Código de referência da composição (ex.: SINAPI 88247) */
  code: string;
  /** Descrição detalhada do serviço */
  description: string;
  /** Unidade de medida do serviço (ex.: m², m³, m, un) */
  unit: string;
  /** Tipo da composição (Analítica ou Fechada) */
  type: CompositionType;
  /** Lista de componentes (insumos e/ou composições auxiliares) */
  components: ComponentInput[];
  /** Preço total fechado de origem (obrigatório se type = CLOSED) */
  closedTotalPrice?: string;
  /** Parcela de material fechada de origem (se disponibilizada pela fonte) */
  closedMaterialPrice?: string;
  /** Parcela de mão de obra fechada de origem */
  closedLaborPrice?: string;
  /** Parcela de equipamentos fechada de origem */
  closedEquipmentPrice?: string;
  /** Parcela de outros custos fechada de origem */
  closedOtherPrice?: string;
}

/**
 * Desdobramento do custo unitário por categoria de custo direto.
 * Todos os valores são garantidamente instâncias de Decimal.
 *
 * Invariante para composições analíticas:
 * `total = material + labor + equipment + other + unallocated`.
 *
 * `unallocated` existe apenas quando uma parcela do custo não possui
 * desdobramento na fonte (por exemplo, composição fechada sem parcelas por
 * categoria). O motor jamais rateia artificialmente esse valor entre categorias.
 */
export interface CostBreakdown {
  /** Custo direto com materiais */
  material: Decimal;
  /** Custo direto com mão de obra */
  labor: Decimal;
  /** Custo direto com equipamentos */
  equipment: Decimal;
  /** Outros custos diretos */
  other: Decimal;
  /** Custo unitário direto total (categorias + parcela não desdobrada) */
  total: Decimal;
  /**
   * Parcela do total sem desdobramento por categoria.
   * Ausente/omitida equivale a zero nos dados legados.
   */
  unallocated?: Decimal;
  /**
   * `true` quando existe parcela sem desdobramento (total > soma das categorias)
   * ou quando a fonte de uma composição fechada não informou as categorias.
   */
  breakdownUnavailable?: boolean;
}

/**
 * Desdobramento por categoria de um componente individual da composição.
 * Soma exata de `material + labor + equipment + other + unallocated === total`.
 */
export interface ComponentCostBreakdown {
  material: Decimal;
  labor: Decimal;
  equipment: Decimal;
  other: Decimal;
  unallocated: Decimal;
  total: Decimal;
}

/**
 * Detalhe de cálculo individual de um componente dentro de uma composição analítica.
 */
export interface ComponentDetail {
  /** Identificador do componente ou recurso */
  componentId: string;
  /** Descrição do insumo ou da composição auxiliar */
  description: string;
  /** Unidade de medida */
  unit: string;
  /** Coeficiente de consumo aplicado (já convertido para a unidade do insumo) */
  coefficient: Decimal;
  /** Preço unitário do componente */
  unitPrice: Decimal;
  /** Preço total deste componente (coeficiente × unitPrice, com resíduo rateado) */
  totalPrice: Decimal;
  /** Categoria do insumo ou indicação de subcomposição */
  category: ResourceCategory | 'COMPOSITION';
  /** Desdobramento exato do valor deste componente por categoria */
  costBreakdown?: ComponentCostBreakdown;
  /** Fator de conversão de unidade efetivamente aplicado ao coeficiente */
  appliedUnitConversionFactor?: Decimal;
  /** Unidade de origem do coeficiente, quando houve conversão */
  sourceUnit?: string;
  /** Percentual de encargos sociais aplicado ao preço base (somente mão de obra) */
  laborChargesRate?: Decimal;
  /** Valor unitário dos encargos sociais incorporado ao preço (somente mão de obra) */
  laborChargesAmount?: Decimal;
}

/**
 * Resultado completo do cálculo de uma composição de custo unitário.
 */
export interface CompositionResult {
  /** Identificador da composição calculada */
  compositionId: string;
  /** Desdobramento de custos unitários diretos */
  unitCost: CostBreakdown;
  /** Lista de itens componentes com valores unitários e totais */
  componentDetails: ComponentDetail[];
  /** Indica se a composição é fechada e não possui desdobramento detalhado */
  breakdownUnavailable?: boolean;
}

/**
 * Parâmetros de entrada para o cálculo de um item da planilha orçamentária.
 */
export interface BudgetItemInput {
  /** Identificador do item (suporta id ou itemId) */
  id?: string;
  /** Identificador alternativo do item */
  itemId?: string;
  /** Quantidade orçada do serviço */
  quantity: string | Decimal | number;
  /** Custo unitário desdobrado da composição vinculada */
  compositionCost?: CostBreakdown;
  /** Identificador da composição para busca em catálogo se compositionCost não fornecido */
  compositionId?: string;
  /** Taxa de BDI percentual a aplicar no item (ex.: "24.50" para 24,5%) */
  bdiRate: string | Decimal | number;
}

/**
 * Resultado do cálculo de um item de serviço da planilha orçamentária.
 */
export interface BudgetItemResult {
  /** Identificador do item orçado */
  itemId: string;
  /** Quantidade arredondada conforme a política */
  quantity: Decimal;
  /** Custo unitário desdobrado */
  unitCost: CostBreakdown;
  /** Subtotal direto sem BDI (quantity × unitCost.total) */
  subtotal: Decimal;
  /** Taxa de BDI aplicada em percentual */
  bdiRate: Decimal;
  /**
   * Valor monetário do BDI calculado sobre o subtotal.
   * Invariante: `subtotalWithBdi === subtotal + bdiAmount` (exato, sem resíduo).
   */
  bdiAmount: Decimal;
  /** Subtotal final com BDI aplicado: `subtotal + bdiAmount` */
  subtotalWithBdi: Decimal;
  /**
   * Valores do item por categoria, já reconciliados com o subtotal.
   * A soma `material + labor + equipment + other + unallocated` é exatamente
   * igual a `subtotal` (resíduos de arredondamento são alocados de forma
   * determinística na maior categoria).
   */
  categoryAmounts: ComponentCostBreakdown;
  /** Resíduo de arredondamento alocado para fechar o subtotal (pode ser negativo). */
  roundingResidual: Decimal;
  /** `true` somente quando todo o custo possui desdobramento por categoria. */
  breakdownAvailable: boolean;
}

/**
 * Parâmetros de entrada para cálculo de uma etapa da EAP (Estrutura Analítica de Projeto).
 */
export interface StageInput {
  /** Identificador único da etapa */
  id: string;
  /** Código hierárquico da etapa (ex.: "1.2", "2.1.3") */
  code?: string;
  /** Título da etapa (ex.: "Fundações e Estruturas") */
  title?: string;
  /** Itens de serviço diretamente pertencentes a esta etapa */
  items?: (BudgetItemInput | { quantity: string; compositionCost: CostBreakdown; bdiRate: string; id?: string; itemId?: string })[];
  /** Subetapas filhas (hierarquia recursiva) */
  childStages?: StageInput[];
}

/**
 * Resultado do cálculo de uma etapa da planilha orçamentária.
 */
export interface StageResult {
  /** Identificador da etapa calculada */
  stageId: string;
  /** Resultados dos itens diretos pertencentes a esta etapa */
  items: BudgetItemResult[];
  /** Resultados das subetapas filhas */
  childStages: StageResult[];
  /** Subtotal direto da etapa (soma dos itens diretos + soma das subetapas filhas) */
  subtotal: Decimal;
  /** Valor do BDI da etapa (soma exata dos BDI dos itens e subetapas) */
  bdiAmount: Decimal;
  /** Subtotal com BDI da etapa (soma dos itens com BDI + soma das subetapas filhas com BDI) */
  subtotalWithBdi: Decimal;
}

/**
 * Componentes percentuais para o cálculo do BDI conforme fórmula do TCU (Acórdão nº 2622/2013).
 * Todos os valores devem ser fornecidos em base percentual (ex.: 3.00 para 3%).
 */
export interface BdiComponents {
  /** AC - Administração Central (%) */
  ac: Decimal | string | number;
  /** CF - Custo Financeiro (%) */
  cf: Decimal | string | number;
  /** S - Seguros (%) */
  s: Decimal | string | number;
  /** G - Garantias contratuais (%) */
  g: Decimal | string | number;
  /** MI - Margem de Incerteza / Risco (%) */
  mi: Decimal | string | number;
  /** TM - Tributos Municipais, ex.: ISS (%) */
  tm: Decimal | string | number;
  /** TE - Tributos Estaduais, ex.: ICMS quando aplicável (%) */
  te: Decimal | string | number;
  /** TF - Tributos Federais: PIS, COFINS, CPRB (%) */
  tf: Decimal | string | number;
  /** L - Lucro / Lucratividade esperada (%) */
  l: Decimal | string | number;
}

/**
 * Códigos estáveis de validação do BDI, adequados para testes e auditoria.
 */
export type BdiValidationCode =
  | 'INVALID_NUMBER'
  | 'NEGATIVE_COMPONENT'
  | 'TAXES_AT_OR_ABOVE_100'
  | 'DENOMINATOR_NOT_POSITIVE'
  | 'INVALID_DECIMALS';

/** Problema de validação encontrado no cálculo do BDI. */
export interface BdiValidationIssue {
  code: BdiValidationCode;
  /** Componente afetado, quando aplicável. */
  field?: keyof BdiComponents;
  message: string;
}

/**
 * Memória de cálculo estruturada do BDI, adequada para persistência,
 * auditoria e reprodução independente dos passos textuais.
 */
export interface BdiCalculationMemory {
  /** Fórmula aplicada, em representação textual canônica. */
  formula: {
    expression: string;
    numerator: string;
    denominator: string;
  };
  /** Componentes exatamente como informados, em base percentual (%). */
  inputsPercent: Record<keyof BdiComponents, Decimal>;
  /** Componentes normalizados para taxa unitária (% / 100). */
  normalized: Record<keyof BdiComponents, Decimal>;
  /** Somatórios intermediários da fórmula. */
  sums: {
    numeratorComponents: Decimal;
    denominatorComponents: Decimal;
    taxes: Decimal;
    taxesAndProfit: Decimal;
  };
  /** Parcela A (numerador): 1 + AC + CF + S + G + MI */
  factorA: Decimal;
  /** Parcela B (denominador): 1 - (TM + TE + TF + L) */
  factorB: Decimal;
  /** Razão A/B; zero quando o cálculo é inválido (nunca Infinity/NaN). */
  ratio: Decimal;
  /** BDI bruto em percentual, antes do arredondamento da política. */
  rawPercentage: Decimal;
  /** BDI final após arredondamento. */
  roundedPercentage: Decimal;
  /** Casas decimais usadas no arredondamento. */
  decimals: number;
  /** Passos textuais humanizados em português, para exibição e auditoria. */
  steps: string[];
}

/**
 * Resultado detalhado do cálculo do BDI.
 */
export interface BdiResult {
  /** Taxa final de BDI em percentual calculada (ex.: 24.2345) */
  rate: Decimal;
  /** Parcela A (Numerador da fórmula): 1 + AC + CF + S + G + MI */
  factorA: Decimal;
  /** Parcela B (Denominador da fórmula): 1 - (TM + TE + TF + L) */
  factorB: Decimal;
  /** BDI expresso em percentual (idêntico a rate) */
  percentage: Decimal;
  /** Indica se os parâmetros fornecidos são matematicamente válidos (B > 0, sem valores negativos) */
  isValid: boolean;
  /** Lista de mensagens de erro caso os parâmetros sejam inválidos */
  validationErrors: string[];
  /** Lista estruturada dos problemas encontrados (código + campo + mensagem). */
  issues: BdiValidationIssue[];
  /** Passos textuais humanizados em português compondo a memória de cálculo para auditoria */
  calculationSteps: string[];
  /** Memória de cálculo estruturada e reprodutível. */
  memory: BdiCalculationMemory;
}

/** Origem da taxa de BDI efetivamente aplicada a um serviço. */
export type BdiOrigin = 'ITEM_OVERRIDE' | 'REVISION_DEFAULT' | 'SYSTEM_DEFAULT' | 'NONE';

/** Referência mínima a uma configuração de BDI (taxa já calculada, em %). */
export interface BdiConfigReference {
  id?: string;
  name?: string;
  rate: Decimal | string | number;
}

/** Entradas para resolver a taxa efetiva de um serviço, por precedência. */
export interface BdiResolutionInput {
  /** Exceção específica do serviço (maior precedência). */
  itemOverride?: BdiConfigReference | null;
  /** BDI padrão da revisão/orçamento. */
  revisionDefault?: BdiConfigReference | null;
  /** BDI padrão do sistema; `null` desabilita o fallback. */
  systemDefault?: BdiConfigReference | null;
}

/** Taxa efetiva resolvida e sua origem. */
export interface BdiResolution {
  rate: Decimal;
  origin: BdiOrigin;
  configId?: string;
  name?: string;
  /** `true` quando a taxa é uma exceção específica do serviço. */
  isException: boolean;
}

/**
 * Interface do executor de arredondamento determinístico baseado na política.
 */
export interface Rounder {
  /** Política de arredondamento ativa */
  readonly policy: RoundingPolicy;
  /** Arredonda um preço unitário conforme policy.priceDecimals */
  roundPrice(value: Decimal | string | number): Decimal;
  /** Arredonda uma quantidade orçada conforme policy.quantityDecimals */
  roundQuantity(value: Decimal | string | number): Decimal;
  /** Arredonda um coeficiente de insumo conforme policy.coefficientDecimals */
  roundCoefficient(value: Decimal | string | number): Decimal;
  /** Arredonda um valor financeiro final/subtotal conforme policy.totalDecimals */
  roundTotal(value: Decimal | string | number): Decimal;
  /** Arredonda qualquer valor decimal para um número arbitrário de casas */
  roundToDecimals(value: Decimal | string | number, decimals: number): Decimal;
}
