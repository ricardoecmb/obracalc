"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  GitCompare,
  Loader2,
  Minus,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { compareRevisionsAction } from "@/lib/actions/revision-compare";
import type {
  ComparisonStatus,
  RevisionComparison,
} from "@/lib/services/revision-compare";

interface ComparisonBudgetOption {
  id: string;
  title: string;
  revisions: Array<{
    id: string;
    revisionNumber: number;
    status: string;
  }>;
}

interface RevisionComparisonPanelProps {
  budget: ComparisonBudgetOption | null;
}

function formatCurrency(value: string | number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value));
}

function formatNumber(value: string | number, decimals = 2): string {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  }).format(Number(value));
}

const STATUS_STYLES: Record<
  ComparisonStatus,
  { label: string; badge: string; icon: typeof CheckCircle2; iconColor: string }
> = {
  ADDED: {
    label: "Adicionado",
    badge: "bg-emerald-100 text-emerald-700 border-emerald-200",
    icon: TrendingUp,
    iconColor: "text-emerald-600",
  },
  REMOVED: {
    label: "Removido",
    badge: "bg-red-100 text-red-700 border-red-200",
    icon: TrendingDown,
    iconColor: "text-red-600",
  },
  CHANGED: {
    label: "Alterado",
    badge: "bg-amber-100 text-amber-700 border-amber-200",
    icon: GitCompare,
    iconColor: "text-amber-600",
  },
  UNCHANGED: {
    label: "Sem alteração",
    badge: "bg-slate-100 text-slate-600 border-slate-200",
    icon: Minus,
    iconColor: "text-slate-400",
  },
};

