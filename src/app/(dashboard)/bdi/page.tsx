import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db/prisma";
import { redirect } from "next/navigation";
import { BdiManagement } from "./bdi-management";

export const metadata: Metadata = {
  title: "BDI | ObraCalc",
  description: "Cálculo e configurações de Bonificação e Despesas Indiretas (BDI) conforme Acórdão TCU 2622/2013.",
};

export default async function BdiPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const configs = await prisma.bdiConfig.findMany({
    where: { userId: user.id },
    include: {
      _count: {
        select: { budgetRevisions: true },
      },
    },
    orderBy: [
      { isDefault: "desc" },
      { createdAt: "desc" },
    ],
  });

  // Serialize Prisma Decimals for Client Component
  const serializedConfigs = configs.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    isDefault: c.isDefault,
    bdiRate: c.bdiRate.toNumber(),
    ac: c.ac.toNumber(),
    cf: c.cf.toNumber(),
    s: c.s.toNumber(),
    g: c.g.toNumber(),
    mi: c.mi.toNumber(),
    tm: c.tm.toNumber(),
    te: c.te.toNumber(),
    tf: c.tf.toNumber(),
    l: c.l.toNumber(),
    _count: c._count,
  }));

  return <BdiManagement initialConfigs={serializedConfigs} />;
}
