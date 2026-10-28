import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db/prisma";
import { redirect } from "next/navigation";
import { ProjectForm } from "./project-form";

export const metadata: Metadata = {
  title: "Nova Obra | ObraCalc",
  description: "Cadastrar nova obra ou empreendimento.",
};

export default async function NewProjectPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const clients = await prisma.client.findMany({
    where: { userId: user.id, active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Cadastrar Nova Obra
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Preencha os dados da obra para organizar seus orçamentos, etapas e relatórios.
        </p>
      </div>

      <ProjectForm clients={clients} />
    </div>
  );
}
