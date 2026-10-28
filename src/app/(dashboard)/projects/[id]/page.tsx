import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db/prisma";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import {
  Building2,
  Calendar,
  MapPin,
  Calculator,
  Plus,
  ArrowRight,
  ArrowLeft,
  FileSpreadsheet,
} from "lucide-react";
import { ProjectActions } from "./project-actions";

export const metadata: Metadata = {
  title: "Detalhes da Obra | ObraCalc",
};

const statusLabels: Record<string, { label: string; badgeClass: string }> = {
  ACTIVE: {
    label: "Em Andamento",
    badgeClass: "bg-blue-50 text-blue-700 border-blue-200",
  },
  COMPLETED: {
    label: "Concluída",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  ARCHIVED: {
    label: "Arquivada",
    badgeClass: "bg-slate-100 text-slate-600 border-slate-200",
  },
  CANCELLED: {
    label: "Cancelada",
    badgeClass: "bg-red-50 text-red-700 border-red-200",
  },
};

export default async function ProjectDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const project = await prisma.project.findFirst({
    where: { id, userId: user.id },
    include: {
      client: true,
      budgets: {
        include: {
          revisions: {
            orderBy: { revisionNumber: "desc" },
            take: 1,
            select: {
              id: true,
              revisionNumber: true,
              status: true,
              updatedAt: true,
            },
          },
        },
        orderBy: { updatedAt: "desc" },
      },
    },
  });

  if (!project) {
    notFound();
  }

  const statusConfig = statusLabels[project.status] || {
    label: project.status,
    badgeClass: "bg-slate-100 text-slate-600 border-slate-200",
  };

  return (
    <div className="space-y-6">
      {/* Navigation Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Link href="/projects" className="hover:text-blue-600 flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Voltar para Obras</span>
        </Link>
        <span>/</span>
        <span className="font-semibold text-slate-800 truncate">{project.name}</span>
      </div>

      {/* Main Header */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 sm:p-8 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${statusConfig.badgeClass}`}
            >
              {statusConfig.label}
            </span>
            {project.client && (
              <span className="text-xs text-slate-500 font-medium">
                Cliente: <strong className="text-slate-800">{project.client.name}</strong>
              </span>
            )}
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
            {project.name}
          </h1>

          {project.description && (
            <p className="text-sm text-slate-600 max-w-2xl">{project.description}</p>
          )}

          <div className="flex flex-wrap items-center gap-4 pt-2 text-xs text-slate-500">
            {(project.city || project.state || project.address) && (
              <div className="flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-slate-400" />
                <span>
                  {[project.address, project.city, project.state].filter(Boolean).join(", ")}
                </span>
              </div>
            )}

            {project.startDate && (
              <div className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-slate-400" />
                <span>
                  Início:{" "}
                  {new Date(project.startDate).toLocaleDateString("pt-BR", {
                    timeZone: "UTC",
                  })}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <ProjectActions
            projectId={project.id}
            projectName={project.name}
            hasBudgets={project.budgets.length > 0}
          />
          <Link
            href={`/budgets/new?projectId=${project.id}`}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold shadow-md shadow-blue-600/20 hover:bg-blue-700 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Criar Orçamento</span>
          </Link>
        </div>
      </div>

      {/* Budgets Section for this Project */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Planilhas Orçamentárias da Obra
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Orçamentos, revisões analíticas e sintéticas vinculadas a este projeto.
            </p>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">
            {project.budgets.length} orçamento(s)
          </span>
        </div>

        {project.budgets.length === 0 ? (
          <div className="py-12 px-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-3 border border-blue-100">
              <FileSpreadsheet className="w-7 h-7" />
            </div>
            <h3 className="text-base font-semibold text-slate-900">
              Nenhum orçamento criado para esta obra
            </h3>
            <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
              Crie a primeira planilha orçamentária utilizando tabelas SINAPI, composições próprias e taxa de BDI.
            </p>
            <div className="mt-5">
              <Link
                href={`/budgets/new?projectId=${project.id}`}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold shadow-md shadow-blue-600/20 hover:bg-blue-700 transition-all"
              >
                <Plus className="w-4 h-4" />
                <span>Criar Orçamento Agora</span>
              </Link>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {project.budgets.map((b) => {
              const latest = b.revisions[0];
              const isFinalized = b.status === "FINALIZED";

              return (
                <div
                  key={b.id}
                  className="p-5 flex items-center justify-between hover:bg-slate-50/70 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center flex-shrink-0">
                      <Calculator className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-slate-900">
                        {b.title}
                      </h4>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {b.description || "Sem descrição"} &bull; Revisão {latest?.revisionNumber || 1}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                        isFinalized
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : "bg-amber-50 text-amber-700 border border-amber-200"
                      }`}
                    >
                      {isFinalized ? "Finalizado" : "Em Elaboração"}
                    </span>
                    <Link
                      href={`/budgets/${b.id}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
                    >
                      <span>Abrir</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
