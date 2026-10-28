/**
 * Carteira de orçamentos — ObraCalc
 *
 * Regra central: cada orçamento contribui com exatamente UMA revisão de
 * referência (a mais recente). Revisões anteriores nunca são somadas aos
 * indicadores; elas aparecem apenas em comparativos de variação.
 *
 * Revisões finalizadas usam os totais do snapshot imutável; rascunhos usam os
 * itens persistidos.
 */

import Decimal from "decimal.js";
import { prisma } from "@/lib/db/prisma";

export interface PortfolioStageTotal {
  code: string;
  title: string;
  direct: string;
  withBdi: string;
  itemsCount: number;
}

export interface PortfolioRevisionInput {
  id: string;
  revisionNumber: number;
  status: string;
  updatedAt: string;
  source: "SNAPSHOT" | "DATABASE";
  direct: string;
  withBdi: string;
  bdiAmount: string;
  effectiveBdi: string;
  itemsCount: number;
  stages: PortfolioStageTotal[];
}

export interface PortfolioBudgetInput {
  id: string;
  title: string;
  projectName: string;
  projectState: string | null;
  status: string;
  revisions: PortfolioRevisionInput[];
}

export interface PortfolioReference extends PortfolioRevisionInput {
  budgetId: string;
  budgetTitle: string;
  projectName: string;
  projectState: string | null;
  budgetStatus: string;
}

export interface PortfolioComparison {
  budgetId: string;
  budgetTitle: string;
  fromRevisionNumber: number;
  toRevisionNumber: number;
  deltaDirect: string;
  deltaWithBdi: string;
  deltaPercent: string;
  hasChanges: boolean;
}

export interface PortfolioSnapshot {
  indicators: {
    totalProjects: number;
    totalBudgets: number;
    activeBudgets: number;
    finalizedBudgets: number;
    totalRevisions: number;
    snapshotReferences: number;
    totalDirect: string;
    totalWithBdi: string;
    totalBdi: string;
    averageBdi: string;
    itemsCount: number;
  };
  references: PortfolioReference[];
  stageRanking: Array<{
    code: string;
    title: string;
    totalWithBdi: string;
    percentage: string;
  }>;
  statusDistribution: Array<{
    status: string;
    count: number;
    totalWithBdi: string;
  }>;
  budgetRanking: Array<{
    budgetId: string;
    title: string;
    projectName: string;
    totalWithBdi: string;
    status: string;
  }>;
  comparisons: PortfolioComparison[];
  generatedAt: string;
}

function D(value: string | number | Decimal | null | undefined): Decimal {
  if (value instanceof Decimal) return value;
  return new Decimal(value ?? 0);
}

interface StageLike {
  id?: string;
  code?: string;
  title?: string;
  parentStageId?: string | null;
  sortOrder?: number;
  items: Array<{ subtotal: string; subtotalWithBdi: string }>;
}

/**
 * Agrega subtotais de uma etapa com todas as suas filhas e devolve apenas as
 * etapas raiz. Evita dupla contagem entre etapa pai e subetapas.
 */
