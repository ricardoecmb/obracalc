import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db/prisma";
import { redirect, notFound } from "next/navigation";
import { BudgetEditor, type RevisionDto } from "./budget-editor";

interface BudgetPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: BudgetPageProps): Promise<Metadata> {
  const { id } = await params;
  const budget = await prisma.budget.findUnique({
    where: { id },
    select: { title: true },
  });

  return {
    title: budget ? `${budget.title} | ObraCalc` : "Planilha Orçamentária | ObraCalc",
  };
}

export default async function BudgetDetailsPage({ params }: BudgetPageProps) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  // Obter orçamento com suas revisões completas e EAP
  const budget = await prisma.budget.findFirst({
    where: {
      id,
      userId: user.id,
    },
    include: {
      project: {
        select: {
          id: true,
          name: true,
          state: true,
          client: {
            select: { name: true },
          },
        },
      },
      revisions: {
        orderBy: { revisionNumber: "desc" },
        include: {
          bdiConfig: {
            select: {
              id: true,
              name: true,
              bdiRate: true,
            },
          },
          snapshot: {
            select: {
              checksum: true,
              createdAt: true,
            },
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
                      source: true,
                      type: true,
                    },
                  },
                  bdiOverride: {
                    select: {
                      id: true,
                      name: true,
                      bdiRate: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!budget) {
    notFound();
  }

  // Obter opções de BDI para seleção de overrides
  const bdiConfigs = await prisma.bdiConfig.findMany({
    where: { userId: user.id, active: true },
    select: {
      id: true,
      name: true,
      bdiRate: true,
    },
    orderBy: { name: "asc" },
  });

  const budgetTemplates = await prisma.budgetTemplate.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, description: true, templateData: true },
  });

  // Mapear dados serializados seguros
  const serializedRevisions: RevisionDto[] = budget.revisions.map((rev) => ({
    id: rev.id,
    revisionNumber: rev.revisionNumber,
    status: rev.status as "DRAFT" | "FINALIZED",
    referenceState: rev.referenceState,
    referenceMonth: rev.referenceMonth,
    referenceTaxRegime: rev.referenceTaxRegime,
    technicalResponsible: rev.technicalResponsible,
    baseDate: rev.baseDate?.toISOString() ?? null,
    roundingPriceDecimals: rev.roundingPriceDecimals,
    roundingQuantityDecimals: rev.roundingQuantityDecimals,
    roundingCoefficientDecimals: rev.roundingCoefficientDecimals,
    roundingTotalDecimals: rev.roundingTotalDecimals,
    roundingMode: rev.roundingMode,
    bdiConfig: rev.bdiConfig
      ? {
          id: rev.bdiConfig.id,
          name: rev.bdiConfig.name,
          bdiRate: rev.bdiConfig.bdiRate.toString(),
        }
      : null,
    snapshot: rev.snapshot
      ? {
          checksum: rev.snapshot.checksum,
          createdAt: rev.snapshot.createdAt.toISOString(),
        }
      : null,
    stages: rev.stages.map((st) => ({
      id: st.id,
      parentStageId: st.parentStageId,
      code: st.code,
      title: st.title,
      description: st.description,
      sortOrder: st.sortOrder,
      items: st.items.map((it) => ({
        id: it.id,
        stageId: it.stageId,
        compositionId: it.compositionId,
        sortOrder: it.sortOrder,
        quantity: it.quantity.toString(),
        bdiOverrideId: it.bdiOverrideId,
        unitCostMaterial: it.unitCostMaterial.toString(),
        unitCostLabor: it.unitCostLabor.toString(),
        unitCostEquipment: it.unitCostEquipment.toString(),
        unitCostOther: it.unitCostOther.toString(),
        unitCostTotal: it.unitCostTotal.toString(),
        subtotal: it.subtotal.toString(),
        bdiRate: it.bdiRate.toString(),
        subtotalWithBdi: it.subtotalWithBdi.toString(),
        notes: it.notes,
        composition: {
          id: it.composition.id,
          code: it.composition.code,
          description: it.composition.description,
          unit: it.composition.unit,
          source: it.composition.source,
          type: it.composition.type,
        },
        bdiOverride: it.bdiOverride
          ? {
              id: it.bdiOverride.id,
              name: it.bdiOverride.name,
              bdiRate: it.bdiOverride.bdiRate.toString(),
            }
          : null,
      })),
    })),
  }));

  return (
    <BudgetEditor
      budgetId={budget.id}
      budgetTitle={budget.title}
      budgetDescription={budget.description}
      project={{
        id: budget.project.id,
        name: budget.project.name,
        state: budget.project.state,
        client: budget.project.client ? { name: budget.project.client.name } : null,
      }}
      revisions={serializedRevisions}
      bdiConfigs={bdiConfigs.map((b) => ({
        id: b.id,
        name: b.name,
        bdiRate: b.bdiRate.toString(),
      }))}
      templates={budgetTemplates.map((template) => {
        const data = template.templateData as {
          stages?: Array<{ items?: unknown[] }>;
        };
        const stages = Array.isArray(data?.stages) ? data.stages : [];
        return {
          id: template.id,
          name: template.name,
          description: template.description,
          stageCount: stages.length,
          itemCount: stages.reduce(
            (sum, stage) => sum + (Array.isArray(stage.items) ? stage.items.length : 0),
            0
          ),
        };
      })}
    />
  );
}
