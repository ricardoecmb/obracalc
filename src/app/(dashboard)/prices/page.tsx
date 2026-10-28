import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db/prisma";
import { redirect } from "next/navigation";
import { PriceUpdatePanel } from "./price-update-panel";

export const metadata: Metadata = {
  title: "Atualização de Preços | ObraCalc",
  description:
    "Atualização controlada de preços de insumos com comparação de impacto nos orçamentos em rascunho.",
};

export default async function PricesPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const resources = await prisma.resource.findMany({
    where: { userId: user.id, active: true },
    orderBy: { code: "asc" },
    take: 500,
    select: {
      id: true,
      code: true,
      description: true,
      unit: true,
      category: true,
      price: true,
    },
  });

  return (
    <PriceUpdatePanel
      resources={resources.map((resource) => ({
        id: resource.id,
        code: resource.code,
        description: resource.description,
        unit: resource.unit,
        category: resource.category,
        price: resource.price.toString(),
      }))}
    />
  );
}
