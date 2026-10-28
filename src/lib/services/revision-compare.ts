import Decimal from "decimal.js";
import { prisma } from "@/lib/db/prisma";

export interface ComparableItem {
  key: string;
  compositionCode: string;
  description: string;
  unit: string;
  quantity: string;
  unitCostTotal: string;
  subtotal: string;
  bdiRate: string;
  subtotalWithBdi: string;
}

export interface ComparableStage {
  code: string;
  title: string;
  items: ComparableItem[];
  subtotalDirect: string;
  subtotalWithBdi: string;
}

export interface ComparableRevision {
  id: string;
  revisionNumber: number;
  status: string;
  source: "SNAPSHOT" | "DATABASE";
  stages: ComparableStage[];
  totalDirect: string;
  totalWithBdi: string;
}

export type ComparisonStatus = "ADDED" | "REMOVED" | "CHANGED" | "UNCHANGED";

export interface ItemComparison {
  key: string;
  compositionCode: string;
  description: string;
  unit: string;
  status: ComparisonStatus;
  quantityFrom: string | null;
  quantityTo: string | null;
  unitCostFrom: string | null;
  unitCostTo: string | null;
  subtotalFrom: string | null;
  subtotalTo: string | null;
  delta: string;
}

export interface StageComparison {
  code: string;
  title: string;
  status: ComparisonStatus;
  subtotalFrom: string;
  subtotalTo: string;
  delta: string;
  items: ItemComparison[];
}

export interface RevisionComparison {
  budgetId: string;
  from: {
    id: string;
    revisionNumber: number;
    status: string;
    source: "SNAPSHOT" | "DATABASE";
    totalDirect: string;
    totalWithBdi: string;
  };
  to: RevisionComparison["from"];
  summary: {
    deltaDirect: string;
    deltaWithBdi: string;
    deltaPercent: string;
    itemsAdded: number;
    itemsRemoved: number;
    itemsChanged: number;
    stagesChanged: number;
  };
  stages: StageComparison[];
}

interface SnapshotStage {
  code: string;
  title: string;
  items: Array<{
    quantity: string;
    unitCostTotal: string;
    subtotal: string;
    bdiRate: string;
    subtotalWithBdi: string;
    composition: { code: string; description: string; unit: string };
  }>;
}

function itemKey(stageCode: string, compositionCode: string, occurrence: number): string {
  return `${stageCode}::${compositionCode}::${occurrence}`;
}

function buildItems(
  stageCode: string,
  items: Array<{
    compositionCode: string;
    description: string;
    unit: string;
    quantity: string;
    unitCostTotal: string;
    subtotal: string;
    bdiRate: string;
    subtotalWithBdi: string;
  }>
): ComparableItem[] {
  const occurrences = new Map<string, number>();

  return items.map((item) => {
    const count = occurrences.get(item.compositionCode) ?? 0;
    occurrences.set(item.compositionCode, count + 1);
    return {
      key: itemKey(stageCode, item.compositionCode, count),
      ...item,
    };
  });
}

function sum(items: ComparableItem[], field: "subtotal" | "subtotalWithBdi"): Decimal {
  return items.reduce(
    (total, item) => total.plus(item[field] ?? 0),
    new Decimal(0)
  );
}

/**
 * Carrega uma revisão em formato comparável. Revisões finalizadas usam o
 * snapshot imutável como fonte da verdade; rascunhos usam os dados atuais.
 */
