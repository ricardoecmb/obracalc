import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db/prisma";
import { redirect } from "next/navigation";
import { BudgetsList, type BudgetItemSummary } from "./budgets-list";

export const metadata: Metadata = {
  title: "Orçamentos | ObraCalc",
  description: "Gerenciamento de planilhas orçamentárias e revisões.",
};

export default async function BudgetsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const budgets = await prisma.budget.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
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
          _count: {
            select: { stages: true },
          },
          stages: {
            include: {
              items: {
                select: {
                  subtotal: true,
                  subtotalWithBdi: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const serialized: BudgetItemSummary[] = budgets.map((b) => ({
    id: b.id,
    title: b.title,
    description: b.description,
    status: b.status,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
    project: {
      id: b.project.id,
      name: b.project.name,
      state: b.project.state,
      client: b.project.client ? { name: b.project.client.name } : null,
    },
    revisions: b.revisions.map((rev) => ({
      id: rev.id,
      revisionNumber: rev.revisionNumber,
      status: rev.status as "DRAFT" | "FINALIZED",
      referenceState: rev.referenceState,
      referenceMonth: rev.referenceMonth,
      referenceTaxRegime: rev.referenceTaxRegime,
      bdiConfig: rev.bdiConfig
        ? {
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
      _count: rev._count,
      stages: rev.stages.map((st) => ({
        items: st.items.map((it) => ({
          subtotal: it.subtotal.toString(),
          subtotalWithBdi: it.subtotalWithBdi.toString(),
        })),
      })),
    })),
  }));

  return <BudgetsList budgets={serialized} />;
}