export function buildRootStageTotals(stages: StageLike[]): PortfolioStageTotal[] {
  const byCode = new Map<string, string>();
  stages.forEach((stage, index) => {
    byCode.set(stage.code ?? String(index + 1), stage.id ?? `stage-${index}`);
  });

  const resolved = stages.map((stage, index) => {
    const code = stage.code ?? String(index + 1);
    let parentId = stage.parentStageId ?? null;

    // Snapshots v1 não armazenavam parentStageId: infere pelo código "1.1.2".
    if (stage.parentStageId === undefined && code.includes(".")) {
      parentId = byCode.get(code.slice(0, code.lastIndexOf("."))) ?? null;
    }

    return {
      id: stage.id ?? `stage-${index}`,
      code,
      title: stage.title ?? "Etapa",
      parentId,
      sortOrder: stage.sortOrder ?? index,
      items: stage.items,
    };
  });

  const ids = new Set(resolved.map((stage) => stage.id));
  const children = new Map<string | null, typeof resolved>();
  resolved.forEach((stage) => {
    const parent = stage.parentId && ids.has(stage.parentId) ? stage.parentId : null;
    const list = children.get(parent) ?? [];
    list.push(stage);
    children.set(parent, list);
  });
  children.forEach((list) => list.sort((a, b) => a.sortOrder - b.sortOrder));

  const cache = new Map<
    string,
    { direct: Decimal; withBdi: Decimal; itemsCount: number }
  >();

  const accumulate = (
    stage: (typeof resolved)[number],
    visiting: Set<string>
  ): { direct: Decimal; withBdi: Decimal; itemsCount: number } => {
    const cached = cache.get(stage.id);
    if (cached) return cached;
    if (visiting.has(stage.id)) {
      return { direct: new Decimal(0), withBdi: new Decimal(0), itemsCount: 0 };
    }
    visiting.add(stage.id);

    let direct = new Decimal(0);
    let withBdi = new Decimal(0);
    let itemsCount = 0;
    stage.items.forEach((item) => {
      direct = direct.plus(D(item.subtotal));
      withBdi = withBdi.plus(D(item.subtotalWithBdi));
      itemsCount += 1;
    });

    for (const child of children.get(stage.id) ?? []) {
      const childTotals = accumulate(child, visiting);
      direct = direct.plus(childTotals.direct);
      withBdi = withBdi.plus(childTotals.withBdi);
      itemsCount += childTotals.itemsCount;
    }

    visiting.delete(stage.id);
    const result = { direct, withBdi, itemsCount };
    cache.set(stage.id, result);
    return result;
  };

  return (children.get(null) ?? []).map((stage) => {
    const totals = accumulate(stage, new Set());
    return {
      code: stage.code,
      title: stage.title,
      direct: totals.direct.toString(),
      withBdi: totals.withBdi.toString(),
      itemsCount: totals.itemsCount,
    };
  });
}

/**
 * Agrega a carteira. Recebe dados já normalizados para ser testável sem banco.
 */
export function aggregatePortfolio(
  budgets: PortfolioBudgetInput[],
  generatedAt = new Date().toISOString()
): PortfolioSnapshot {
  const references: PortfolioReference[] = [];
  const comparisons: PortfolioComparison[] = [];

  for (const budget of budgets) {
    const ordered = [...budget.revisions].sort(
      (a, b) => b.revisionNumber - a.revisionNumber
    );
    const reference = ordered[0];
    if (!reference) continue;

    references.push({
      ...reference,
      budgetId: budget.id,
      budgetTitle: budget.title,
      projectName: budget.projectName,
      projectState: budget.projectState,
      budgetStatus: budget.status,
    });

    const previous = ordered[1];
    if (previous) {
      const deltaDirect = D(reference.direct).minus(D(previous.direct));
      const deltaWithBdi = D(reference.withBdi).minus(D(previous.withBdi));
      const deltaPercent = D(previous.withBdi).isZero()
        ? new Decimal(0)
        : deltaWithBdi.dividedBy(D(previous.withBdi)).times(100);

      comparisons.push({
        budgetId: budget.id,
        budgetTitle: budget.title,
        fromRevisionNumber: previous.revisionNumber,
        toRevisionNumber: reference.revisionNumber,
        deltaDirect: deltaDirect.toFixed(2),
        deltaWithBdi: deltaWithBdi.toFixed(2),
        deltaPercent: deltaPercent.toFixed(4),
        hasChanges: !deltaDirect.isZero() || !deltaWithBdi.isZero(),
      });
    }
  }

  const totalDirect = references.reduce(
    (acc, reference) => acc.plus(D(reference.direct)),
    new Decimal(0)
  );
  const totalWithBdi = references.reduce(
    (acc, reference) => acc.plus(D(reference.withBdi)),
    new Decimal(0)
  );
  const totalBdi = totalWithBdi.minus(totalDirect);
  const itemsCount = references.reduce(
    (acc, reference) => acc + reference.itemsCount,
    0
  );

  const stageMap = new Map<string, { title: string; total: Decimal }>();
  references.forEach((reference) => {
    reference.stages.forEach((stage) => {
      const key = `${stage.code}::${stage.title}`;
      const current = stageMap.get(key) ?? {
        title: stage.title,
        total: new Decimal(0),
      };
      current.total = current.total.plus(D(stage.withBdi));
      stageMap.set(key, current);
    });
  });

  const stageRanking = Array.from(stageMap.entries())
    .map(([key, value]) => {
      const code = key.split("::")[0];
      return {
        code,
        title: value.title,
        totalWithBdi: value.total.toFixed(2),
        percentage: totalWithBdi.gt(0)
          ? value.total.dividedBy(totalWithBdi).times(100).toFixed(2)
          : "0.00",
      };
    })
    .sort((a, b) => Number(b.totalWithBdi) - Number(a.totalWithBdi))
    .slice(0, 10);

  const statusMap = new Map<string, { count: number; total: Decimal }>();
  references.forEach((reference) => {
    const current = statusMap.get(reference.budgetStatus) ?? {
      count: 0,
      total: new Decimal(0),
    };
    current.count += 1;
    current.total = current.total.plus(D(reference.withBdi));
    statusMap.set(reference.budgetStatus, current);
  });

  const statusDistribution = Array.from(statusMap.entries())
    .map(([status, value]) => ({
      status,
      count: value.count,
      totalWithBdi: value.total.toFixed(2),
    }))
    .sort((a, b) => b.count - a.count);

  const budgetRanking = references
    .map((reference) => ({
      budgetId: reference.budgetId,
      title: reference.budgetTitle,
      projectName: reference.projectName,
      totalWithBdi: reference.withBdi,
      status: reference.budgetStatus,
    }))
    .sort((a, b) => new Decimal(b.totalWithBdi).minus(a.totalWithBdi).toNumber())
    .slice(0, 6);

  const totalProjects = new Set(references.map((reference) => reference.projectName)).size;
  const finalizedBudgets = references.filter(
    (reference) => reference.budgetStatus === "FINALIZED"
  ).length;
  const activeBudgets = references.filter(
    (reference) => reference.budgetStatus === "DRAFT"
  ).length;

  return {
    indicators: {
      totalProjects,
      totalBudgets: references.length,
      activeBudgets,
      finalizedBudgets,
      totalRevisions: budgets.reduce((acc, budget) => acc + budget.revisions.length, 0),
      snapshotReferences: references.filter(
        (reference) => reference.source === "SNAPSHOT"
      ).length,
      totalDirect: totalDirect.toFixed(2),
      totalWithBdi: totalWithBdi.toFixed(2),
      totalBdi: totalBdi.toFixed(2),
      averageBdi: totalDirect.gt(0)
        ? totalBdi.dividedBy(totalDirect).times(100).toFixed(2)
        : "0.00",
      itemsCount,
    },
    references,
    stageRanking,
    statusDistribution,
    budgetRanking,
    comparisons,
    generatedAt,
  };
}

