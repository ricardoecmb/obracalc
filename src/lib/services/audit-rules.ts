import Decimal from "decimal.js";
import { prisma } from "@/lib/db/prisma";
import { createAuditEntry } from "@/lib/db/audit";
import { calculateBdi } from "@/lib/engine/bdi";
import { defaultUnitConverter } from "@/lib/engine/units";

/**
 * Motor de auditoria determinístico do ObraCalc.
 *
 * As regras são puras: recebem uma fotografia da revisão e devolvem achados
 * estáveis (tipo, severidade, código, entidade e campo). A persistência é
 * feita separadamente, preservando justificativas já registradas.
 */

export type AuditFindingType =
  | "MISSING_PRICE"
  | "INCOMPLETE_COMPOSITION"
  | "INVALID_QUANTITY"
  | "INVALID_BDI"
  | "INCOMPATIBLE_UNITS"
  | "BROKEN_REFERENCE"
  | "DUPLICATE_CHARGES"
  | "DIVERGENT_SOURCE"
  | "OTHER";

export type AuditFindingSeverity = "ERROR" | "WARNING" | "INFO";

export interface AuditFinding {
  type: AuditFindingType;
  severity: AuditFindingSeverity;
  code: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  field: string | null;
}

export interface AuditComponentInput {
  id: string;
  coefficient: string;
  resourceId: string | null;
  childCompositionId: string | null;
  resource: {
    id: string;
    code: string;
    description: string;
    unit: string;
    price: string;
    category: string;
    laborChargesIncluded: boolean;
    laborChargesRate: string | null;
  } | null;
  childComposition: {
    id: string;
    code: string;
    description: string;
    unit: string;
    type: string;
    closedTotalPrice: string | null;
  } | null;
}

export interface AuditCompositionInput {
  id: string;
  code: string;
  description: string;
  unit: string;
  type: string;
  closedTotalPrice: string | null;
  components: AuditComponentInput[];
}

export interface AuditItemInput {
  id: string;
  quantity: string;
  bdiRate: string;
  bdiOverrideId: string | null;
  unitCostTotal: string;
  composition: AuditCompositionInput;
}

export interface AuditStageInput {
  id: string;
  code: string;
  title: string;
  items: AuditItemInput[];
}

export interface AuditRevisionInput {
  id: string;
  revisionNumber: number;
  bdiConfig: {
    id: string;
    name: string;
    bdiRate: string;
    ac: string;
    cf: string;
    s: string;
    g: string;
    mi: string;
    tm: string;
    te: string;
    tf: string;
    l: string;
  } | null;
  stages: AuditStageInput[];
}

function safeDecimal(value: string | null | undefined): Decimal | null {
  if (value === null || value === undefined) return null;
  try {
    const decimal = new Decimal(value);
    return decimal.isFinite() ? decimal : null;
  } catch {
    return null;
  }
}

function findingKey(finding: AuditFinding): string {
  return [
    finding.type,
    finding.entityType ?? "",
    finding.entityId ?? "",
    finding.field ?? "",
    finding.code,
    finding.message,
  ].join("|");
}

function pushFinding(target: AuditFinding[], finding: AuditFinding): void {
  target.push(finding);
}

/**
 * Executa todas as regras críticas e alertas sobre uma revisão.
 */
