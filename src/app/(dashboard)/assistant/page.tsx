import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db/prisma";
import { listAIProviders } from "@/lib/ai/config";
import { redirect } from "next/navigation";
import { AssistantPanel } from "./assistant-panel";

export const metadata: Metadata = {
  title: "Assistente IA | ObraCalc",
  description:
    "Busca assistida, análise de orçamentos e sugestões não vinculantes. Funciona sem IA.",
};

export default async function AssistantPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const [budgets, status] = await Promise.all([
    prisma.budget.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        title: true,
        project: { select: { name: true } },
        revisions: {
          select: {
            id: true,
            revisionNumber: true,
            status: true,
          },
          orderBy: { revisionNumber: "desc" },
        },
      },
      orderBy: { updatedAt: "desc" },
    }),
    listAIProviders(user.id),
  ]);

  const serialized = budgets
    .filter((budget) => budget.revisions.length > 0)
    .map((budget) => ({
      id: budget.id,
      title: budget.title,
      projectName: budget.project.name,
      revisions: budget.revisions.map((revision) => ({
        id: revision.id,
        revisionNumber: revision.revisionNumber,
        status: revision.status,
      })),
    }));

  return <AssistantPanel budgets={serialized} initialStatus={status} />;
}
