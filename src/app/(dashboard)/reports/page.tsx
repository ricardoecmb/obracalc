import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db/prisma";
import { redirect } from "next/navigation";
import { ReportsPanel } from "./reports-panel";

export const metadata: Metadata = {
  title: "Relatórios | ObraCalc",
  description: "Geração de relatórios analíticos, sintéticos, curva ABC e memória de BDI.",
};

export default async function ReportsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  // Obter orçamentos com revisões
  const [budgets, profile] = await Promise.all([
    prisma.budget.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        title: true,
        project: { select: { name: true, state: true } },
        revisions: {
          select: {
            id: true,
            revisionNumber: true,
            status: true,
            referenceState: true,
            referenceMonth: true,
            _count: { select: { stages: true } },
          },
          orderBy: { revisionNumber: "desc" },
        },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.professionalProfile.findUnique({
      where: { userId: user.id },
      select: {
        companyName: true,
        cnpj: true,
        professionalName: true,
        registrationType: true,
        registrationNumber: true,
      },
    }),
  ]);

  const serialized = budgets
    .filter((b) => b.revisions.length > 0)
    .map((b) => ({
      id: b.id,
      title: b.title,
      projectName: b.project.name,
      projectState: b.project.state,
      revisions: b.revisions.map((r) => ({
        id: r.id,
        revisionNumber: r.revisionNumber,
        status: r.status,
        referenceState: r.referenceState,
        referenceMonth: r.referenceMonth,
        stagesCount: r._count.stages,
      })),
    }));

  return (
    <ReportsPanel
      budgets={serialized}
      headerDefaults={{
        companyName: profile?.companyName ?? null,
        cnpj: profile?.cnpj ?? null,
        professionalName: profile?.professionalName ?? null,
        registrationType: profile?.registrationType ?? null,
        registrationNumber: profile?.registrationNumber ?? null,
      }}
    />
  );
}
