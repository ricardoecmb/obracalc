/**
 * Carregamento canônico dos dados de relatório — ObraCalc
 *
 * Revisões finalizadas são lidas exclusivamente do snapshot imutável para que
 * os totais exportados sejam idênticos aos do snapshot selecionado. Rascunhos
 * são lidos do banco transacional. O mesmo formato de saída alimenta todos os
 * exportadores (XLSX, CSV e PDF).
 */

import Decimal from "decimal.js";
import { prisma } from "@/lib/db/prisma";
import { loadCompositionCatalog } from "@/lib/services/composition-cost";
import type { CompositionInput } from "@/lib/engine/types";
import {
  expandCompositionResources,
  type ExpandedResource,
} from "@/lib/reports/resource-expansion";
import {
  reconcileReportTotals,
  type ReportAuditFindingInput,
  type ReportInput,
  type ReportReconciliation,
  type ReportResourceLineInput,
  type ReportRevisionMetadata,
  type ReportStage,
} from "@/lib/reports/report-engine";

export interface ReportHeaderOptions {
  companyName?: string | null;
  cnpj?: string | null;
  professionalName?: string | null;
  registrationType?: string | null;
  registrationNumber?: string | null;
  customTitle?: string | null;
  footer?: string | null;
  includeChecksum?: boolean;
}

export interface ReportBundle {
  input: ReportInput;
  source: "SNAPSHOT" | "DATABASE";
  reconciliation: ReportReconciliation;
  headerDefaults: ReportHeaderOptions;
  checksum: string | null;
  budgetTitle: string;
  revisionNumber: number;
}

interface SnapshotBdi {
  name?: string;
  bdiRate?: string;
  ac?: string;
  cf?: string;
  s?: string;
  g?: string;
  mi?: string;
  tm?: string;
  te?: string;
  tf?: string;
  l?: string;
}

interface SnapshotMetadata {
  snapshotVersion?: number;
  revisionNumber?: number;
  budgetTitle?: string;
  projectName?: string;
  clientName?: string | null;
  technicalResponsible?: string | null;
  baseDate?: string | null;
  referenceState?: string | null;
  referenceMonth?: string | null;
  referenceTaxRegime?: string | null;
  rounding?: { mode?: string; totalDecimals?: number };
  totals?: {
    direct?: string;
    withBdi?: string;
    bdiAmount?: string;
    effectiveBdi?: string;
    itemsCount?: number;
  };
  bdiConfig?: SnapshotBdi | null;
}

interface SnapshotExpandedResource {
  code?: string;
  description?: string;
  unit?: string;
  category?: string;
  coefficient?: string;
  price?: string;
  synthetic?: boolean;
  compositionCode?: string | null;
}

interface SnapshotItem {
  id?: string;
  sortOrder?: number;
  quantity?: string;
  unitCostTotal?: string;
  unitCostMaterial?: string;
  unitCostLabor?: string;
  unitCostEquipment?: string;
  unitCostOther?: string;
  subtotal?: string;
  bdiRate?: string;
  subtotalWithBdi?: string;
  notes?: string | null;
  bdiConfigName?: string | null;
  bdiOverride?: string | null;
  expandedResources?: SnapshotExpandedResource[];
  composition?: {
    code?: string;
    description?: string;
    unit?: string;
    type?: string;
    components?: Array<{
      coefficient?: string;
      resource?: {
        code?: string;
        description?: string;
        unit?: string;
        category?: string;
        price?: string;
      } | null;
      childCompositionCode?: string | null;
    }>;
  };
}

interface SnapshotStage {
  id?: string;
  code?: string;
  title?: string;
  parentStageId?: string | null;
  sortOrder?: number;
  items?: SnapshotItem[];
}

function D(value: string | number | Decimal | null | undefined): Decimal {
  if (value instanceof Decimal) return value;
  return new Decimal(value ?? 0);
}

