"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  History,
  Loader2,
  Search,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import {
  applyPriceUpdatesAction,
  listResourcePriceHistoryAction,
  previewPriceUpdatesAction,
  type PriceHistoryEntryDto,
} from "@/lib/actions/price-updates";
import type {
  PriceUpdatePreview,
  PriceUpdateChange,
  BudgetImpact,
} from "@/lib/services/price-update";

interface ResourceDto {
  id: string;
  code: string;
  description: string;
  unit: string;
  category: string;
  price: string;
}

interface PriceUpdatePanelProps {
  resources: ResourceDto[];
}

function formatCurrency(value: string | number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value));
}

function formatNumber(value: string | number, decimals = 4): string {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  }).format(Number(value));
}

export function PriceUpdatePanel({ resources }: PriceUpdatePanelProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<PriceUpdatePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [historyResource, setHistoryResource] = useState<ResourceDto | null>(null);
  const [historyEntries, setHistoryEntries] = useState<PriceHistoryEntryDto[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const filteredResources = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return resources;
    return resources.filter(
      (resource) =>
        resource.code.toLowerCase().includes(normalized) ||
        resource.description.toLowerCase().includes(normalized)
    );
  }, [resources, query]);

  const updates = useMemo(
    () =>
      Object.entries(drafts)
        .filter(([, value]) => value.trim() !== "")
        .map(([resourceId, value]) => ({ resourceId, price: value }))
        .filter((update) => {
          const resource = resources.find((entry) => entry.id === update.resourceId);
          return resource ? Number(update.price) !== Number(resource.price) : false;
        }),
    [drafts, resources]
  );

  const handlePreview = async () => {
    if (updates.length === 0) {
      setError("Informe ao menos um novo preço diferente do atual.");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);
    const response = await previewPriceUpdatesAction(updates);
    setLoading(false);

    if (!response.success) {
      setError(response.error || "Erro ao simular impactos.");
      return;
    }

    setPreview(response.preview ?? null);
  };

  const handleApply = async () => {
    if (updates.length === 0) return;

    setApplying(true);
    setError(null);
    const response = await applyPriceUpdatesAction({
      updates,
      reason: reason.trim() || undefined,
    });
    setApplying(false);

    if (!response.success) {
      setError(response.error || "Erro ao aplicar atualização de preços.");
      return;
    }

    setSuccess(
      `${response.updatedResources} preço(s) atualizado(s), ${response.historyEntries} registro(s) de histórico gravado(s).`
    );
    setDrafts({});
    setPreview(null);
    setReason("");
    router.refresh();
  };

  const openHistory = async (resource: ResourceDto) => {
    setHistoryResource(resource);
    setHistoryEntries([]);
    setHistoryLoading(true);
    const response = await listResourcePriceHistoryAction(resource.id);
    setHistoryLoading(false);
    if (response.success) {
      setHistoryEntries(response.entries ?? []);
    }
  };

  const totalDelta = preview ? Number(preview.totalDelta) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <TrendingUp className="w-6 h-6 text-blue-600" />
          Atualização Controlada de Preços
        </h1>
        <p className="text-sm text-slate-500">
          Simule o impacto antes de aplicar. O histórico de preços é somente leitura e
          revisões finalizadas permanecem intactas.
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-xl border border-red-200 bg-red-50 text-xs text-red-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50 text-xs text-emerald-700 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span>{success}</span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1.35fr_1fr] gap-6">
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar insumo por código ou descrição..."
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
            </div>
            <span className="text-[11px] text-slate-500">
              {filteredResources.length} insumo(s)
            </span>
          </div>

          <div className="max-h-[62vh] overflow-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600 sticky top-0">
                <tr>
                  <th className="text-left p-3 font-semibold">Código</th>
                  <th className="text-left p-3 font-semibold">Descrição</th>
                  <th className="text-left p-3 font-semibold">Un.</th>
                  <th className="text-right p-3 font-semibold">Preço atual</th>
                  <th className="text-right p-3 font-semibold">Novo preço</th>
                  <th className="text-left p-3 font-semibold">Histórico</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredResources.map((resource) => {
                  const draft = drafts[resource.id] ?? "";
                  const changed =
                    draft.trim() !== "" && Number(draft) !== Number(resource.price);

                  return (
                    <tr key={resource.id} className={changed ? "bg-amber-50/40" : ""}>
                      <td className="p-3 font-mono font-bold text-slate-800">{resource.code}</td>
                      <td className="p-3 text-slate-700 max-w-[320px]">
                        <span className="line-clamp-2">{resource.description}</span>
                      </td>
                      <td className="p-3 text-slate-500">{resource.unit}</td>
                      <td className="p-3 text-right font-mono text-slate-700">
                        {formatNumber(resource.price)}
                      </td>
                      <td className="p-3 text-right">
                        <input
                          type="number"
                          step="0.0001"
                          min="0"
                          value={draft}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [resource.id]: event.target.value,
                            }))
                          }
                          placeholder={formatNumber(resource.price)}
                          className="w-28 px-2 py-1.5 text-right font-mono rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                        />
                      </td>
                      <td className="p-3">
                        <button
                          type="button"
                          onClick={() => void openHistory(resource)}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-800"
                        >
                          <History className="w-3.5 h-3.5" />
                          Ver
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {filteredResources.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-500">
                      Nenhum insumo encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="p-4 border-t border-slate-100 flex flex-wrap items-center gap-3">
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Motivo da atualização (ex.: reajuste SINAPI 2024/02)"
              className="flex-1 min-w-[220px] px-3 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
            <button
              type="button"
              onClick={handlePreview}
              disabled={loading || updates.length === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <TrendingUp className="w-3.5 h-3.5" />}
              Simular impactos ({updates.length})
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
            <h2 className="text-sm font-bold text-slate-900">Comparação de impactos</h2>

            {!preview && (
              <p className="text-xs text-slate-500">
                Informe os novos preços e clique em <strong>Simular impactos</strong> para
                comparar os totais antes e depois em cada orçamento em rascunho.
              </p>
            )}

            {preview && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">
                      Insumos alterados
                    </p>
                    <p className="text-lg font-bold text-slate-900">
                      {preview.changes.length}
                    </p>
                  </div>
                  <div
                    className={`rounded-xl border p-3 ${
                      totalDelta > 0
                        ? "bg-red-50 border-red-200"
                        : totalDelta < 0
                          ? "bg-emerald-50 border-emerald-200"
                          : "bg-slate-50 border-slate-200"
                    }`}
                  >
                    <p className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">
                      Impacto total
                    </p>
                    <p
                      className={`text-lg font-bold ${
                        totalDelta > 0
                          ? "text-red-700"
                          : totalDelta < 0
                            ? "text-emerald-700"
                            : "text-slate-900"
                      }`}
                    >
                      {formatCurrency(preview.totalDelta)}
                    </p>
                  </div>
                </div>

                {preview.changes.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-bold text-slate-700">Variações de preço</p>
                    {preview.changes.slice(0, 6).map((change: PriceUpdateChange) => (
                      <div
                        key={change.resourceId}
                        className="flex items-center justify-between gap-2 text-[11px] bg-slate-50 rounded-lg px-2.5 py-1.5"
                      >
                        <span className="font-mono text-slate-700">{change.code}</span>
                        <span className="text-slate-500">
                          {formatNumber(change.oldPrice)} <ArrowRight className="inline w-3 h-3" />{" "}
                          <strong className="text-slate-800">{formatNumber(change.newPrice)}</strong>
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {preview.impacts.length === 0 ? (
                  <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl p-3">
                    Nenhum orçamento em rascunho utiliza estes insumos. O histórico será
                    registrado, mas não há totais a recalcular.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {preview.impacts.map((impact: BudgetImpact) => {
                      const delta = Number(impact.delta);
                      return (
                        <div
                          key={impact.revisionId}
                          className="rounded-xl border border-slate-200 p-3 space-y-1.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-xs font-bold text-slate-900">
                                {impact.budgetTitle}
                              </p>
                              <p className="text-[10px] text-slate-500">
                                Revisão {impact.revisionNumber} • {impact.affectedItems.length}{" "}
                                item(ns) afetado(s)
                              </p>
                            </div>
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                                delta > 0
                                  ? "bg-red-100 text-red-700 border-red-200"
                                  : delta < 0
                                    ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                                    : "bg-slate-100 text-slate-700 border-slate-200"
                              }`}
                            >
                              {delta > 0 ? (
                                <TrendingUp className="w-3 h-3" />
                              ) : (
                                <TrendingDown className="w-3 h-3" />
                              )}
                              {formatCurrency(delta)} ({impact.deltaPercent}%)
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-slate-600 font-mono">
                            <span>{formatCurrency(impact.totalWithBdiBefore)}</span>
                            <ArrowRight className="w-3 h-3" />
                            <strong className="text-slate-900">
                              {formatCurrency(impact.totalWithBdiAfter)}
                            </strong>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleApply}
                  disabled={applying || preview.changes.length === 0}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50"
                >
                  {applying ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  )}
                  Aplicar atualização e recalcular rascunhos
                </button>
                <p className="text-[10px] text-slate-500 text-center">
                  Revisões finalizadas não são alteradas.
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {historyResource && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-sm text-slate-900">Histórico de preços</h3>
                <p className="text-xs text-slate-500">
                  {historyResource.code} — {historyResource.description}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryResource(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-[50vh] overflow-y-auto space-y-2">
              {historyLoading && (
                <div className="flex items-center justify-center py-8 text-slate-500 gap-2 text-xs">
                  <Loader2 className="w-4 h-4 animate-spin" /> Carregando histórico...
                </div>
              )}

              {!historyLoading && historyEntries.length === 0 && (
                <p className="text-xs text-slate-500 py-6 text-center">
                  Nenhum registro de histórico para este insumo.
                </p>
              )}

              {!historyLoading &&
                historyEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-xl border border-slate-200 p-3 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-slate-900">
                        {formatCurrency(entry.price)}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {new Date(entry.effectiveDate).toLocaleDateString("pt-BR")}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600">{entry.reason || "—"}</p>
                    <p className="text-[10px] text-slate-400">Origem: {entry.source || "—"}</p>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
