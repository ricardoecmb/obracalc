import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db/prisma";
import { redirect } from "next/navigation";
import { BudgetWizard } from "./budget-wizard";

export const metadata: Metadata = {
  title: "Novo Orçamento | ObraCalc",
  description: "Criação de nova planilha orçamentária e parametrização da EAP.",
};

export default async function NewBudgetPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  // 1. Obter Obras
  const projects = await prisma.project.findMany({
    where: { userId: user.id },
    select: {
      id: true,
      name: true,
      state: true,
      client: {
        select: { name: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  // 2. Obter BDIs configurados
  const bdiConfigs = await prisma.bdiConfig.findMany({
    where: { userId: user.id, active: true },
    select: {
      id: true,
      name: true,
      bdiRate: true,
      isDefault: true,
    },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });

  // 3. Obter Catálogos de Referência
  const referenceDatabases = await prisma.referenceDatabase.findMany({
    where: { userId: user.id, active: true },
    select: {
      id: true,
      name: true,
      source: true,
      state: true,
      referenceMonth: true,
      taxRegime: true,
    },
    orderBy: { name: "asc" },
  });

  // 4. Obter modelos de EAP do usuário
  const budgetTemplates = await prisma.budgetTemplate.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, description: true, templateData: true },
  });

  return (
    <BudgetWizard
      projects={projects.map((p) => ({
        id: p.id,
        name: p.name,
        state: p.state,
        clientName: p.client?.name ?? null,
      }))}
      bdiConfigs={bdiConfigs.map((b) => ({
        id: b.id,
        name: b.name,
        bdiRate: b.bdiRate.toString(),
        isDefault: b.isDefault,
      }))}
      referenceDatabases={referenceDatabases.map((db) => ({
        id: db.id,
        name: db.name,
        source: db.source,
        state: db.state,
        referenceMonth: db.referenceMonth,
        taxRegime: db.taxRegime,
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
