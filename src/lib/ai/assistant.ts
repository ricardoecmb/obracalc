/**
 * Assistente de orçamentos — ObraCalc
 *
 * Regra inegociável: o assistente NUNCA altera preços, coeficientes ou
 * quantidades. Todas as saídas são sugestões não vinculantes, exibidas para
 * decisão humana.
 *
 * O sistema funciona integralmente sem IA. A busca assistida e a análise são
 * determinísticas; quando existe um provedor ativo configurado, o texto pode
 * ser enriquecido por um modelo de linguagem, sempre em modo somente leitura.
 */

import Decimal from "decimal.js";
import { prisma } from "@/lib/db/prisma";
import { rankByFuzzy } from "@/lib/search/fuzzy";
import {
  getActiveProviderCredentials,
  type AIProvider,
} from "@/lib/ai/config";

export type SuggestionSeverity = "INFO" | "WARNING" | "ERROR";
export type SuggestionCategory =
  | "PRICE"
  | "QUANTITY"
  | "STRUCTURE"
  | "BDI"
  | "AUDIT"
  | "COST";

export interface AssistantSuggestion {
  id: string;
  severity: SuggestionSeverity;
  category: SuggestionCategory;
  title: string;
  detail: string;
  entityType: string | null;
  entityId: string | null;
  actionHint: string;
  /** Sugestões nunca são aplicadas automaticamente. */
  binding: false;
}

export interface AssistantSearchHit {
  type: "COMPOSITION" | "RESOURCE";
  id: string;
  code: string;
  description: string;
  unit: string;
  category: string;
  price: string;
  score: number;
}

export interface AssistantAnswer {
  mode: "LOCAL" | "AI";
  provider: AIProvider | null;
  model: string | null;
  answer: string;
  suggestions: AssistantSuggestion[];
  searchHits: AssistantSearchHit[];
  notice: string;
  generatedAt: string;
}

function D(value: string | number | Decimal | null | undefined): Decimal {
  if (value instanceof Decimal) return value;
  return new Decimal(value ?? 0);
}

