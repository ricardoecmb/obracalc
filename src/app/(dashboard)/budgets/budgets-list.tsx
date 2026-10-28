"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Calculator,
  Plus,
  Search,
  Building2,
  Calendar,
  Lock,
  FileEdit,
  Trash2,
  ExternalLink,
  Copy,
  Layers,
  ArrowRight,
  TrendingUp,
  Percent,
} from "lucide-react";
import { deleteBudget, createNewRevision } from "@/lib/actions/budgets";

export interface BudgetItemSummary {
  id: string;
  title: string;
  description: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  project: {
    id: string;
    name: string;
    client: { name: string } | null;
    state: string | null;
  };
  revisions: Array<{
    id: string;
    revisionNumber: number;
    status: "DRAFT" | "FINALIZED";
    referenceState: string | null;
    referenceMonth: string | null;
    referenceTaxRegime: string | null;
    bdiConfig: { name: string; bdiRate: string | number } | null;
    snapshot: { checksum: string; createdAt: string } | null;
    _count: {
      stages: number;
    };
    stages: Array<{
      items: Array<{
        subtotal: string | number;
        subtotalWithBdi: string | number;
      }>;
    }>;
  }>;
}

interface BudgetsListProps {
  budgets: BudgetItemSummary[];
}

export function BudgetsList({ budgets }: BudgetsListProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "DRAFT" | "FINALIZED">("ALL");
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  // Filtros de busca
  const filteredBudgets = useMemo(() => {
    return budgets.filter((b) => {
      const matchesSearch =
        search === "" ||
        b.title.toLowerCase().includes(search.toLowerCase()) ||
        b.project.name.toLowerCase().includes(search.toLowerCase()) ||
        (b.project.client?.name && b.project.client.name.toLowerCase().includes(search.toLowerCase()));

      const latestRev = b.revisions[0];
      const matchesStatus =
        statusFilter === "ALL" ||
        (latestRev && latestRev.status === statusFilter);

      return matchesSearch && matchesStatus;
    });
  }, [budgets, search, statusFilter]);

  // Cálculos consolidados para os cards de KPI
  const stats = useMemo(() => {
    let totalValue = 0;
    let draftCount = 0;
    let finalizedCount = 0;

    budgets.forEach((b) => {
      const latestRev = b.revisions[0];
      if (latestRev) {
        if (latestRev.status === "FINALIZED") finalizedCount++;
        else draftCount++;

        let revTotal = 0;
        latestRev.stages.forEach((st) => {
          st.items.forEach((it) => {
            revTotal += Number(it.subtotalWithBdi || 0);
          });
        });
        totalValue += revTotal;
      }
    });

    return {
      totalBudgets: budgets.length,
      draftCount,
      finalizedCount,
      totalValue,
    };
  }, [budgets]);

  const handleDelete = async (id: string, title: string) => {
    if (!window.confirm(`Tem certeza que deseja excluir o orçamento "${title}" e todas as suas revisões? Esta ação não pode ser desfeita.`)) {
      return;
    }

    setLoadingAction(id);
    const res = await deleteBudget(id);
    setLoadingAction(null);

    if (!res.success) {
      alert(res.error || "Erro ao excluir orçamento");
    } else {
      router.refresh();
    }
  };

  const handleNewRevision = async (budgetId: string) => {
    if (!window.confirm("Deseja criar uma nova revisão (Rascunho) a partir da última revisão existente?")) {
      return;
    }

    setLoadingAction(budgetId);
    const res = await createNewRevision(budgetId);
    setLoadingAction(null);

    if (!res.success) {
      alert(res.error || "Erro ao criar nova revisão");
    } else {
      router.push(`/budgets/${budgetId}`);
    }
  };

  const formatBRL = (val: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(val);
  };

  return (
    <div className="space-y-6">
      {/* Header com Ações */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Planilhas Orçamentárias
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Gerencie orçamentos analíticos, sintéticos, composições SINAPI e revisões auditadas.
          </p>
        </div>
        <Link
          href="/budgets/new"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold shadow-md shadow-blue-600/20 hover:bg-blue-700 transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Novo Orçamento</span>
        </Link>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
            <Calculator className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Total Orçamentos
            </p>
            <p className="text-2xl font-bold text-slate-900 mt-0.5">
              {stats.totalBudgets}
            </p>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-100">
            <FileEdit className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Em Elaboração
            </p>
            <p className="text-2xl font-bold text-slate-900 mt-0.5">
              {stats.draftCount}
            </p>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
            <Lock className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Finalizados (SHA-256)
            </p>
            <p className="text-2xl font-bold text-slate-900 mt-0.5">
              {stats.finalizedCount}
            </p>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Valor Total Previsto
            </p>
            <p className="text-xl font-bold text-indigo-950 mt-0.5">
              {formatBRL(stats.totalValue)}
            </p>
          </div>
        </div>
      </div>

      {/* Barra de Filtros e Busca */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:w-96">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por obra, título ou cliente..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-50/70 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-xs text-slate-500 font-medium whitespace-nowrap">Status:</span>
          <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-medium">
            <button
              onClick={() => setStatusFilter("ALL")}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                statusFilter === "ALL" ? "bg-white text-slate-900 shadow-xs font-semibold" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Todos
            </button>
            <button
              onClick={() => setStatusFilter("DRAFT")}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                statusFilter === "DRAFT" ? "bg-white text-slate-900 shadow-xs font-semibold" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Rascunho
            </button>
            <button
              onClick={() => setStatusFilter("FINALIZED")}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                statusFilter === "FINALIZED" ? "bg-white text-slate-900 shadow-xs font-semibold" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Finalizados
            </button>
          </div>
        </div>
      </div>

      {/* Lista de Orçamentos */}
      {filteredBudgets.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-12 text-center shadow-xs">
          <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-4 border border-blue-100">
            <Calculator className="w-7 h-7" />
          </div>
          <h3 className="text-base font-semibold text-slate-900">
            Nenhum orçamento encontrado
          </h3>
          <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
            {search || statusFilter !== "ALL"
              ? "Nenhum orçamento corresponde aos filtros selecionados."
              : "Comece criando seu primeiro orçamento a partir de composições SINAPI ou tabelas personalizadas."}
          </p>
          {!search && statusFilter === "ALL" && (
            <Link
              href="/budgets/new"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold shadow-xs hover:bg-blue-700 transition-all mt-5"
            >
              <Plus className="w-4 h-4" />
              <span>Criar Orçamento</span>
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredBudgets.map((b) => {
            const latestRev = b.revisions[0];
            const isFinalized = latestRev?.status === "FINALIZED";
            const revisionCount = b.revisions.length;

            let directSubtotal = 0;
            let subtotalWithBdi = 0;
            if (latestRev) {
              latestRev.stages.forEach((st) => {
                st.items.forEach((it) => {
                  directSubtotal += Number(it.subtotal || 0);
                  subtotalWithBdi += Number(it.subtotalWithBdi || 0);
                });
              });
            }

            const effectiveBdiRate = latestRev?.bdiConfig
              ? Number(latestRev.bdiConfig.bdiRate)
              : 0;

            return (
              <div
                key={b.id}
                className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs hover:border-slate-300 hover:shadow-sm transition-all flex flex-col md:flex-row md:items-center justify-between gap-5"
              >
                {/* Informações Principais */}
                <div className="space-y-2 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-base text-slate-900">
                      {b.title}
                    </span>
                    {isFinalized ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <Lock className="w-3 h-3" />
                        Rev. {latestRev?.revisionNumber} • Finalizada
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                        <FileEdit className="w-3 h-3" />
                        Rev. {latestRev?.revisionNumber || 1} • Rascunho
                      </span>
                    )}

                    {revisionCount > 1 && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                        {revisionCount} revisões
                      </span>
                    )}
                  </div>

                  {/* Obra e Cliente */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                      <Building2 className="w-3.5 h-3.5 text-slate-400" />
                      {b.project.name}
                      {b.project.state && ` (${b.project.state})`}
                    </span>
                    {b.project.client && (
                      <span>Cliente: {b.project.client.name}</span>
                    )}
                    {latestRev?.referenceMonth && (
                      <span>
                        Ref: {latestRev.referenceState || "BR"} • {latestRev.referenceMonth}
                        {latestRev.referenceTaxRegime ? ` (${latestRev.referenceTaxRegime})` : ""}
                      </span>
                    )}
                  </div>

                  {b.description && (
                    <p className="text-xs text-slate-500 line-clamp-1 max-w-xl">
                      {b.description}
                    </p>
                  )}
                </div>

                {/* Totais Financeiros e BDI */}
                <div className="flex flex-wrap items-center gap-6 border-t md:border-t-0 md:border-l border-slate-100 pt-4 md:pt-0 md:pl-6">
                  <div className="text-right">
                    <p className="text-xs text-slate-400 font-medium">Custo Direto</p>
                    <p className="text-sm font-semibold text-slate-700">
                      {formatBRL(directSubtotal)}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      BDI: {effectiveBdiRate.toFixed(2)}%
                    </p>
                  </div>

                  <div className="text-right min-w-[130px]">
                    <p className="text-xs text-blue-600 font-semibold uppercase tracking-wider">
                      Valor Total
                    </p>
                    <p className="text-lg font-bold text-slate-900">
                      {formatBRL(subtotalWithBdi)}
                    </p>
                  </div>

                  {/* Ações */}
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/budgets/${b.id}`}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-semibold transition-all"
                    >
                      <span>Abrir Planilha</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>

                    {isFinalized && (
                      <button
                        onClick={() => handleNewRevision(b.id)}
                        disabled={loadingAction === b.id}
                        title="Criar nova revisão editável a partir desta"
                        className="p-2 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-all text-xs"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    )}

                    <button
                      onClick={() => handleDelete(b.id, b.title)}
                      disabled={loadingAction === b.id}
                      title="Excluir orçamento"
                      className="p-2 rounded-xl border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