export function runAuditRules(revision: AuditRevisionInput): AuditFinding[] {
  const findings: AuditFinding[] = [];

  // -------------------------------------------------------------------------
  // BDI da revisão (Acórdão TCU 2622/2013)
  // -------------------------------------------------------------------------
  if (revision.bdiConfig) {
    const component = (value: string) => new Decimal(value).times(100);
    try {
      const bdi = calculateBdi({
        ac: component(revision.bdiConfig.ac),
        cf: component(revision.bdiConfig.cf),
        s: component(revision.bdiConfig.s),
        g: component(revision.bdiConfig.g),
        mi: component(revision.bdiConfig.mi),
        tm: component(revision.bdiConfig.tm),
        te: component(revision.bdiConfig.te),
        tf: component(revision.bdiConfig.tf),
        l: component(revision.bdiConfig.l),
      });

      if (!bdi.isValid) {
        pushFinding(findings, {
          type: "INVALID_BDI",
          severity: "ERROR",
          code: "INVALID_BDI",
          message: `Configuração de BDI "${revision.bdiConfig.name}" é inválida: ${bdi.validationErrors.join(" ")}`.trim(),
          entityType: "BudgetRevision",
          entityId: revision.id,
          field: "bdiConfigId",
        });
      }
    } catch {
      pushFinding(findings, {
        type: "INVALID_BDI",
        severity: "ERROR",
        code: "INVALID_BDI",
        message: `Configuração de BDI "${revision.bdiConfig.name}" possui valores não numéricos.`,
        entityType: "BudgetRevision",
        entityId: revision.id,
        field: "bdiConfigId",
      });
    }
  }

  for (const stage of revision.stages) {
    for (const item of stage.items) {
      const composition = item.composition;
      const compositionLabel = `${composition.code} — ${composition.description}`;

      // ---------------------------------------------------------------------
      // Quantidade inválida
      // ---------------------------------------------------------------------
      const quantity = safeDecimal(item.quantity);
      if (!quantity || quantity.lessThanOrEqualTo(0)) {
        pushFinding(findings, {
          type: "INVALID_QUANTITY",
          severity: "ERROR",
          code: "INVALID_QUANTITY",
          message: `Quantidade inválida no item ${compositionLabel}: "${item.quantity}".`,
          entityType: "BudgetItem",
          entityId: item.id,
          field: "quantity",
        });
      }

      // ---------------------------------------------------------------------
      // BDI do item (taxa efetiva persistida)
      // ---------------------------------------------------------------------
      const itemBdi = safeDecimal(item.bdiRate);
      if (
        !itemBdi ||
        itemBdi.isNegative() ||
        itemBdi.greaterThanOrEqualTo(100)
      ) {
        pushFinding(findings, {
          type: "INVALID_BDI",
          severity: "ERROR",
          code: "INVALID_BDI",
          message: `Taxa de BDI inválida no item ${compositionLabel}: "${item.bdiRate}". Deve estar entre 0% e 100%.`,
          entityType: "BudgetItem",
          entityId: item.id,
          field: "bdiRate",
        });
      }

      // ---------------------------------------------------------------------
      // Preço ausente
      // ---------------------------------------------------------------------
      const totalCost = safeDecimal(item.unitCostTotal);
      const closedPrice = safeDecimal(composition.closedTotalPrice);
      const isClosed =
        composition.type === "CLOSED" ||
        (composition.components.length === 0 && composition.closedTotalPrice !== null);

      if (isClosed && (!closedPrice || closedPrice.lessThanOrEqualTo(0))) {
        pushFinding(findings, {
          type: "MISSING_PRICE",
          severity: "ERROR",
          code: "MISSING_PRICE",
          message: `Composição fechada ${compositionLabel} está sem preço de origem.`,
          entityType: "BudgetItem",
          entityId: item.id,
          field: "composition.closedTotalPrice",
        });
      }

      if (!isClosed && totalCost && totalCost.lessThanOrEqualTo(0)) {
        pushFinding(findings, {
          type: "MISSING_PRICE",
          severity: "ERROR",
          code: "MISSING_PRICE",
          message: `Item ${compositionLabel} está com custo unitário zerado ou ausente.`,
          entityType: "BudgetItem",
          entityId: item.id,
          field: "unitCostTotal",
        });
      }

      // ---------------------------------------------------------------------
      // Composição incompleta e referências quebradas
      // ---------------------------------------------------------------------
      if (!isClosed && composition.components.length === 0) {
        pushFinding(findings, {
          type: "INCOMPLETE_COMPOSITION",
          severity: "ERROR",
          code: "INCOMPLETE_COMPOSITION",
          message: `Composição analítica ${compositionLabel} não possui componentes nem preço fechado.`,
          entityType: "BudgetItem",
          entityId: item.id,
          field: "compositionId",
        });
      }

      for (const component of composition.components) {
        const coefficient = safeDecimal(component.coefficient);
        if (!coefficient || coefficient.lessThanOrEqualTo(0)) {
          pushFinding(findings, {
            type: "INCOMPLETE_COMPOSITION",
            severity: "ERROR",
            code: "INCOMPLETE_COMPOSITION",
            message: `Componente com coeficiente inválido (${component.coefficient}) na composição ${compositionLabel}.`,
            entityType: "BudgetItem",
            entityId: item.id,
            field: `components.${component.id}.coefficient`,
          });
        }

        if (!component.resourceId && !component.childCompositionId) {
          pushFinding(findings, {
            type: "INCOMPLETE_COMPOSITION",
            severity: "ERROR",
            code: "INCOMPLETE_COMPOSITION",
            message: `Componente sem insumo e sem subcomposição na composição ${compositionLabel}.`,
            entityType: "BudgetItem",
            entityId: item.id,
            field: `components.${component.id}`,
          });
        }

        if (component.childCompositionId && !component.childComposition) {
          pushFinding(findings, {
            type: "BROKEN_REFERENCE",
            severity: "ERROR",
            code: "BROKEN_REFERENCE",
            message: `Subcomposição ausente na composição ${compositionLabel}.`,
            entityType: "BudgetItem",
            entityId: item.id,
            field: `components.${component.id}.childCompositionId`,
          });
        }

        // -------------------------------------------------------------------
        // Preço ausente em insumo
        // -------------------------------------------------------------------
        if (component.resource) {
          const resourcePrice = safeDecimal(component.resource.price);
          if (!resourcePrice || resourcePrice.lessThanOrEqualTo(0)) {
            pushFinding(findings, {
              type: "MISSING_PRICE",
              severity: "ERROR",
              code: "MISSING_PRICE",
              message: `Insumo ${component.resource.code} — ${component.resource.description} está sem preço válido.`,
              entityType: "BudgetItem",
              entityId: item.id,
              field: `components.${component.id}.resource.price`,
            });
          }

          // -----------------------------------------------------------------
          // Alerta: encargos sociais potencialmente duplicados
          // -----------------------------------------------------------------
          const chargesRate = safeDecimal(component.resource.laborChargesRate);
          if (
            component.resource.category === "LABOR" &&
            component.resource.laborChargesIncluded &&
            chargesRate &&
            chargesRate.greaterThan(0)
          ) {
            pushFinding(findings, {
              type: "DUPLICATE_CHARGES",
              severity: "WARNING",
              code: "DUPLICATE_CHARGES",
              message: `Insumo de mão de obra ${component.resource.code} já inclui encargos, mas possui taxa de encargos configurada (${chargesRate.toString()}%). Verifique duplicidade.`,
              entityType: "BudgetItem",
              entityId: item.id,
              field: `components.${component.id}.resource.laborChargesRate`,
            });
          }
        }

        // -------------------------------------------------------------------
        // Unidade incompatível
        // -------------------------------------------------------------------
        if (component.resource && !component.resource.unit.trim()) {
          pushFinding(findings, {
            type: "INCOMPATIBLE_UNITS",
            severity: "ERROR",
            code: "INCOMPATIBLE_UNITS",
            message: `Insumo ${component.resource.code} está sem unidade de medida.`,
            entityType: "BudgetItem",
            entityId: item.id,
            field: `components.${component.id}.resource.unit`,
          });
        }

        if (component.childComposition) {
          const parentUnit = composition.unit;
          const childUnit = component.childComposition.unit;
          const parentDimension = parentUnit
            ? defaultUnitConverter.dimensionOf(parentUnit)
            : undefined;
          const childDimension = childUnit
            ? defaultUnitConverter.dimensionOf(childUnit)
            : undefined;

          if (
            parentUnit &&
            childUnit &&
            parentDimension &&
            childDimension &&
            parentDimension !== "OTHER" &&
            childDimension !== "OTHER" &&
            parentDimension !== childDimension &&
            !defaultUnitConverter.canConvert(childUnit, parentUnit)
          ) {
            pushFinding(findings, {
              type: "INCOMPATIBLE_UNITS",
              severity: "ERROR",
              code: "INCOMPATIBLE_UNITS",
              message: `Subcomposição ${component.childComposition.code} usa unidade ${childUnit}, incompatível com a unidade ${parentUnit} da composição ${composition.code}.`,
              entityType: "BudgetItem",
              entityId: item.id,
              field: `components.${component.id}.childCompositionId`,
            });
          }
        }
      }

      if (!composition.unit.trim()) {
        pushFinding(findings, {
          type: "INCOMPATIBLE_UNITS",
          severity: "ERROR",
          code: "INCOMPATIBLE_UNITS",
          message: `Composição ${compositionLabel} está sem unidade de medida.`,
          entityType: "BudgetItem",
          entityId: item.id,
          field: "compositionId",
        });
      }
    }
  }

  // Deduplica achados idênticos preservando a ordem determinística.
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = findingKey(finding);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const auditInclude = {
  bdiConfig: true,
  stages: {
    orderBy: { sortOrder: "asc" as const },
    include: {
      items: {
        orderBy: { sortOrder: "asc" as const },
        include: {
          composition: {
            include: {
              components: {
                orderBy: { sortOrder: "asc" as const },
                include: {
                  resource: true,
                  childComposition: {
                    select: {
                      id: true,
                      code: true,
                      description: true,
                      unit: true,
                      type: true,
                      closedTotalPrice: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

/**
 * Carrega a revisão do usuário e converte para a entrada pura do motor.
 */
export async function loadAuditInput(params: {
  revisionId: string;
  userId: string;
}): Promise<AuditRevisionInput> {
  const revision = await prisma.budgetRevision.findFirst({
    where: { id: params.revisionId, budget: { userId: params.userId } },
    include: auditInclude,
  });

  if (!revision) {
    throw new Error("Revisão não encontrada para auditoria.");
  }

  return {
    id: revision.id,
    revisionNumber: revision.revisionNumber,
    bdiConfig: revision.bdiConfig
      ? {
          id: revision.bdiConfig.id,
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
    stages: revision.stages.map((stage) => ({
      id: stage.id,
      code: stage.code,
      title: stage.title,
      items: stage.items.map((item) => ({
        id: item.id,
        quantity: item.quantity.toString(),
        bdiRate: item.bdiRate.toString(),
        bdiOverrideId: item.bdiOverrideId,
        unitCostTotal: item.unitCostTotal.toString(),
        composition: {
          id: item.composition.id,
          code: item.composition.code,
          description: item.composition.description,
          unit: item.composition.unit,
          type: item.composition.type,
          closedTotalPrice: item.composition.closedTotalPrice?.toString() ?? null,
          components: item.composition.components.map((component) => ({
            id: component.id,
            coefficient: component.coefficient.toString(),
            resourceId: component.resourceId,
            childCompositionId: component.childCompositionId,
            resource: component.resource
              ? {
                  id: component.resource.id,
                  code: component.resource.code,
                  description: component.resource.description,
                  unit: component.resource.unit,
                  price: component.resource.price.toString(),
                  category: component.resource.category,
                  laborChargesIncluded: component.resource.laborChargesIncluded,
                  laborChargesRate: component.resource.laborChargesRate?.toString() ?? null,
                }
              : null,
            childComposition: component.childComposition
              ? {
                  id: component.childComposition.id,
                  code: component.childComposition.code,
                  description: component.childComposition.description,
                  unit: component.childComposition.unit,
                  type: component.childComposition.type,
                  closedTotalPrice:
                    component.childComposition.closedTotalPrice?.toString() ?? null,
                }
              : null,
          })),
        },
      })),
    })),
  };
}

function persistedKey(result: {
  type: string;
  entityType: string | null;
  entityId: string | null;
  field: string | null;
  code: string;
  message: string;
}): string {
  return [
    result.type,
    result.entityType ?? "",
    result.entityId ?? "",
    result.field ?? "",
    result.code,
    result.message,
  ].join("|");
}

/**
 * Persiste os achados preservando justificativas de alertas já registradas.
 */
export async function persistAuditResults(
  revisionId: string,
  findings: AuditFinding[]
) {
  const existing = await prisma.auditResult.findMany({
    where: { budgetRevisionId: revisionId },
    select: {
      type: true,
      entityType: true,
      entityId: true,
      field: true,
      code: true,
      message: true,
      justification: true,
      resolvedAt: true,
    },
  });

  const preserved = new Map(
    existing
      .filter((entry) => entry.justification)
      .map((entry) => [
        persistedKey(entry),
        { justification: entry.justification, resolvedAt: entry.resolvedAt },
      ])
  );

  await prisma.$transaction(async (tx) => {
    await tx.auditResult.deleteMany({ where: { budgetRevisionId: revisionId } });

    for (const finding of findings) {
      const previous = preserved.get(persistedKey(finding));
      await tx.auditResult.create({
        data: {
          budgetRevisionId: revisionId,
          type: finding.type,
          severity: finding.severity,
          code: finding.code,
          message: finding.message,
          entityType: finding.entityType,
          entityId: finding.entityId,
          field: finding.field,
          justification: previous?.justification ?? null,
          resolvedAt: previous?.resolvedAt ?? null,
        },
      });
    }
  });

  return prisma.auditResult.findMany({
    where: { budgetRevisionId: revisionId },
    orderBy: [{ severity: "asc" }, { type: "asc" }, { id: "asc" }],
  });
}

export interface RunAuditResult {
  findings: AuditFinding[];
  errors: number;
  warnings: number;
  infos: number;
}

/**
 * Executa e persiste a auditoria de uma revisão.
 */
export async function runRevisionAudit(params: {
  revisionId: string;
  userId: string;
}): Promise<RunAuditResult> {
  const input = await loadAuditInput(params);
  const findings = runAuditRules(input);
  await persistAuditResults(params.revisionId, findings);

  return {
    findings,
    errors: findings.filter((finding) => finding.severity === "ERROR").length,
    warnings: findings.filter((finding) => finding.severity === "WARNING").length,
    infos: findings.filter((finding) => finding.severity === "INFO").length,
  };
}

/**
 * Justifica um alerta (WARNING/INFO). Erros críticos não podem ser
 * justificados: permanecem bloqueando a finalização.
 */
export async function justifyAuditResult(params: {
  auditResultId: string;
  userId: string;
  justification: string;
}) {
  const justification = params.justification.trim();
  if (justification.length < 5) {
    throw new Error("A justificativa deve ter pelo menos 5 caracteres.");
  }

  const result = await prisma.auditResult.findFirst({
    where: {
      id: params.auditResultId,
      budgetRevision: { budget: { userId: params.userId } },
    },
  });

  if (!result) {
    throw new Error("Achado de auditoria não encontrado.");
  }

  if (result.severity === "ERROR") {
    throw new Error("Erros críticos não podem ser justificados; corrija o orçamento.");
  }

  const updated = await prisma.auditResult.update({
    where: { id: result.id },
    data: { justification, resolvedAt: new Date() },
  });

  await createAuditEntry({
    userId: params.userId,
    entityType: "BudgetRevision",
    entityId: result.budgetRevisionId,
    action: "JUSTIFY_AUDIT_ALERT",
    metadata: {
      auditResultId: result.id,
      code: result.code,
      justification,
    },
  });

  return updated;
}
