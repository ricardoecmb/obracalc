import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db/prisma";
import { redirect } from "next/navigation";
import { CompositionsTable } from "./compositions-table";

export const metadata: Metadata = {
  title: "Composições | ObraCalc",
  description: "Catálogo de composições de custos unitários analíticas e fechadas.",
};

export default async function CompositionsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const compositions = await prisma.composition.findMany({
    where: { userId: user.id },
    include: {
      _count: {
        select: { components: true, budgetItems: true },
      },
    },
    orderBy: [{ code: "asc" }, { version: "desc" }],
    take: 100,
  });

  const serialized = compositions.map((c) => ({
    id: c.id,
    code: c.code,
    description: c.description,
    unit: c.unit,
    source: c.source,
    sourceState: c.sourceState,
    sourceMonth: c.sourceMonth,
    sourceTaxRegime: c.sourceTaxRegime,
    type: c.type,
    closedTotalPrice: c.closedTotalPrice ? c.closedTotalPrice.toNumber() : null,
    closedMaterialPrice: c.closedMaterialPrice ? c.closedMaterialPrice.toNumber() : null,
    closedLaborPrice: c.closedLaborPrice ? c.closedLaborPrice.toNumber() : null,
    closedEquipmentPrice: c.closedEquipmentPrice ? c.closedEquipmentPrice.toNumber() : null,
    version: c.version,
    _count: c._count,
  }));

  return <CompositionsTable initialCompositions={serialized} />;
}
