import { getCurrentUser } from "auth-utils";
import { prisma } from "@/lib/db/prisma";
import { loadPortfolio, type PortfolioSnapshot } from "@/lib/services/portfolio";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Building2,
  Calculator,
  CheckCircle2,
  DollarSign,
  Plus,
  Upload,
  ArrowRight,
  FileSpreadsheet,
  Sparkles,
  Layers,
  Percent,
} from "lucide-react";
import { DashboardCharts } from "./dashboard-charts";

export const metadata = {
  title: "Painel Principal | ObraCalc",
  description: "Visão geral e indicadores das suas obras e orçamentos.",
};

const EMPTY_PORTFOLIO: PortfolioSnapshot = {
  indicators: {
    totalProjects: 0,
    totalBudgets: 0,
    activeBudgets: 0,
    finalizedBudgets: 0,
    totalRevisions: 0,
    snapshotReferences: 0,
    totalDirect: "0.00",
    totalWithBdi: "0.00",
    totalBdi: "0.00",
    averageBdi: "0.00",
    itemsCount: 0,
  },
  references: [],
  stageRanking: [],
  statusDistribution: [],
  budgetRanking: [],
  comparisons: [],
  generatedAt: new Date(0).toISOString(),
};

function formatBRL(value: string | number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

export default async function DashboardPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  let portfolio: PortfolioSnapshot = EMPTY_PORTFOLIO;
  let projectsCount = 0;
  let recentBudgets: Array<{
    id: string;
    title: string;
    status: string;
    updatedAt: Date;
    project: { name: string };
    revisions: Array<{
      revisionNumber: number;
      status: string;
      updatedAt: Date;
    }>;
  }> = [];

  try {
    // A carteira usa exatamente uma revisão de referência por orçamento, o que
    // evita somar a mesma obra várias vezes quando há revisões.
    const [portfolioResult, projects, budgetsList] = await Promise.all([
      loadPortfolio(user.id),
      prisma.project.count({ where: { userId: user.id } }),
      prisma.budget.findMany({
        where: { userId: user.id },
        include: {
          project: { select: { name: true } },
          revisions: {
            orderBy: { revisionNumber: "desc" },
            take: 1,
            select: {
              revisionNumber: true,
              status: true,
              updatedAt: true,
            },
          },
        },
        orderBy: { updatedAt: "desc" },
        take: 5,
      }),
    ]);

    portfolio = portfolioResult;
    projectsCount = projects;
    recentBudgets = budgetsList;
  } catch (error) {
    console.error("Erro ao carregar dados do dashboard:", error);
    // Mantém valores seguros caso o banco ainda esteja inicializando.
  }

  const indicators = portfolio.indicators;

  const statCards = [
    {
      label: "Total de Obras",
      value: projectsCount.toString(),
      description: "Obras cadastradas",
      icon: Building2,
      bgColor: "bg-blue-50 text-blue-600 border-blue-200",
    },
    {
      label: "Orçamentos Ativos",
      value: indicators.activeBudgets.toString(),
      description: "Em elaboração ou revisão",
      icon: Calculator,
      bgColor: "bg-amber-50 text-amber-600 border-amber-200",
    },
    {
      label: "Orçamentos Finalizados",
      value: indicators.finalizedBudgets.toString(),
      description: "Concluídos e auditados",
      icon: CheckCircle2,
      bgColor: "bg-emerald-50 text-emerald-600 border-emerald-200",
    },
    {
      label: "Valor Total Orçado",
      value: formatBRL(indicators.totalWithBdi),
      description: "Revisão de referência de cada orçamento",
      icon: DollarSign,
      bgColor: "bg-indigo-50 text-indigo-600 border-indigo-200",
    },
  ];

  const secondaryIndicators = [
    {
      label: "Custo Direto",
      value: formatBRL(indicators.totalDirect),
      hint: "Sem BDI, sem duplicar revisões",
      icon: Layers,
      color: "text-slate-700",
    },
    {
      label: "BDI Total",
      value: formatBRL(indicators.totalBdi),
      hint: "Diferença entre total e custo direto",
      icon: DollarSign,
      color: "text-teal-700",
    },
    {
      label: "BDI Médio Ponderado",
      value: `${Number(indicators.averageBdi).toFixed(2)}%`,
      hint: "Ponderado pelo custo direto da carteira",
      icon: Percent,
      color: "text-purple-700",
    },
    {
      label: "Itens Orçados",
      value: indicators.itemsCount.toLocaleString("pt-BR"),
      hint: `${indicators.totalRevisions} revisão(ões), ${indicators.snapshotReferences} via snapshot`,
      icon: FileSpreadsheet,
      color: "text-blue-700",
    },
  ];

  const quickActions = [
    {
      title: "Nova Obra",
      description: "Cadastrar um novo empreendimento ou projeto",
      href: "/projects/new",
      icon: Building2,
      color: "bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/20",
    },
    {
      title: "Novo Orçamento",
      description: "Criar planilha orçamentária analítica ou sintética",
      href: "/budgets/new",
      icon: Calculator,
      color: "bg-slate-900 hover:bg-slate-800 text-white shadow-slate-900/20",
    },
    {
      title: "Importar Dados",
      description: "Carregar tabelas SINAPI, SICRO, CSV ou planilhas Excel",
      href: "/import",
      icon: Upload,
      color: "bg-white hover:bg-slate-50 text-slate-800 border border-slate-200 shadow-xs",
    },
    {
      title: "Assistente IA",
      description: "Busca assistida e sugestões não vinculantes",
      href: "/assistant",
      icon: Sparkles,
      color: "bg-violet-600 hover:bg-violet-700 text-white shadow-violet-500/20",
    },
  ];

  return (
    <div className="space-y-8 pb-10">
      {/* Welcome Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 sm:p-8 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-semibold mb-3">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Sistema ObraCalc Conectado</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Olá, {user.name || "Engenheiro(a)"}!
          </h1>
          <p className="text-sm sm:text-base text-slate-500 mt-1">
            Seja bem-vindo ao seu painel de gestão de orçamentos e custos da construção civil.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/budgets/new"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold shadow-md shadow-blue-600/20 hover:bg-blue-700 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Criar Orçamento</span>
          </Link>
        </div>
      </div>

      {/* 4 Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {stat.label}
                </span>
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center border ${stat.bgColor}`}
                >
                  <Icon className="w-5 h-5" />
                </div>
              </div>
              <div className="mt-4">
                <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                  {stat.value}
                </div>
                <p className="text-xs text-slate-500 mt-1 font-medium">
                  {stat.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Secondary indicators */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {secondaryIndicators.map((indicator) => {
          const Icon = indicator.icon;
          return (
            <div
              key={indicator.label}
              className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-xs flex items-start gap-3"
            >
              <div className="w-9 h-9 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center flex-shrink-0">
                <Icon className={`w-4 h-4 ${indicator.color}`} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {indicator.label}
                </p>
                <p className="text-base font-bold text-slate-900 truncate">
                  {indicator.value}
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {indicator.hint}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Charts */}
      <DashboardCharts
        stageRanking={portfolio.stageRanking}
        statusDistribution={portfolio.statusDistribution}
        budgetRanking={portfolio.budgetRanking}
        comparisons={portfolio.comparisons}
      />

      {/* Quick Actions Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-900">Ações Rápidas</h2>
          <span className="text-xs text-slate-500">Atalhos principais</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-6">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.title}
                href={action.href}
                className={`p-5 rounded-2xl flex items-start gap-4 transition-all duration-200 shadow-xs hover:shadow-md ${action.color}`}
              >
                <div className="p-3 rounded-xl bg-black/10 flex-shrink-0">
                  <Icon className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-base truncate">
                      {action.title}
                    </h3>
                    <ArrowRight className="w-4 h-4 opacity-70" />
                  </div>
                  <p className="text-xs opacity-80 mt-1 line-clamp-2">
                    {action.description}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Recent Budgets Section */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Orçamentos Recentes
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Últimos orçamentos editados ou criados na sua conta
            </p>
          </div>
          <Link
            href="/budgets"
            className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 hover:underline"
          >
            <span>Ver todos</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {recentBudgets.length === 0 ? (
          /* Empty State */
          <div className="py-14 px-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-4 border border-blue-100">
              <FileSpreadsheet className="w-8 h-8" />
            </div>
            <h3 className="text-base font-semibold text-slate-900">
              Nenhum orçamento encontrado
            </h3>
            <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
              Você ainda não possui orçamentos cadastrados. Crie seu primeiro
              orçamento para calcular etapas, custos e BDI da sua obra.
            </p>
            <div className="mt-6">
              <Link
                href="/budgets/new"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold shadow-md shadow-blue-600/20 hover:bg-blue-700 transition-all"
              >
                <Plus className="w-4 h-4" />
                <span>Criar Primeiro Orçamento</span>
              </Link>
            </div>
          </div>
        ) : (
          /* Budget list */
          <div className="divide-y divide-slate-100">
            {recentBudgets.map((budget) => {
              const latestRev = budget.revisions[0];
              const isFinalized = budget.status === "FINALIZED";

              return (
                <div
                  key={budget.id}
                  className="p-5 flex items-center justify-between hover:bg-slate-50/70 transition-colors"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center flex-shrink-0">
                      <Calculator className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-sm font-semibold text-slate-900 truncate">
                        {budget.title}
                      </h4>
                      <p className="text-xs text-slate-500 truncate mt-0.5">
                        Obra: {budget.project?.name || "Sem obra vinculada"} &bull;{" "}
                        Revisão {latestRev?.revisionNumber || 1}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <span
                      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
                        isFinalized
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : "bg-amber-50 text-amber-700 border border-amber-200"
                      }`}
                    >
                      {isFinalized ? "Finalizado" : "Em Elaboração"}
                    </span>

                    <Link
                      href={`/budgets/${budget.id}`}
                      className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-slate-100 transition-colors"
                      title="Abrir orçamento"
                    >
                      <ArrowRight className="w-4 h-4" />
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
