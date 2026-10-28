import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db/prisma";
import { redirect } from "next/navigation";
import { ClientManagement } from "./client-management";

export const metadata: Metadata = {
  title: "Clientes | ObraCalc",
  description: "Gerenciar clientes e contratantes de obras.",
};

export default async function ClientsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const clients = await prisma.client.findMany({
    where: { userId: user.id },
    include: {
      _count: {
        select: { projects: true },
      },
    },
    orderBy: { name: "asc" },
  });

  return <ClientManagement initialClients={clients} />;
}
