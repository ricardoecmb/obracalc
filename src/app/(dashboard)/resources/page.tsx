import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db/prisma";
import { redirect } from "next/navigation";
import { ResourcesTable } from "./resources-table";

export const metadata: Metadata = {
  title: "Insumos | ObraCalc",
  description: "Catálogo de insumos com rastreabilidade por estado, competência e regime.",
};

export default async function ResourcesPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const resources = await prisma.resource.findMany({
    where: { userId: user.id },
    include: {
      supplier: {
        select: { id: true, name: true },
      },
    },
    orderBy: [{ code: "asc" }, { sourceMonth: "desc" }],
    take: 100, // Limite para performance de visualização
  });

  const serialized = resources.map((r) => ({
    id: r.id,
    code: r.code,
    description: r.description,
    unit: r.unit,
    category: r.category,
    source: r.source,
    sourceState: r.sourceState,
    sourceMonth: r.sourceMonth,
    sourceTaxRegime: r.sourceTaxRegime,
    price: r.price.toNumber(),
    laborChargesIncluded: r.laborChargesIncluded,
    laborChargesRate: r.laborChargesRate ? r.laborChargesRate.toNumber() : null,
    notes: r.notes,
    supplier: r.supplier,
  }));

  return <ResourcesTable initialResources={serialized} />;
}