function brl(value: Decimal | string | number): string {
  const decimal = D(value);
  const fixed = decimal.toFixed(2);
  const negative = fixed.startsWith("-");
  const unsigned = negative ? fixed.slice(1) : fixed;
  const [integer, fraction] = unsigned.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}R$ ${grouped},${fraction}`;
}

// ============================================================================
// BUSCA ASSISTIDA (DETERMINÍSTICA, SEM IA)
// ============================================================================

/**
 * Busca composições e insumos do usuário com ranking estável. Funciona sempre,
 * mesmo sem nenhum provedor de IA configurado.
 */
export async function assistedSearch(params: {
  userId: string;
  query: string;
  limit?: number;
}): Promise<AssistantSearchHit[]> {
  const limit = Math.min(Math.max(params.limit ?? 8, 1), 25);
  const query = params.query.trim();

  const [compositions, resources] = await Promise.all([
    prisma.composition.findMany({
      where: { userId: params.userId, active: true },
      select: {
        id: true,
        code: true,
        description: true,
        unit: true,
        type: true,
        closedTotalPrice: true,
      },
      take: 2000,
      orderBy: { code: "asc" },
    }),
    prisma.resource.findMany({
      where: { userId: params.userId, active: true },
      select: {
        id: true,
        code: true,
        description: true,
        unit: true,
        category: true,
        price: true,
      },
      take: 2000,
      orderBy: { code: "asc" },
    }),
  ]);

  const compositionHits = rankByFuzzy(
    compositions,
    query,
    (item) => ({ code: item.code, description: item.description }),
    limit
  ).map(({ item, score }) => ({
    type: "COMPOSITION" as const,
    id: item.id,
    code: item.code,
    description: item.description,
    unit: item.unit,
    category: item.type === "CLOSED" ? "FECHADA" : "ANALÍTICA",
    price: (item.closedTotalPrice ?? new Decimal(0)).toFixed(4),
    score: Number(score.toFixed(4)),
  }));

  const resourceHits = rankByFuzzy(
    resources,
    query,
    (item) => ({ code: item.code, description: item.description }),
    limit
  ).map(({ item, score }) => ({
    type: "RESOURCE" as const,
    id: item.id,
    code: item.code,
    description: item.description,
    unit: item.unit,
    category: item.category,
    price: item.price.toFixed(4),
    score: Number(score.toFixed(4)),
  }));

  return [...compositionHits, ...resourceHits]
    .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code, "pt-BR"))
    .slice(0, limit);
}

// ============================================================================
// SUGESTÕES NÃO VINCULANTES
// ============================================================================

export interface SuggestionStageInput {
  id: string;
  code: string;
  title: string;
  items: Array<{
    id: string;
    compositionCode: string;
    compositionDescription: string;
    compositionType: string;
    compositionComponentsCount: number;
    quantity: string;
    unitCostTotal: string;
    subtotal: string;
    subtotalWithBdi: string;
    bdiRate: string;
  }>;
}

export interface SuggestionAuditInput {
  id: string;
  severity: string;
  code: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  justification: string | null;
  resolvedAt: string | null;
}

/**
 * Constrói sugestões determinísticas a partir de uma revisão já carregada.
 * Função pura: não consulta o banco e não altera nada.
 */
export function buildSuggestions(params: {
  stages: SuggestionStageInput[];
  auditResults?: SuggestionAuditInput[];
  revisionNumber: number;
}): AssistantSuggestion[] {
  const suggestions: AssistantSuggestion[] = [];
  const allItems = params.stages.flatMap((stage) =>
    stage.items.map((item) => ({ item, stage }))
  );

  const totalWithBdi = allItems.reduce(
    (acc, entry) => acc.plus(D(entry.item.subtotalWithBdi)),
    new Decimal(0)
  );

  // 1. Estrutura: etapas sem itens.
  for (const stage of params.stages) {
    if (stage.items.length === 0) {
      suggestions.push({
        id: `structure-empty-${stage.id}`,
        severity: "WARNING",
        category: "STRUCTURE",
        title: `Etapa ${stage.code} sem itens`,
        detail: `A etapa "${stage.title}" não possui serviços vinculados e não contribui para o total da revisão ${params.revisionNumber}.`,
        entityType: "STAGE",
        entityId: stage.id,
        actionHint: "Revise a EAP e inclua os serviços previstos ou remova a etapa vazia.",
        binding: false,
      });
    }
  }

  // 2. Quantidades inválidas.
  for (const { item, stage } of allItems) {
    const quantity = D(item.quantity);
    if (quantity.lte(0)) {
      suggestions.push({
        id: `quantity-${item.id}`,
        severity: "ERROR",
        category: "QUANTITY",
        title: `Quantidade não positiva em ${item.compositionCode}`,
        detail: `O item "${item.compositionDescription}" (etapa ${stage.code}) está com quantidade ${item.quantity} ${quantity.isZero() ? "— item zerado" : ""}.`,
        entityType: "BUDGET_ITEM",
        entityId: item.id,
        actionHint: "Confirme a quantidade medida antes de finalizar a revisão.",
        binding: false,
      });
    }
  }

  // 3. Preço unitário zerado.
  for (const { item, stage } of allItems) {
    const unitCost = D(item.unitCostTotal);
    if (unitCost.lte(0) && D(item.quantity).gt(0)) {
      suggestions.push({
        id: `price-${item.id}`,
        severity: "ERROR",
        category: "PRICE",
        title: `Preço unitário zerado em ${item.compositionCode}`,
        detail: `O item "${item.compositionDescription}" (etapa ${stage.code}) tem quantidade positiva, mas custo unitário igual a zero.`,
        entityType: "BUDGET_ITEM",
        entityId: item.id,
        actionHint: "Vincule preços aos insumos da composição ou atualize a base de referência.",
        binding: false,
      });
    }
  }

  // 4. Composições abertas sem componentes.
  for (const { item } of allItems) {
    if (
      item.compositionType === "ANALYTICAL" &&
      item.compositionComponentsCount === 0
    ) {
      suggestions.push({
        id: `composition-${item.id}`,
        severity: "WARNING",
        category: "STRUCTURE",
        title: `Composição analítica vazia: ${item.compositionCode}`,
        detail: `"${item.compositionDescription}" está marcada como analítica, mas não possui insumos cadastrados.`,
        entityType: "COMPOSITION",
        entityId: item.id,
        actionHint: "Cadastre os coeficientes ou converta a composição em fechada com preço de origem.",
        binding: false,
      });
    }
  }

  // 5. BDI zerado com custo direto positivo.
  for (const { item } of allItems) {
    if (D(item.subtotal).gt(0) && D(item.bdiRate).lte(0)) {
      suggestions.push({
        id: `bdi-${item.id}`,
        severity: "WARNING",
        category: "BDI",
        title: `BDI zerado em ${item.compositionCode}`,
        detail: `O item "${item.compositionDescription}" possui custo direto, mas BDI 0%. Verifique se há exceção intencional.`,
        entityType: "BUDGET_ITEM",
        entityId: item.id,
        actionHint: "Confirme a configuração de BDI da revisão ou registre a justificativa da exceção.",
        binding: false,
      });
    }
  }

  // 6. Concentração de custo (Pareto): itens acima de 15% do total.
  if (totalWithBdi.gt(0)) {
    for (const { item } of allItems) {
      const share = D(item.subtotalWithBdi).dividedBy(totalWithBdi).times(100);
      if (share.gte(15)) {
        suggestions.push({
          id: `concentration-${item.id}`,
          severity: "INFO",
          category: "COST",
          title: `Item concentra ${share.toFixed(1)}% do orçamento`,
          detail: `"${item.compositionDescription}" representa ${brl(item.subtotalWithBdi)} do total. Itens com alta participação merecem conferência de quantidade e cotação.`,
          entityType: "BUDGET_ITEM",
          entityId: item.id,
          actionHint: "Priorize este item na curva ABC e valide a cotação com fornecedores.",
          binding: false,
        });
      }
    }
  }

  // 7. Achados de auditoria não justificados.
  for (const finding of params.auditResults ?? []) {
    if (finding.resolvedAt) continue;
    suggestions.push({
      id: `audit-${finding.id}`,
      severity:
        finding.severity === "ERROR"
          ? "ERROR"
          : finding.severity === "WARNING"
            ? "WARNING"
            : "INFO",
      category: "AUDIT",
      title: `Auditoria ${finding.code || finding.severity}`,
      detail: finding.message,
      entityType: finding.entityType,
      entityId: finding.entityId,
      actionHint: finding.justification
        ? "Justificativa registrada. Revise-a antes de finalizar."
        : "Analise o achado e registre uma justificativa ou corrija o dado de origem.",
      binding: false,
    });
  }

  const severityOrder: Record<SuggestionSeverity, number> = {
    ERROR: 0,
    WARNING: 1,
    INFO: 2,
  };

  return suggestions.sort(
    (a, b) =>
      severityOrder[a.severity] - severityOrder[b.severity] ||
      a.id.localeCompare(b.id)
  );
}

/** Carrega uma revisão e devolve as sugestões não vinculantes. */
export async function suggestForRevision(params: {
  userId: string;
  revisionId: string;
}): Promise<{
  budgetId: string;
  budgetTitle: string;
  revisionNumber: number;
  suggestions: AssistantSuggestion[];
}> {
  const revision = await prisma.budgetRevision.findFirst({
    where: {
      id: params.revisionId,
      budget: { userId: params.userId },
    },
    include: {
      budget: { select: { id: true, title: true } },
      auditResults: true,
      stages: {
        orderBy: { sortOrder: "asc" },
        include: {
          items: {
            orderBy: { sortOrder: "asc" },
            include: {
              composition: {
                select: {
                  code: true,
                  description: true,
                  type: true,
                  _count: { select: { components: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!revision) {
    throw new Error("Revisão não encontrada para este usuário.");
  }

  const stages: SuggestionStageInput[] = revision.stages.map((stage) => ({
    id: stage.id,
    code: stage.code,
    title: stage.title,
    items: stage.items.map((item) => ({
      id: item.id,
      compositionCode: item.composition.code,
      compositionDescription: item.composition.description,
      compositionType: item.composition.type,
      compositionComponentsCount: item.composition._count.components,
      quantity: item.quantity.toString(),
      unitCostTotal: item.unitCostTotal.toString(),
      subtotal: item.subtotal.toString(),
      subtotalWithBdi: item.subtotalWithBdi.toString(),
      bdiRate: item.bdiRate.toString(),
    })),
  }));

  return {
    budgetId: revision.budget.id,
    budgetTitle: revision.budget.title,
    revisionNumber: revision.revisionNumber,
    suggestions: buildSuggestions({
      stages,
      revisionNumber: revision.revisionNumber,
      auditResults: revision.auditResults.map((result) => ({
        id: result.id,
        severity: result.severity,
        code: result.code,
        message: result.message,
        entityType: result.entityType,
        entityId: result.entityId,
        justification: result.justification,
        resolvedAt: result.resolvedAt?.toISOString() ?? null,
      })),
    }),
  };
}

// ============================================================================
// RESUMO LOCAL (SEMPRE DISPONÍVEL)
// ============================================================================

export function buildLocalAnswer(params: {
  suggestions: AssistantSuggestion[];
  searchHits: AssistantSearchHit[];
  query: string;
  budgetTitle?: string | null;
  revisionNumber?: number | null;
}): string {
  const errors = params.suggestions.filter((s) => s.severity === "ERROR").length;
  const warnings = params.suggestions.filter((s) => s.severity === "WARNING").length;
  const infos = params.suggestions.filter((s) => s.severity === "INFO").length;

  const parts: string[] = [];

  if (params.query.trim()) {
    parts.push(`Busca por "${params.query.trim()}".`);
  }

  if (params.searchHits.length > 0) {
    const compositions = params.searchHits.filter((hit) => hit.type === "COMPOSITION");
    const resources = params.searchHits.filter((hit) => hit.type === "RESOURCE");
    parts.push(
      `Encontrei ${compositions.length} composição(ões) e ${resources.length} insumo(s) relacionados.`
    );
    const top = params.searchHits[0];
    parts.push(
      `O resultado mais aderente é ${top.code} — ${top.description} (${top.unit}).`
    );
  } else if (params.query.trim()) {
    parts.push("Nenhuma composição ou insumo corresponde exatamente à consulta.");
  }

  if (params.budgetTitle) {
    parts.push(
      `Análise da revisão ${params.revisionNumber ?? 1} de "${params.budgetTitle}": ${errors} erro(s), ${warnings} alerta(s) e ${infos} informação(ões).`
    );
  }

  parts.push(
    "As sugestões são apenas orientativas e não alteram preços, coeficientes ou quantidades. Nenhuma alteração é aplicada automaticamente."
  );

  return parts.join(" ");
}

// ============================================================================
// ENRIQUECIMENTO OPCIONAL POR IA
// ============================================================================

const AI_TIMEOUT_MS = 20_000;

function buildPrompt(params: {
  query: string;
  suggestions: AssistantSuggestion[];
  searchHits: AssistantSearchHit[];
  budgetTitle?: string | null;
  revisionNumber?: number | null;
}): string {
  const suggestionLines = params.suggestions
    .slice(0, 20)
    .map((s) => `- [${s.severity}/${s.category}] ${s.title}: ${s.detail}`)
    .join("\n");
  const hitLines = params.searchHits
    .slice(0, 10)
    .map((h) => `- ${h.type} ${h.code} | ${h.description} | ${h.unit} | R$ ${h.price}`)
    .join("\n");

  return [
    "Você é um assistente técnico de orçamentos de obras públicas no Brasil.",
    "Responda em português do Brasil, de forma objetiva e técnica.",
    "Você é SOMENTE LEITURA: nunca proponha alterações automáticas de preços, coeficientes ou quantidades.",
    "Toda recomendação deve ser apresentada como sugestão sujeita a validação humana.",
    params.budgetTitle
      ? `Orçamento: ${params.budgetTitle} — revisão ${params.revisionNumber ?? 1}.`
      : "",
    params.query ? `Pergunta do usuário: ${params.query}` : "Faça um resumo dos pontos de atenção.",
    "",
    "Achados determinísticos:",
    suggestionLines || "- Nenhum achado relevante.",
    "",
    "Resultados de busca:",
    hitLines || "- Nenhum resultado.",
    "",
    "Produza um parecer curto (máximo 12 linhas), separando fatos de recomendações.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function callOpenAICompatible(params: {
  url: string;
  apiKey: string;
  model: string;
  prompt: string;
  extraHeaders?: Record<string, string>;
}): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const response = await fetch(params.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.apiKey}`,
        ...params.extraHeaders,
      },
      body: JSON.stringify({
        model: params.model,
        temperature: 0.2,
        max_tokens: 700,
        messages: [
          {
            role: "system",
            content:
              "Assistente técnico de orçamentos de obras. Somente leitura, sem alterações automáticas.",
          },
          { role: "user", content: params.prompt },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Provedor respondeu ${response.status}${body ? `: ${body.slice(0, 180)}` : ""}`
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Resposta vazia do provedor.");
    return content.trim();
  } finally {
    clearTimeout(timeout);
  }
}

async function callGemini(params: {
  apiKey: string;
  model: string;
  prompt: string;
}): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      params.model
    )}:generateContent`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": params.apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: params.prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 700 },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Provedor respondeu ${response.status}${body ? `: ${body.slice(0, 180)}` : ""}`
      );
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const content = data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("\n")
      .trim();
    if (!content) throw new Error("Resposta vazia do provedor.");
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Gera a resposta do assistente. Se não houver provedor ativo, devolve o
 * parecer local determinístico. Falhas de rede degradam graciosamente para o
 * modo local — a IA nunca bloqueia o sistema.
 */
export async function answerAssistantQuestion(params: {
  userId: string;
  query: string;
  revisionId?: string | null;
  budgetTitle?: string | null;
  revisionNumber?: number | null;
}): Promise<AssistantAnswer> {
  const query = params.query.trim();
  const searchHits = query
    ? await assistedSearch({ userId: params.userId, query, limit: 8 })
    : [];

  let suggestions: AssistantSuggestion[] = [];
  let budgetTitle = params.budgetTitle ?? null;
  let revisionNumber = params.revisionNumber ?? null;

  if (params.revisionId) {
    const outcome = await suggestForRevision({
      userId: params.userId,
      revisionId: params.revisionId,
    });
    suggestions = outcome.suggestions;
    budgetTitle = outcome.budgetTitle;
    revisionNumber = outcome.revisionNumber;
  }

  const localAnswer = buildLocalAnswer({
    suggestions,
    searchHits,
    query,
    budgetTitle,
    revisionNumber,
  });

  const credentials = await getActiveProviderCredentials(params.userId);
  if (!credentials) {
    return {
      mode: "LOCAL",
      provider: null,
      model: null,
      answer: localAnswer,
      suggestions,
      searchHits,
      notice:
        "Modo local determinístico. Configure um provedor de IA para obter texto enriquecido. As sugestões permanecem não vinculantes.",
      generatedAt: new Date().toISOString(),
    };
  }

  try {
    const prompt = buildPrompt({
      query,
      suggestions,
      searchHits,
      budgetTitle,
      revisionNumber,
    });

    const answer =
      credentials.provider === "gemini"
        ? await callGemini({
            apiKey: credentials.apiKey,
            model: credentials.model,
            prompt,
          })
        : await callOpenAICompatible({
            url:
              credentials.provider === "openrouter"
                ? "https://openrouter.ai/api/v1/chat/completions"
                : "https://api.openai.com/v1/chat/completions",
            apiKey: credentials.apiKey,
            model: credentials.model,
            prompt,
            extraHeaders:
              credentials.provider === "openrouter"
                ? {
                    "HTTP-Referer": "https://obracalc.app",
                    "X-Title": "ObraCalc",
                  }
                : undefined,
          });

    return {
      mode: "AI",
      provider: credentials.provider,
      model: credentials.model,
      answer,
      suggestions,
      searchHits,
      notice:
        "Resposta gerada por IA em modo somente leitura. Nenhum preço, coeficiente ou quantidade foi alterado.",
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      mode: "LOCAL",
      provider: credentials.provider,
      model: credentials.model,
      answer:
        `${localAnswer} Não foi possível consultar o provedor de IA: ` +
        `${error instanceof Error ? error.message : "erro desconhecido"}.`,
      suggestions,
      searchHits,
      notice:
        "Falha no provedor de IA; o assistente continuou em modo local. Nenhuma alteração foi aplicada.",
      generatedAt: new Date().toISOString(),
    };
  }
}