export async function loadComparableRevision(params: {
  userId: string;
  revisionId: string;
}): Promise<ComparableRevision> {
  const revision = await prisma.budgetRevision.findFirst({
    where: {
      id: params.revisionId,
      budget: { userId: params.userId },
    },
    include: {
      snapshot: true,
      stages: {
        orderBy: { sortOrder: "asc" },
        include: {
          items: {
            orderBy: { sortOrder: "asc" },
            include: {
              composition: {
                select: { code: true, description: true, unit: true },
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

  if (revision.snapshot) {
    const data = revision.snapshot.snapshotData as { stages?: SnapshotStage[] };
    const snapshotStages = Array.isArray(data.stages) ? data.stages : [];

    const stages: ComparableStage[] = snapshotStages.map((stage) => {
      const items = buildItems(
        stage.code,
        stage.items.map((item) => ({
          compositionCode: item.composition.code,
          description: item.composition.description,
          unit: item.composition.unit,
          quantity: item.quantity,
          unitCostTotal: item.unitCostTotal,
          subtotal: item.subtotal,
          bdiRate: item.bdiRate,
          subtotalWithBdi: item.subtotalWithBdi,
        }))
      );

      return {
        code: stage.code,
        title: stage.title,
        items,
        subtotalDirect: sum(items, "subtotal").toFixed(2),
        subtotalWithBdi: sum(items, "subtotalWithBdi").toFixed(2),
      };
    });

    return {
      id: revision.id,
      revisionNumber: revision.revisionNumber,
      status: revision.status,
      source: "SNAPSHOT",
      stages,
      totalDirect: stages
        .reduce((total, stage) => total.plus(stage.subtotalDirect), new Decimal(0))
        .toFixed(2),
      totalWithBdi: stages
        .reduce((total, stage) => total.plus(stage.subtotalWithBdi), new Decimal(0))
        .toFixed(2),
    };
  }

  const stages: ComparableStage[] = revision.stages.map((stage) => {
    const items = buildItems(
      stage.code,
      stage.items.map((item) => ({
        compositionCode: item.composition.code,
        description: item.composition.description,
        unit: item.composition.unit,
        quantity: item.quantity.toString(),
        unitCostTotal: item.unitCostTotal.toString(),
        subtotal: item.subtotal.toString(),
        bdiRate: item.bdiRate.toString(),
        subtotalWithBdi: item.subtotalWithBdi.toString(),
      }))
    );

    return {
      code: stage.code,
      title: stage.title,
      items,
      subtotalDirect: sum(items, "subtotal").toFixed(2),
      subtotalWithBdi: sum(items, "subtotalWithBdi").toFixed(2),
    };
  });

  return {
    id: revision.id,
    revisionNumber: revision.revisionNumber,
    status: revision.status,
    source: "DATABASE",
    stages,
    totalDirect: stages
      .reduce((total, stage) => total.plus(stage.subtotalDirect), new Decimal(0))
      .toFixed(2),
    totalWithBdi: stages
      .reduce((total, stage) => total.plus(stage.subtotalWithBdi), new Decimal(0))
      .toFixed(2),
  };
}

function compareItems(
  fromItems: ComparableItem[],
  toItems: ComparableItem[]
): { items: ItemComparison[]; added: number; removed: number; changed: number } {
  const fromMap = new Map(fromItems.map((item) => [item.key, item]));
  const toMap = new Map(toItems.map((item) => [item.key, item]));
  const keys = Array.from(new Set([...fromMap.keys(), ...toMap.keys()])).sort();

  let added = 0;
  let removed = 0;
  let changed = 0;

  const items = keys.map((key) => {
    const before = fromMap.get(key) ?? null;
    const after = toMap.get(key) ?? null;

    let status: ComparisonStatus = "UNCHANGED";
    if (!before && after) {
      status = "ADDED";
      added++;
    } else if (before && !after) {
      status = "REMOVED";
      removed++;
    } else if (before && after) {
      const quantityChanged = !new Decimal(before.quantity).equals(after.quantity);
      const priceChanged = !new Decimal(before.unitCostTotal).equals(after.unitCostTotal);
      if (quantityChanged || priceChanged) {
        status = "CHANGED";
        changed++;
      }
    }

    const delta =
      after && before
        ? new Decimal(after.subtotal).minus(before.subtotal)
        : after
          ? new Decimal(after.subtotal)
          : new Decimal(before?.subtotal ?? 0).negated();

    return {
      key,
      compositionCode: after?.compositionCode ?? before!.compositionCode,
      description: after?.description ?? before!.description,
      unit: after?.unit ?? before!.unit,
      status,
      quantityFrom: before?.quantity ?? null,
      quantityTo: after?.quantity ?? null,
      unitCostFrom: before?.unitCostTotal ?? null,
      unitCostTo: after?.unitCostTotal ?? null,
      subtotalFrom: before?.subtotal ?? null,
      subtotalTo: after?.subtotal ?? null,
      delta: delta.toFixed(2),
    };
  });

  return { items, added, removed, changed };
}

/**
 * Compara duas revisões do mesmo orçamento. Funciona também quando a revisão
 * de origem já foi finalizada (nesse caso lê o snapshot imutável).
 */
export async function compareRevisions(params: {
  userId: string;
  fromRevisionId: string;
  toRevisionId: string;
}): Promise<RevisionComparison> {
  const [from, to] = await Promise.all([
    loadComparableRevision({ userId: params.userId, revisionId: params.fromRevisionId }),
    loadComparableRevision({ userId: params.userId, revisionId: params.toRevisionId }),
  ]);

  const budgetId = await resolveBudgetId(params.userId, params.fromRevisionId, params.toRevisionId);

  const stageMapFrom = new Map(from.stages.map((stage) => [stage.code, stage]));
  const stageMapTo = new Map(to.stages.map((stage) => [stage.code, stage]));
  const stageCodes = Array.from(
    new Set([...stageMapFrom.keys(), ...stageMapTo.keys()])
  ).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));

  let added = 0;
  let removed = 0;
  let changedItems = 0;
  let stagesChanged = 0;

  const stages: StageComparison[] = stageCodes.map((code) => {
    const before = stageMapFrom.get(code) ?? null;
    const after = stageMapTo.get(code) ?? null;

    const comparison = compareItems(before?.items ?? [], after?.items ?? []);
    added += comparison.added;
    removed += comparison.removed;
    changedItems += comparison.changed;

    const subtotalFrom = before?.subtotalDirect ?? "0.00";
    const subtotalTo = after?.subtotalDirect ?? "0.00";
    const delta = new Decimal(subtotalTo).minus(subtotalFrom).toFixed(2);

    let status: ComparisonStatus = "UNCHANGED";
    if (!before && after) status = "ADDED";
    else if (before && !after) status = "REMOVED";
    else if (comparison.added || comparison.removed || comparison.changed) status = "CHANGED";

    if (status !== "UNCHANGED") stagesChanged++;

    return {
      code,
      title: after?.title ?? before?.title ?? code,
      status,
      subtotalFrom,
      subtotalTo,
      delta,
      items: comparison.items,
    };
  });

  const deltaDirect = new Decimal(to.totalDirect)
    .minus(from.totalDirect)
    .toFixed(2);
  const deltaWithBdi = new Decimal(to.totalWithBdi)
    .minus(from.totalWithBdi)
    .toFixed(2);
  const deltaPercent = new Decimal(from.totalWithBdi).isZero()
    ? "0"
    : new Decimal(deltaWithBdi)
        .dividedBy(from.totalWithBdi)
        .times(100)
        .toDecimalPlaces(4)
        .toString();

  return {
    budgetId,
    from: {
      id: from.id,
      revisionNumber: from.revisionNumber,
      status: from.status,
      source: from.source,
      totalDirect: from.totalDirect,
      totalWithBdi: from.totalWithBdi,
    },
    to: {
      id: to.id,
      revisionNumber: to.revisionNumber,
      status: to.status,
      source: to.source,
      totalDirect: to.totalDirect,
      totalWithBdi: to.totalWithBdi,
    },
    summary: {
      deltaDirect,
      deltaWithBdi,
      deltaPercent,
      itemsAdded: added,
      itemsRemoved: removed,
      itemsChanged: changedItems,
      stagesChanged,
    },
    stages,
  };
}

async function resolveBudgetId(
  userId: string,
  fromRevisionId: string,
  toRevisionId: string
): Promise<string> {
  const revisions = await prisma.budgetRevision.findMany({
    where: {
      id: { in: [fromRevisionId, toRevisionId] },
      budget: { userId },
    },
    select: { budgetId: true },
  });

  if (revisions.length !== 2) {
    throw new Error("As revisões devem pertencer ao mesmo orçamento do usuário.");
  }

  const [first, second] = revisions;
  if (first.budgetId !== second.budgetId) {
    throw new Error("Não é possível comparar revisões de orçamentos diferentes.");
  }

  return first.budgetId;
}
