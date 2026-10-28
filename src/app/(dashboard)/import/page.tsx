import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth-utils";
import { redirect } from "next/navigation";
import { listImportJobs } from "@/lib/services/import-jobs";
import { ImportJobsHistory } from "@/components/import/import-jobs-history";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = {
  title: "Importação | ObraCalc",
  description: "Importação de bases de dados, tabelas SINAPI, SICRO e insumos em CSV.",
};

export default async function ImportPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const jobs = await listImportJobs(user.id, 10);

  return (
    <div className="space-y-6">
      <ImportWizard />
      <ImportJobsHistory jobs={jobs} />
    </div>
  );
}
