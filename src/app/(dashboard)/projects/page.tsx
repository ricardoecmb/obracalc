import type { Metadata } from "next";
import { Building2, Plus, Calendar, MapPin, Calculator, ArrowRight } from "lucide-react";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db/prisma";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Obras | ObraCalc",
  description: "Gerenciamento de obras e projetos.",
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

export default async function ProjectsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const projects = await prisma.project.findMany({
    where: { userId: user.id },
    include: {
      client: {
        select: { id: true, name: true },
      },
      _count: {
        select: { budgets: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  const totalProjects = projects.length;
  const activeProjects = projects.filter((p) => p.status === "ACTIVE").length;
  const completedProjects = projects.filter((p) => p.status === "COMPLETED").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Obras e Empreendimentos
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Gerencie os projetos e obras vinculadas aos seus orçamentos técnicos.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/clients"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-slate-700 border border-slate-200 text-sm font-semibold hover:bg-slate-50 transition-all shadow-xs"
          >
            <span>Gerenciar Clientes</span>
          </Link>
          <Link
            href="/projects/new"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold shadow-md shadow-blue-600/20 hover:bg-blue-700 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Nova Obra</span>
          </Link>
        </div>
      </div>

      {/* Summary counters */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs">
          <span className="text-xs font-semibold uppercase text-slate-500">Total de Obras</span>
          <div className="text-2xl font-extrabold text-slate-900 mt-1">{totalProjects}</div>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs">
          <span className="text-xs font-semibold uppercase text-blue-600">Em Andamento</span>
          <div className="text-2xl font-extrabold text-blue-600 mt-1">{activeProjects}</div>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs">
          <span className="text-xs font-semibold uppercase text-emerald-600">Concluídas</span>
          <div className="text-2xl font-extrabold text-emerald-600 mt-1">{completedProjects}</div>
        </div>
      </div>

      {/* Content list or empty state */}
      {projects.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-12 text-center shadow-xs">
          <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-4 border border-blue-100">
            <Building2 className="w-7 h-7" />
          </div>
          <h3 className="text-base font-semibold text-slate-900">
            Nenhuma obra cadastrada
          </h3>
          <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
            Cadastre sua primeira obra para associar orçamentos, composições e cronogramas.
          </p>
          <div className="mt-6">
            <Link
              href="/projects/new"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold shadow-md shadow-blue-600/20 hover:bg-blue-700 transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>Cadastrar Primeira Obra</span>
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {projects.map((project) => {
            const statusConfig = statusLabels[project.status] || {
              label: project.status,
              badgeClass: "bg-slate-100 text-slate-600 border-slate-200",
            };

            return (
              <div
                key={project.id}
                className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${statusConfig.badgeClass}`}
                    >
                      {statusConfig.label}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                      <Calculator className="w-3.5 h-3.5 text-slate-400" />
                      <span>{project._count.budgets} orçamento(s)</span>
                    </span>
                  </div>

                  <h3 className="text-base font-bold text-slate-900 hover:text-blue-600 transition-colors">
                    <Link href={`/projects/${project.id}`}>{project.name}</Link>
                  </h3>

                  {project.description && (
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                      {project.description}
                    </p>
                  )}

                  <div className="mt-4 pt-3 border-t border-slate-100 space-y-2 text-xs text-slate-600">
                    {project.client && (
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="text-slate-400 font-medium">Cliente:</span>
                        <span className="font-semibold text-slate-800 truncate">
                          {project.client.name}
                        </span>
                      </div>
                    )}

                    {(project.city || project.state) && (
                      <div className="flex items-center gap-1.5 text-slate-500">
                        <MapPin className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                        <span>
                          {[project.city, project.state].filter(Boolean).join(" - ")}
                        </span>
                      </div>
                    )}

                    {project.startDate && (
                      <div className="flex items-center gap-1.5 text-slate-500">
                        <Calendar className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
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

                <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <Link
                    href={`/budgets/new?projectId=${project.id}`}
                    className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Novo Orçamento</span>
                  </Link>
                  <Link
                    href={`/projects/${project.id}`}
                    className="text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1"
                  >
                    <span>Detalhes</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