function mapBdi(bdi: SnapshotBdi | null | undefined) {
  if (!bdi?.name) return null;
  return {
    name: bdi.name,
    bdiRate: bdi.bdiRate ?? "0",
    ac: bdi.ac ?? "0",
    cf: bdi.cf ?? "0",
    s: bdi.s ?? "0",
    g: bdi.g ?? "0",
    mi: bdi.mi ?? "0",
    tm: bdi.tm ?? "0",
    te: bdi.te ?? "0",
    tf: bdi.tf ?? "0",
    l: bdi.l ?? "0",
  };
}

function largestCategory(item: SnapshotItem): string {
  const candidates: Array<{ category: string; value: Decimal }> = [
    { category: "MATERIAL", value: D(item.unitCostMaterial) },
    { category: "LABOR", value: D(item.unitCostLabor) },
    { category: "EQUIPMENT", value: D(item.unitCostEquipment) },
    { category: "OTHER", value: D(item.unitCostOther) },
  ];
  candidates.sort((a, b) => b.value.minus(a.value).toNumber());
  return candidates[0].value.gt(0) ? candidates[0].category : "OTHER";
}

function inferParentStageId(
  stages: SnapshotStage[],
  stage: SnapshotStage,
  byCode: Map<string, string>
): string | null {
  if (stage.parentStageId !== undefined) {
    return stage.parentStageId;
  }
  const code = stage.code ?? "";
  const lastDot = code.lastIndexOf(".");
  if (lastDot <= 0) return null;
  const parentCode = code.slice(0, lastDot);
  return byCode.get(parentCode) ?? null;
}

function resourceLinesFromSnapshotItem(item: SnapshotItem): ReportResourceLineInput[] {
  const quantity = D(item.quantity);
  const expanded = item.expandedResources ?? [];

  if (expanded.length > 0) {
    return expanded.map((resource) => {
      const coefficient = D(resource.coefficient ?? 0);
      const consumed = quantity.times(coefficient);
      return {
        code: resource.code ?? "—",
        description: resource.description ?? "Insumo",
        unit: resource.unit ?? "—",
        category: resource.category ?? "OTHER",
        coefficient: coefficient.toString(),
        price: resource.price ?? "0",
        quantity: consumed.toString(),
        total: consumed.times(D(resource.price)).toString(),
        synthetic: resource.synthetic === true,
        compositionCode: resource.compositionCode ?? item.composition?.code ?? null,
      };
    });
  }

  // Snapshots v1 não armazenavam insumos expandidos. Representamos o item como
  // uma linha sintética para preservar exatamente o custo direto do snapshot.
  return [
    {
      code: item.composition?.code ?? "—",
      description: `${item.composition?.description ?? "Item"} (snapshot v1)`,
      unit: item.composition?.unit ?? "—",
      category: largestCategory(item),
      coefficient: "1",
      price: item.unitCostTotal ?? "0",
      quantity: quantity.toString(),
      total: item.subtotal ?? "0",
      synthetic: true,
      compositionCode: item.composition?.code ?? null,
    },
  ];
}

