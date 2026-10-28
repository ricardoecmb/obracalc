import crypto from "crypto";
import { prisma } from "@/lib/db/prisma";
import { createAuditEntry } from "@/lib/db/audit";
import { loadCompositionCatalog } from "@/lib/services/composition-cost";
import { expandCompositionResources } from "@/lib/reports/resource-expansion";
import Decimal from "decimal.js";

/**
 * Serializa de forma determinística e canônica um objeto para garantir que
 * o hash SHA-256 seja idêntico independentemente da ordem das propriedades.
 */
export function canonicalJsonStringify(obj: unknown): string {
  if (obj === null || obj === undefined) {
    return "null";
  }
  if (typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (obj instanceof Decimal) {
    return JSON.stringify(obj.toString());
  }
  if (obj instanceof Date) {
    return JSON.stringify(obj.toISOString());
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map((item) => canonicalJsonStringify(item)).join(",") + "]";
  }

  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const entries = keys.map((key) => {
    const val = (obj as Record<string, unknown>)[key];
    return `${JSON.stringify(key)}:${canonicalJsonStringify(val)}`;
  });
  return "{" + entries.join(",") + "}";
}

/**
 * Calcula o checksum SHA-256 canônico de qualquer dado serializável.
 */
export function computeSha256Checksum(data: unknown): string {
  const canonical = canonicalJsonStringify(data);
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

export class RevisionFinalizedError extends Error {
  constructor(message = "Esta revisão do orçamento já está finalizada e protegida por snapshot imutável.") {
    super(message);
    this.name = "RevisionFinalizedError";
  }
}

export class SnapshotImmutableError extends Error {
  constructor(message = "Snapshots são registros imutáveis e não podem ser alterados ou deletados.") {
    super(message);
    this.name = "SnapshotImmutableError";
  }
}

/**
 * Garante que a revisão de orçamento está em modo DRAFT.
 * Se já estiver FINALIZED, lança uma exceção de integridade.
 */
export async function assertRevisionMutable(budgetRevisionId: string): Promise<void> {
  const revision = await prisma.budgetRevision.findUnique({
    where: { id: budgetRevisionId },
    select: { status: true, revisionNumber: true },
  });

  if (!revision) {
    throw new Error(`Revisão de orçamento ${budgetRevisionId} não encontrada.`);
  }

  if (revision.status === "FINALIZED") {
    throw new RevisionFinalizedError(
      `A revisão ${revision.revisionNumber} do orçamento está finalizada e imutável. Crie uma nova revisão para realizar modificações.`
    );
  }
}

/**
 * Gera um Snapshot determinístico e imutável de uma revisão de orçamento.
 * Bloqueia futuras alterações na revisão e gera checksum criptográfico SHA-256.
 */
export async function createRevisionSnapshot(budgetRevisionId: string, userId: string) {
  // 1. Verificar se a revisão existe e se já não possui snapshot
  const revision = await prisma.budgetRevision.findUnique({
    where: { id: budgetRevisionId },
    include: {
      budget: {
        include: {
          project: {
            include: {
              client: true,
            },
          },
        },
      },
      referenceDatabase: true,
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
                include: {
                  components: {
                    include: {
                      resource: true,
                      childComposition: true,
                    },
                  },
                },
              },
              bdiOverride: true,
            },
          },
        },
      },
    },
  });

  if (!revision) {
    throw new Error(`Revisão de orçamento não encontrada.`);
  }

  if (revision.snapshot) {
    throw new Error(`Esta revisão já possui um snapshot de finalização gerado.`);
  }

  // 2. Expandir composições em insumos para que o snapshot seja autossuficiente.
  const catalogCache = new Map<
    string,
    Awaited<ReturnType<typeof loadCompositionCatalog>>
  >();
  const expansionCache = new Map<
    string,
    ReturnType<typeof expandCompositionResources>
  >();

  const expandedResourcesFor = async (compositionId: string) => {
    if (expansionCache.has(compositionId)) {
      return expansionCache.get(compositionId)!;
    }

    if (!catalogCache.has(compositionId)) {
      catalogCache.set(
        compositionId,
        await loadCompositionCatalog(compositionId, { userId })
      );
    }

    const expanded = expandCompositionResources(
      compositionId,
      catalogCache.get(compositionId)!
    );
    expansionCache.set(compositionId, expanded);
    return expanded;
  };

  const stageSnapshots = [];
  for (const stage of revision.stages) {
    const itemSnapshots = [];
    for (const item of stage.items) {
      const expandedResources = await expandedResourcesFor(item.compositionId);
      itemSnapshots.push({
        id: item.id,
        sortOrder: item.sortOrder,
        quantity: item.quantity.toString(),
        unitCostTotal: item.unitCostTotal.toString(),
        unitCostMaterial: item.unitCostMaterial.toString(),
        unitCostLabor: item.unitCostLabor.toString(),
        unitCostEquipment: item.unitCostEquipment.toString(),
        unitCostOther: item.unitCostOther.toString(),
        subtotal: item.subtotal.toString(),
        bdiRate: item.bdiRate.toString(),
        subtotalWithBdi: item.subtotalWithBdi.toString(),
        notes: item.notes,
        bdiConfigName: item.bdiOverride?.name ?? null,
        composition: {
          code: item.composition.code,
          description: item.composition.description,
          unit: item.composition.unit,
          source: item.composition.source,
          type: item.composition.type,
          components: item.composition.components.map((comp) => ({
            coefficient: comp.coefficient.toString(),
            resource: comp.resource
              ? {
                  code: comp.resource.code,
                  description: comp.resource.description,
                  unit: comp.resource.unit,
                  category: comp.resource.category,
                  price: comp.resource.price.toString(),
                }
              : null,
            childCompositionCode: comp.childComposition?.code ?? null,
          })),
        },
        bdiOverride: item.bdiOverride ? item.bdiOverride.bdiRate.toString() : null,
        expandedResources,
      });
    }

    stageSnapshots.push({
      id: stage.id,
      code: stage.code,
      title: stage.title,
      description: stage.description,
      parentStageId: stage.parentStageId,
      sortOrder: stage.sortOrder,
      items: itemSnapshots,
    });
  }

  // 3. Montar estrutura canônica do snapshot
  let snapshotDirect = new Decimal(0);
  let snapshotWithBdi = new Decimal(0);
  let snapshotItemsCount = 0;
  for (const stage of stageSnapshots) {
    for (const item of stage.items) {
      snapshotDirect = snapshotDirect.plus(new Decimal(item.subtotal));
      snapshotWithBdi = snapshotWithBdi.plus(new Decimal(item.subtotalWithBdi));
      snapshotItemsCount += 1;
    }
  }
  const snapshotBdiAmount = snapshotWithBdi.minus(snapshotDirect);
  const snapshotTotals = {
    direct: snapshotDirect.toString(),
    withBdi: snapshotWithBdi.toString(),
    bdiAmount: snapshotBdiAmount.toString(),
    effectiveBdi: snapshotDirect.gt(0)
      ? snapshotBdiAmount.dividedBy(snapshotDirect).times(100).toString()
      : "0",
    itemsCount: snapshotItemsCount,
  };

  const snapshotData = {
    metadata: {
      snapshotVersion: 2,
      budgetRevisionId: revision.id,
      revisionNumber: revision.revisionNumber,
      budgetId: revision.budgetId,
      budgetTitle: revision.budget.title,
      projectName: revision.budget.project.name,
      clientName: revision.budget.project.client?.name ?? null,
      technicalResponsible: revision.technicalResponsible,
      baseDate: revision.baseDate?.toISOString() ?? null,
      referenceState: revision.referenceState,
      referenceMonth: revision.referenceMonth,
      referenceTaxRegime: revision.referenceTaxRegime,
      totals: snapshotTotals,
      rounding: {
        mode: revision.roundingMode,
        priceDecimals: revision.roundingPriceDecimals,
        quantityDecimals: revision.roundingQuantityDecimals,
        coefficientDecimals: revision.roundingCoefficientDecimals,
        totalDecimals: revision.roundingTotalDecimals,
      },
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
    },
    stages: stageSnapshots,
    auditResults: revision.auditResults.map((auditResult) => ({
      type: auditResult.type,
      severity: auditResult.severity,
      code: auditResult.code,
      message: auditResult.message,
      entityType: auditResult.entityType,
      entityId: auditResult.entityId,
      field: auditResult.field,
      justification: auditResult.justification,
      resolvedAt: auditResult.resolvedAt?.toISOString() ?? null,
      createdAt: auditResult.createdAt.toISOString(),
    })),
  };

  // 4. Gerar checksum SHA-256
  const checksum = computeSha256Checksum(snapshotData);

  // 4. Gravar de forma atômica o snapshot e marcar a revisão como FINALIZED
  const result = await prisma.$transaction(async (tx) => {
    const createdSnapshot = await tx.revisionSnapshot.create({
      data: {
        budgetRevisionId: revision.id,
        snapshotData: snapshotData as object,
        checksum,
      },
    });

    await tx.budgetRevision.update({
      where: { id: revision.id },
      data: {
        status: "FINALIZED",
        finalizedAt: new Date(),
      },
    });

    return createdSnapshot;
  });

  // 5. Registrar auditoria
  await createAuditEntry({
    userId,
    entityType: "BudgetRevision",
    entityId: revision.id,
    action: "FINALIZE",
    metadata: {
      snapshotId: result.id,
      checksum,
      revisionNumber: revision.revisionNumber,
    },
  });

  return result;
}

/**
 * Valida a integridade matemática do snapshot comparando o checksum SHA-256 armazenado
 * com o hash recalculado a partir do snapshotData salvo no banco.
 */
export async function verifySnapshotIntegrity(snapshotId: string) {
  const snapshot = await prisma.revisionSnapshot.findUnique({
    where: { id: snapshotId },
  });

  if (!snapshot) {
    throw new Error(`Snapshot ${snapshotId} não encontrado.`);
  }

  const computedChecksum = computeSha256Checksum(snapshot.snapshotData);
  const isValid = computedChecksum === snapshot.checksum;

  return {
    snapshotId: snapshot.id,
    budgetRevisionId: snapshot.budgetRevisionId,
    storedChecksum: snapshot.checksum,
    computedChecksum,
    isValid,
    createdAt: snapshot.createdAt,
  };
}