interface SnapshotStageShape {
  id?: string;
  code?: string;
  title?: string;
  parentStageId?: string | null;
  sortOrder?: number;
  items?: Array<{ subtotal?: string; subtotalWithBdi?: string }>;
}

interface SnapshotTotalsShape {
  direct?: string;
  withBdi?: string;
  bdiAmount?: string;
  itemsCount?: number;
}

function revisionFromSnapshot(params: {
  id: string;
  revisionNumber: number;
  status: string;
  updatedAt: string;
  snapshotData: unknown;
}): PortfolioRevisionInput {
  const data = (params.snapshotData ?? {}) as {
    stages?: SnapshotStageShape[];
    metadata?: { totals?: SnapshotTotalsShape };
  };
  const stages: StageLike[] = (Array.isArray(data.stages) ? data.stages : []).map(
    (stage, index) => ({
      id: stage.id ?? `stage-${index}`,
      code: stage.code ?? String(index + 1),
      title: stage.title ?? "Etapa",
      parentStageId:
        stage.parentStageId === undefined
          ? undefined
          : stage.parentStageId,
      sortOrder: stage.sortOrder ?? index,
      items: (stage.items ?? []).map((item) => ({
        subtotal: item.subtotal ?? "0",
        subtotalWithBdi: item.subtotalWithBdi ?? "0",
      })),
    })
  );

  const stageTotals = buildRootStageTotals(stages);
  const computedDirect = stageTotals.reduce(
    (acc, stage) => acc.plus(D(stage.direct)),
    new Decimal(0)
  );
  const computedWithBdi = stageTotals.reduce(
    (acc, stage) => acc.plus(D(stage.withBdi)),
    new Decimal(0)
  );

  // Prefere os totais gravados no snapshot (v2) para que o dashboard use
  // exatamente o mesmo valor do relatório e do snapshot aprovado.
  const stored = data.metadata?.totals;
  const direct =
    stored?.direct !== undefined ? D(stored.direct) : computedDirect;
  const withBdi =
    stored?.withBdi !== undefined ? D(stored.withBdi) : computedWithBdi;
  const bdiAmount =
    stored?.bdiAmount !== undefined
      ? D(stored.bdiAmount)
      : withBdi.minus(direct);
  const itemsCount =
    stored?.itemsCount ??
    stageTotals.reduce((acc, stage) => acc + stage.itemsCount, 0);

  return {
    id: params.id,
    revisionNumber: params.revisionNumber,
    status: params.status,
    updatedAt: params.updatedAt,
    source: "SNAPSHOT",
    direct: direct.toFixed(2),
    withBdi: withBdi.toFixed(2),
    bdiAmount: bdiAmount.toFixed(2),
    effectiveBdi: direct.gt(0)
      ? bdiAmount.dividedBy(direct).times(100).toFixed(4)
      : "0.0000",
    itemsCount,
    stages: stageTotals,
  };
}