export function RevisionComparisonPanel({ budget }: RevisionComparisonPanelProps) {
  const revisions = useMemo(
    () => [...(budget?.revisions ?? [])].sort((a, b) => a.revisionNumber - b.revisionNumber),
    [budget]
  );

  const [fromRevisionId, setFromRevisionId] = useState<string>(
    revisions[0]?.id ?? ""
  );
  const [toRevisionId, setToRevisionId] = useState<string>(
    revisions[revisions.length - 1]?.id ?? ""
  );
  const [comparison, setComparison] = useState<RevisionComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedStages, setExpandedStages] = useState<Record<string, boolean>>({});

  // Reajusta a seleção quando o orçamento ativo muda.
  const budgetId = budget?.id ?? "";
  const [previousBudgetId, setPreviousBudgetId] = useState(budgetId);
  if (budgetId !== previousBudgetId) {
    setPreviousBudgetId(budgetId);
    setFromRevisionId(revisions[0]?.id ?? "");
    setToRevisionId(revisions[revisions.length - 1]?.id ?? "");
    setComparison(null);
    setError(null);
  }

  const handleCompare = async () => {
    if (!fromRevisionId || !toRevisionId) return;
    if (fromRevisionId === toRevisionId) {
      setError("Selecione duas revisões diferentes para comparar.");
      return;
    }

    setLoading(true);
    setError(null);
    const response = await compareRevisionsAction({
      fromRevisionId,
      toRevisionId,
    });
    setLoading(false);

    if (!response.success) {
      setError(response.error || "Erro ao comparar revisões.");
      setComparison(null);
      return;
    }

    setComparison(response.comparison ?? null);
    const expanded: Record<string, boolean> = {};
    for (const stage of response.comparison?.stages ?? []) {
      expanded[stage.code] = stage.status !== "UNCHANGED";
    }
    setExpandedStages(expanded);
  };

  if (!budget || revisions.length < 2) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          <GitCompare className="w-4 h-4 text-indigo-600" />
          Comparar Revisões
        </h3>
        <p className="text-xs text-slate-500 mt-2">
          {budget
            ? "Este orçamento possui apenas uma revisão. Crie uma nova revisão para comparar as alterações."
            : "Selecione um orçamento para comparar revisões."}
        </p>
      </div>
    );
  }

  const delta = comparison ? Number(comparison.summary.deltaWithBdi) : 0;
  const fromRevision = revisions.find((revision) => revision.id === fromRevisionId);
  const toRevision = revisions.find((revision) => revision.id === toRevisionId);

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <GitCompare className="w-4 h-4 text-indigo-600" />
            Comparar Revisões
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Comparação determinística de quantidades, preços e itens entre duas revisões.
            Revisões finalizadas são lidas do snapshot imutável.
          </p>
        </div>
        <span className="text-[11px] text-slate-500">{budget.title}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr_auto] items-end gap-3">
        <label className="text-xs space-y-1">
          <span className="font-semibold text-slate-700">Revisão de origem</span>
          <select
            value={fromRevisionId}
            onChange={(event) => {
              setFromRevisionId(event.target.value);
              setComparison(null);
            }}
            className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
          >
            {revisions.map((revision) => (
              <option key={revision.id} value={revision.id}>
                Revisão {revision.revisionNumber} — {revision.status === "FINALIZED" ? "Finalizada" : "Rascunho"}
              </option>
            ))}
          </select>
        </label>

        <ArrowRight className="w-4 h-4 text-slate-400 mb-2.5 hidden sm:block" />

        <label className="text-xs space-y-1">
          <span className="font-semibold text-slate-700">Revisão de destino</span>
          <select
            value={toRevisionId}
            onChange={(event) => {
              setToRevisionId(event.target.value);
              setComparison(null);
            }}
            className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
          >
            {revisions.map((revision) => (
              <option key={revision.id} value={revision.id}>
                Revisão {revision.revisionNumber} — {revision.status === "FINALIZED" ? "Finalizada" : "Rascunho"}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={handleCompare}
          disabled={loading || !fromRevisionId || !toRevisionId}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <GitCompare className="w-3.5 h-3.5" />
          )}
          Comparar
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-xl border border-red-200 bg-red-50 text-xs text-red-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {comparison && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">
                Total com BDI — origem
              </p>
              <p className="text-sm font-bold text-slate-900 mt-0.5">
                {formatCurrency(comparison.from.totalWithBdi)}
              </p>
              <p className="text-[10px] text-slate-500">
                Revisão {comparison.from.revisionNumber} •{" "}
                {comparison.from.source === "SNAPSHOT" ? "snapshot" : "banco"}
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">
                Total com BDI — destino
              </p>
              <p className="text-sm font-bold text-slate-900 mt-0.5">
                {formatCurrency(comparison.to.totalWithBdi)}
              </p>
              <p className="text-[10px] text-slate-500">
                Revisão {comparison.to.revisionNumber} •{" "}
                {comparison.to.source === "SNAPSHOT" ? "snapshot" : "banco"}
              </p>
            </div>

            <div
              className={`rounded-xl border p-3 ${
                delta > 0
                  ? "bg-red-50 border-red-200"
                  : delta < 0
                    ? "bg-emerald-50 border-emerald-200"
                    : "bg-slate-50 border-slate-200"
              }`}
            >
              <p className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">
                Variação total
              </p>
              <p
                className={`text-sm font-bold mt-0.5 ${
                  delta > 0
                    ? "text-red-700"
                    : delta < 0
                      ? "text-emerald-700"
                      : "text-slate-900"
                }`}
              >
                {formatCurrency(comparison.summary.deltaWithBdi)} (
                {formatNumber(comparison.summary.deltaPercent, 4)}%)
              </p>
              <p className="text-[10px] text-slate-500">
                Custo direto: {formatCurrency(comparison.summary.deltaDirect)}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="px-2.5 py-1 rounded-full font-bold bg-emerald-100 text-emerald-700">
              {comparison.summary.itemsAdded} adicionado(s)
            </span>
            <span className="px-2.5 py-1 rounded-full font-bold bg-red-100 text-red-700">
              {comparison.summary.itemsRemoved} removido(s)
            </span>
            <span className="px-2.5 py-1 rounded-full font-bold bg-amber-100 text-amber-700">
              {comparison.summary.itemsChanged} alterado(s)
            </span>
            <span className="px-2.5 py-1 rounded-full font-bold bg-slate-100 text-slate-700">
              {comparison.summary.stagesChanged} etapa(s) afetada(s)
            </span>
          </div>

          {comparison.stages.length === 0 ? (
            <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl p-3">
              Nenhuma etapa encontrada nas revisões selecionadas.
            </p>
          ) : (
            <div className="rounded-2xl border border-slate-200 overflow-hidden">
              {comparison.stages.map((stage) => {
                const style = STATUS_STYLES[stage.status];
                const StatusIcon = style.icon;
                const isExpanded = expandedStages[stage.code] ?? stage.status !== "UNCHANGED";
                const stageDelta = Number(stage.delta);

                return (
                  <div key={stage.code} className="border-b border-slate-100 last:border-b-0">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedStages((current) => ({
                          ...current,
                          [stage.code]: !isExpanded,
                        }))
                      }
                      className="w-full flex flex-wrap items-center gap-2 px-3.5 py-2.5 text-left hover:bg-slate-50"
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                      )}
                      <span className="font-mono text-[11px] text-slate-500">{stage.code}</span>
                      <span className="text-xs font-semibold text-slate-800 flex-1 min-w-[160px]">
                        {stage.title}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${style.badge}`}
                      >
                        <StatusIcon className="w-3 h-3" />
                        {style.label}
                      </span>
                      <span
                        className={`text-xs font-bold ${
                          stageDelta > 0
                            ? "text-red-700"
                            : stageDelta < 0
                              ? "text-emerald-700"
                              : "text-slate-500"
                        }`}
                      >
                        {formatCurrency(stage.delta)}
                      </span>
                    </button>

                    {isExpanded && stage.items.length > 0 && (
                      <div className="overflow-x-auto border-t border-slate-100 bg-slate-50/40">
                        <table className="w-full text-[11px]">
                          <thead className="text-slate-500">
                            <tr>
                              <th className="text-left p-2 font-semibold">Código</th>
                              <th className="text-left p-2 font-semibold">Descrição</th>
                              <th className="text-left p-2 font-semibold">Un.</th>
                              <th className="text-right p-2 font-semibold">Qtd. origem</th>
                              <th className="text-right p-2 font-semibold">Qtd. destino</th>
                              <th className="text-right p-2 font-semibold">Custo orig.</th>
                              <th className="text-right p-2 font-semibold">Custo dest.</th>
                              <th className="text-right p-2 font-semibold">Δ Subtotal</th>
                              <th className="text-left p-2 font-semibold">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 bg-white">
                            {stage.items.map((item) => {
                              const itemStyle = STATUS_STYLES[item.status];
                              const ItemIcon = itemStyle.icon;
                              const itemDelta = Number(item.delta);

                              return (
                                <tr key={item.key}>
                                  <td className="p-2 font-mono text-slate-700">
                                    {item.compositionCode}
                                  </td>
                                  <td className="p-2 text-slate-700 max-w-[240px]">
                                    {item.description}
                                  </td>
                                  <td className="p-2 text-slate-500">{item.unit}</td>
                                  <td className="p-2 text-right font-mono text-slate-600">
                                    {item.quantityFrom ?? "—"}
                                  </td>
                                  <td className="p-2 text-right font-mono text-slate-600">
                                    {item.quantityTo ?? "—"}
                                  </td>
                                  <td className="p-2 text-right font-mono text-slate-600">
                                    {item.unitCostFrom ? formatNumber(item.unitCostFrom, 4) : "—"}
                                  </td>
                                  <td className="p-2 text-right font-mono text-slate-600">
                                    {item.unitCostTo ? formatNumber(item.unitCostTo, 4) : "—"}
                                  </td>
                                  <td
                                    className={`p-2 text-right font-mono font-bold ${
                                      itemDelta > 0
                                        ? "text-red-700"
                                        : itemDelta < 0
                                          ? "text-emerald-700"
                                          : "text-slate-500"
                                    }`}
                                  >
                                    {formatCurrency(item.delta)}
                                  </td>
                                  <td className="p-2">
                                    <span
                                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold border ${itemStyle.badge}`}
                                    >
                                      <ItemIcon className={`w-2.5 h-2.5 ${itemStyle.iconColor}`} />
                                      {itemStyle.label}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-[10px] text-slate-400">
            Origem: Revisão {fromRevision?.revisionNumber ?? comparison.from.revisionNumber} •
            Destino: Revisão {toRevision?.revisionNumber ?? comparison.to.revisionNumber}. Nenhum
            dado foi alterado por esta comparação.
          </p>
        </div>
      )}
    </div>
  );
}