function stagesFromSnapshot(data: {
  stages?: SnapshotStage[];
  auditResults?: ReportAuditFindingInput[];
}) {
  const snapshotStages = Array.isArray(data.stages) ? data.stages : [];

  const byCode = new Map<string, string>();
  snapshotStages.forEach((stage, index) => {
    byCode.set(stage.code ?? String(index + 1), stage.id ?? `stage-${index}`);
  });

  const stages: ReportStage[] = [];
  const resources: ReportResourceLineInput[] = [];

  snapshotStages.forEach((stage, stageIndex) => {
    const stageId = stage.id ?? `stage-${stageIndex}`;
    const items = (stage.items ?? []).map((item, itemIndex) => {
      resources.push(...resourceLinesFromSnapshotItem(item));
      return {
        id: item.id ?? `${stageId}-item-${itemIndex}`,
        compositionCode: item.composition?.code ?? "—",
        compositionDescription: item.composition?.description ?? "—",
        unit: item.composition?.unit ?? "—",
        compositionType:
          item.composition?.type === "CLOSED" ? ("CLOSED" as const) : ("ANALYTICAL" as const),
        quantity: item.quantity ?? "0",
        unitCostMaterial: item.unitCostMaterial ?? "0",
        unitCostLabor: item.unitCostLabor ?? "0",
        unitCostEquipment: item.unitCostEquipment ?? "0",
        unitCostOther: item.unitCostOther ?? "0",
        unitCostTotal: item.unitCostTotal ?? "0",
        subtotal: item.subtotal ?? "0",
        bdiRate: item.bdiRate ?? "0",
        subtotalWithBdi: item.subtotalWithBdi ?? "0",
        notes: item.notes ?? null,
        bdiConfigName: item.bdiConfigName ?? null,
      };
    });

    stages.push({
      id: stageId,
      code: stage.code ?? String(stageIndex + 1),
      title: stage.title ?? "Etapa",
      parentStageId: inferParentStageId(snapshotStages, stage, byCode),
      sortOrder: stage.sortOrder ?? stageIndex,
      items,
    });
  });

  return { stages, resources };
}

function sumExpected(stages: ReportStage[]) {
  let direct = new Decimal(0);
  let withBdi = new Decimal(0);
  stages.forEach((stage) => {
    stage.items.forEach((item) => {
      direct = direct.plus(D(item.subtotal));
      withBdi = withBdi.plus(D(item.subtotalWithBdi));
    });
  });
  return { direct: direct.toString(), withBdi: withBdi.toString() };
}

/**
 * Carrega e normaliza os dados de uma revisão para geração de relatórios.
 */