function revisionFromDatabase(params: {
  id: string;
  revisionNumber: number;
  status: string;
  updatedAt: string;
  stages: Array<{
    id: string;
    code: string;
    title: string;
    parentStageId: string | null;
    sortOrder: number;
    items: Array<{
      subtotal: Decimal | string;
      subtotalWithBdi: Decimal | string;
    }>;
  }>;
}): PortfolioRevisionInput {
  const stages: StageLike[] = params.stages.map((stage) => ({
    id: stage.id,
    code: stage.code,
    title: stage.title,
    parentStageId: stage.parentStageId,
    sortOrder: stage.sortOrder,
    items: stage.items.map((item) => ({
      subtotal: item.subtotal.toString(),
      subtotalWithBdi: item.subtotalWithBdi.toString(),
    })),
  }));

  const stageTotals = buildRootStageTotals(stages);
  const direct = stageTotals.reduce(
    (acc, stage) => acc.plus(D(stage.direct)),
    new Decimal(0)
  );
  const withBdi = stageTotals.reduce(
    (acc, stage) => acc.plus(D(stage.withBdi)),
    new Decimal(0)
  );
  const bdiAmount = withBdi.minus(direct);

  return {
    id: params.id,
    revisionNumber: params.revisionNumber,
    status: params.status,
    updatedAt: params.updatedAt,
    source: "DATABASE",
    direct: direct.toFixed(2),
    withBdi: withBdi.toFixed(2),
    bdiAmount: bdiAmount.toFixed(2),
    effectiveBdi: direct.gt(0)
      ? bdiAmount.dividedBy(direct).times(100).toFixed(4)
      : "0.0000",
    itemsCount: stageTotals.reduce((acc, stage) => acc + stage.itemsCount, 0),
    stages: stageTotals,
  };
}

/**
 * Carrega a carteira do usuário. Para cada orçamento, inclui todas as revisões
 * (necessário para o comparativo), mas apenas a mais recente entra nos totais.
 */
export async function loadPortfolio(userId: string): Promise<PortfolioSnapshot> {
  const budgets = await prisma.budget.findMany({
    where: { userId },
    include: {
      project: { select: { name: true, state: true } },
      revisions: {
        orderBy: { revisionNumber: "desc" },
        include: {
          snapshot: { select: { snapshotData: true } },
          stages: {
            orderBy: { sortOrder: "asc" },
            include: {
              items: {
                select: { subtotal: true, subtotalWithBdi: true },
              },
            },
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  const normalized: PortfolioBudgetInput[] = budgets.map((budget) => ({
    id: budget.id,
    title: budget.title,
    projectName: budget.project.name,
    projectState: budget.project.state,
    status: budget.status,
    revisions: budget.revisions.map((revision) => {
      if (revision.snapshot) {
        return revisionFromSnapshot({
          id: revision.id,
          revisionNumber: revision.revisionNumber,
          status: revision.status,
          updatedAt: revision.updatedAt.toISOString(),
          snapshotData: revision.snapshot.snapshotData,
        });
      }

      return revisionFromDatabase({
        id: revision.id,
        revisionNumber: revision.revisionNumber,
        status: revision.status,
        updatedAt: revision.updatedAt.toISOString(),
        stages: revision.stages,
      });
    }),
  }));

  return aggregatePortfolio(normalized);
}