export async function loadReportBundle(params: {
  userId: string;
  budgetId: string;
  revisionId: string;
}): Promise<ReportBundle> {
  const revision = await prisma.budgetRevision.findFirst({
    where: {
      id: params.revisionId,
      budgetId: params.budgetId,
      budget: { userId: params.userId },
    },
    include: {
      budget: {
        include: {
          project: {
            include: { client: { select: { name: true } } },
          },
        },
      },
      bdiConfig: true,
      snapshot: true,
      auditResults: {
        orderBy: [{ severity: "asc" }, { type: "asc" }, { id: "asc" }],
      },
      stages: {
        orderBy: { sortOrder: "asc" },
        include: {
          items: {
            orderBy: { sortOrder: "asc" },
            include: {
              composition: {
                select: {
                  id: true,
                  code: true,
                  description: true,
                  unit: true,
                  type: true,
                },
              },
              bdiOverride: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  if (!revision) {
    throw new Error("Revisão não encontrada para este usuário.");
  }

  const profile = await prisma.professionalProfile.findUnique({
    where: { userId: params.userId },
  });

  const headerDefaults: ReportHeaderOptions = {
    companyName: profile?.companyName ?? null,
    cnpj: profile?.cnpj ?? null,
    professionalName: profile?.professionalName ?? null,
    registrationType: profile?.registrationType ?? null,
    registrationNumber: profile?.registrationNumber ?? null,
    customTitle: null,
    footer: null,
    includeChecksum: true,
  };

  const snapshotData = revision.snapshot?.snapshotData as
    | {
        metadata?: SnapshotMetadata;
        stages?: SnapshotStage[];
        auditResults?: ReportAuditFindingInput[];
      }
    | undefined;

  if (snapshotData) {
    const snapshotMeta = snapshotData.metadata;
    const { stages, resources } = stagesFromSnapshot(snapshotData);

    const metadata: ReportRevisionMetadata = {
      budgetTitle: snapshotMeta?.budgetTitle ?? revision.budget.title,
      revisionNumber: snapshotMeta?.revisionNumber ?? revision.revisionNumber,
      projectName: snapshotMeta?.projectName ?? revision.budget.project.name,
      clientName:
        snapshotMeta?.clientName ?? revision.budget.project.client?.name ?? null,
      technicalResponsible:
        snapshotMeta?.technicalResponsible ?? revision.technicalResponsible,
      baseDate: snapshotMeta?.baseDate ?? revision.baseDate?.toISOString() ?? null,
      referenceState:
        snapshotMeta?.referenceState ?? revision.referenceState ?? null,
      referenceMonth:
        snapshotMeta?.referenceMonth ?? revision.referenceMonth ?? null,
      referenceTaxRegime:
        snapshotMeta?.referenceTaxRegime ?? revision.referenceTaxRegime ?? null,
      bdiConfig:
        mapBdi(snapshotMeta?.bdiConfig) ??
        (revision.bdiConfig
          ? mapBdi({
              name: revision.bdiConfig.name,
              bdiRate: revision.bdiConfig.bdiRate.toString(),
              ac: revision.bdiConfig.ac.toString(),
              cf: revision.bdiConfig.cf.toString(),
              s: revision.bdiConfig.s.toString(),
              g: revision.bdiConfig.g.toString(),
              mi: revision.bdiConfig.mi.toString(),
              tm: revision.bdiConfig.tm.toString(),
              te: revision.bdiConfig.te.toString(),
              tf: revision.bdiConfig.tf.toString(),
              l: revision.bdiConfig.l.toString(),
            })
          : null),
      roundingMode: snapshotMeta?.rounding?.mode ?? revision.roundingMode,
      roundingTotalDecimals:
        snapshotMeta?.rounding?.totalDecimals ?? revision.roundingTotalDecimals,
      snapshotChecksum: revision.snapshot?.checksum ?? null,
      finalizedAt:
        revision.snapshot?.createdAt.toISOString() ??
        revision.finalizedAt?.toISOString() ??
        null,
    };

    const auditFindings: ReportAuditFindingInput[] =
      Array.isArray(snapshotData.auditResults) && snapshotData.auditResults.length > 0
        ? snapshotData.auditResults
        : revision.auditResults.map((result) => ({
            type: result.type,
            severity: result.severity as "ERROR" | "WARNING" | "INFO",
            code: result.code,
            message: result.message,
            entityType: result.entityType,
            entityId: result.entityId,
            field: result.field,
            justification: result.justification,
            resolvedAt: result.resolvedAt?.toISOString() ?? null,
          }));

    const expectedTotals =
      snapshotMeta?.totals?.direct !== undefined &&
      snapshotMeta?.totals?.withBdi !== undefined
        ? {
            direct: snapshotMeta.totals.direct,
            withBdi: snapshotMeta.totals.withBdi,
          }
        : sumExpected(stages);
    const input: ReportInput = {
      metadata,
      stages,
      resources,
      auditFindings,
      expectedTotals,
    };

    return {
      input,
      source: "SNAPSHOT",
      reconciliation: reconcileReportTotals({
        source: "SNAPSHOT",
        stages,
        expected: expectedTotals,
      }),
      headerDefaults,
      checksum: revision.snapshot?.checksum ?? null,
      budgetTitle: metadata.budgetTitle,
      revisionNumber: metadata.revisionNumber,
    };
  }

  // Rascunho: lê o banco transacional e expande as composições em insumos.
  const catalogCache = new Map<string, Map<string, CompositionInput>>();
  const getCatalog = async (compositionId: string) => {
    const cached = catalogCache.get(compositionId);
    if (cached) return cached;
    const catalog = await loadCompositionCatalog(compositionId, {
      userId: params.userId,
    });
    catalogCache.set(compositionId, catalog);
    return catalog;
  };

  const stages: ReportStage[] = [];
  const resources: ReportResourceLineInput[] = [];

  for (const stage of revision.stages) {
    const items = [];
    for (const item of stage.items) {
      const itemQuantity = D(item.quantity);
      const catalog = await getCatalog(item.composition.id);
      const expanded: ExpandedResource[] = expandCompositionResources(
        item.composition.id,
        catalog
      );

      expanded.forEach((resource) => {
        const coefficient = D(resource.coefficient);
        const consumed = itemQuantity.times(coefficient);
        resources.push({
          code: resource.code,
          description: resource.description,
          unit: resource.unit,
          category: resource.category,
          coefficient: coefficient.toString(),
          price: resource.price,
          quantity: consumed.toString(),
          total: consumed.times(D(resource.price)).toString(),
          synthetic: resource.synthetic,
          compositionCode: resource.compositionCode,
        });
      });

      items.push({
        id: item.id,
        compositionCode: item.composition.code,
        compositionDescription: item.composition.description,
        unit: item.composition.unit,
        compositionType:
          item.composition.type === "CLOSED" ? ("CLOSED" as const) : ("ANALYTICAL" as const),
        quantity: item.quantity.toString(),
        unitCostMaterial: item.unitCostMaterial.toString(),
        unitCostLabor: item.unitCostLabor.toString(),
        unitCostEquipment: item.unitCostEquipment.toString(),
        unitCostOther: item.unitCostOther.toString(),
        unitCostTotal: item.unitCostTotal.toString(),
        subtotal: item.subtotal.toString(),
        bdiRate: item.bdiRate.toString(),
        subtotalWithBdi: item.subtotalWithBdi.toString(),
        notes: item.notes,
        bdiConfigName: item.bdiOverride?.name ?? null,
      });
    }

    stages.push({
      id: stage.id,
      code: stage.code,
      title: stage.title,
      parentStageId: stage.parentStageId,
      sortOrder: stage.sortOrder,
      items,
    });
  }

  const metadata: ReportRevisionMetadata = {
    budgetTitle: revision.budget.title,
    revisionNumber: revision.revisionNumber,
    projectName: revision.budget.project.name,
    clientName: revision.budget.project.client?.name ?? null,
    technicalResponsible: revision.technicalResponsible,
    baseDate: revision.baseDate?.toISOString() ?? null,
    referenceState: revision.referenceState,
    referenceMonth: revision.referenceMonth,
    referenceTaxRegime: revision.referenceTaxRegime,
    bdiConfig: revision.bdiConfig
      ? {
          name: revision.bdiConfig.name,
          bdiRate: revision.bdiConfig.bdiRate.toString(),
          ac: revision.bdiConfig.ac.toString(),
          cf: revision.bdiConfig.cf.toString(),
          s: revision.bdiConfig.s.toString(),
          g: revision.bdiConfig.g.toString(),
          mi: revision.bdiConfig.mi.toString(),
          tm: revision.bdiConfig.tm.toString(),
          te: revision.bdiConfig.te.toString(),
          tf: revision.bdiConfig.tf.toString(),
          l: revision.bdiConfig.l.toString(),
        }
      : null,
    roundingMode: revision.roundingMode,
    roundingTotalDecimals: revision.roundingTotalDecimals,
    snapshotChecksum: null,
    finalizedAt: revision.finalizedAt?.toISOString() ?? null,
  };

  const auditFindings: ReportAuditFindingInput[] = revision.auditResults.map(
    (result) => ({
      type: result.type,
      severity: result.severity as "ERROR" | "WARNING" | "INFO",
      code: result.code,
      message: result.message,
      entityType: result.entityType,
      entityId: result.entityId,
      field: result.field,
      justification: result.justification,
      resolvedAt: result.resolvedAt?.toISOString() ?? null,
    })
  );

  const expectedTotals = sumExpected(stages);
  const input: ReportInput = {
    metadata,
    stages,
    resources,
    auditFindings,
    expectedTotals,
  };

  return {
    input,
    source: "DATABASE",
    reconciliation: reconcileReportTotals({
      source: "DATABASE",
      stages,
      expected: expectedTotals,
    }),
    headerDefaults,
    checksum: null,
    budgetTitle: metadata.budgetTitle,
    revisionNumber: metadata.revisionNumber,
  };
}
