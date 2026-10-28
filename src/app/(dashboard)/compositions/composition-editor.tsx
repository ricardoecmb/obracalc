"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight,
  Check,
  ChevronRight,
  Copy,
  Layers,
  Loader2,
  Package,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  addCompositionComponentAction,
  deleteCompositionComponentAction,
  duplicateCompositionAction,
  getCompositionDetailsAction,
  replaceComponentResourceAction,
  simulateResourceReplacementAction,
  updateCompositionComponentAction,
} from "@/lib/actions/compositions";
import { listConfirmedEquivalents, searchResources } from "@/lib/actions/resources";
import { searchCompositions } from "@/lib/actions/budgets";

interface CostBreakdownDto {
  material: string;
  labor: string;
  equipment: string;
  other: string;
  unallocated: string;
  total: string;
  breakdownUnavailable?: boolean;
}

interface DetailRow {
  componentId: string;
  description: string;
  unit: string;
  coefficient: string;
  unitPrice: string;
  totalPrice: string;
  category: string;
  laborChargesRate: string | null;
  laborChargesAmount: string | null;
}

interface ComponentRow {
  id: string;
  resourceId: string | null;
  childCompositionId: string | null;
  coefficient: string;
  notes: string | null;
  sortOrder: number;
  resource: {
    id: string;
    code: string;
    description: string;
    unit: string;
    category: string;
    price: string;
    laborChargesIncluded: boolean;
  } | null;
  childComposition: {
    id: string;
    code: string;
    description: string;
    unit: string;
  } | null;
}

interface CompositionDetail {
  id: string;
  code: string;
  description: string;
  unit: string;
  source: string;
  sourceState: string | null;
  sourceMonth: string | null;
  sourceTaxRegime: string | null;
  type: string;
  version: number;
  notes: string | null;
  originCompositionId: string | null;
  originComposition: { id: string; code: string; description: string } | null;
  closedTotalPrice: string | null;
  closedMaterialPrice: string | null;
  closedLaborPrice: string | null;
  closedEquipmentPrice: string | null;
  closedOtherPrice: string | null;
  components: ComponentRow[];
  calculation: {
    unitCost: CostBreakdownDto;
    breakdownUnavailable: boolean;
    componentDetails: DetailRow[];
  };
}

interface ResourceOption {
  id: string;
  code: string;
  description: string;
  unit: string;
  category: string;
  price: string;
}

interface CompositionOption {
  id: string;
  code: string;
  description: string;
  unit: string;
  unitCostTotal: string | null;
}

interface SimulationState {
  componentId: string;
  targetResourceId: string;
  before: CostBreakdownDto;
  after: CostBreakdownDto;
  diff: Record<string, string>;
  componentBefore: { description: string; totalPrice: string } | null;
  componentAfter: { description: string; totalPrice: string } | null;
}

interface CompositionEditorProps {
  compositionId: string;
  onClose: () => void;
}

const formatBRL = (value: string | number | null | undefined) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value || 0));

const categoryLabel: Record<string, string> = {
  MATERIAL: "Material",
  LABOR: "Mão de obra",
  EQUIPMENT: "Equipamento",
  OTHER: "Outros",
  COMPOSITION: "Auxiliar",
};

export function CompositionEditor({ compositionId, onClose }: CompositionEditorProps) {
  const [detail, setDetail] = useState<CompositionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [coefficients, setCoefficients] = useState<Record<string, string>>({});

  const [addType, setAddType] = useState<"RESOURCE" | "COMPOSITION">("RESOURCE");
  const [query, setQuery] = useState("");
  const [resourceResults, setResourceResults] = useState<ResourceOption[]>([]);
  const [compositionResults, setCompositionResults] = useState<CompositionOption[]>([]);
  const [selectedResourceId, setSelectedResourceId] = useState("");
  const [selectedChildId, setSelectedChildId] = useState("");
  const [newCoefficient, setNewCoefficient] = useState("1.00000");

  const [replacementComponentId, setReplacementComponentId] = useState<string | null>(null);
  const [equivalents, setEquivalents] = useState<ResourceOption[]>([]);
  const [replacementTargetId, setReplacementTargetId] = useState("");
  const [simulation, setSimulation] = useState<SimulationState | null>(null);

  const refresh = useCallback(async () => {
    // O primeiro `await` garante que nenhum setState ocorra de forma síncrona
    // dentro do efeito de montagem (evita renderizações em cascata).
    const res = await getCompositionDetailsAction(compositionId);
    setLoading(false);

    if (!res.success || !res.composition) {
      setError(res.error || "Erro ao carregar composição.");
      return;
    }

    setDetail(res.composition as CompositionDetail);
    setCoefficients(
      Object.fromEntries(
        (res.composition as CompositionDetail).components.map((component) => [
          component.id,
          component.coefficient,
        ])
      )
    );
  }, [compositionId]);

  useEffect(() => {
    // Adia a chamada para fora do corpo síncrono do efeito: os setState
    // acontecem apenas após a resposta da server action.
    const timer = setTimeout(() => {
      void refresh();
    }, 0);

    return () => clearTimeout(timer);
  }, [refresh]);

  const detailById = useMemo(() => {
    const map = new Map<string, DetailRow>();
    detail?.calculation.componentDetails.forEach((row) => map.set(row.componentId, row));
    return map;
  }, [detail]);

  const showNotice = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(null), 4000);
  };

  const handleSearch = async (value: string) => {
    setQuery(value);
    setSelectedResourceId("");
    setSelectedChildId("");

    if (value.trim().length < 2) {
      setResourceResults([]);
      setCompositionResults([]);
      return;
    }

    if (addType === "RESOURCE") {
      const res = await searchResources({ query: value, limit: 10 });
      if (res.success) setResourceResults(res.resources as ResourceOption[]);
    } else {
      const res = await searchCompositions({ query: value, limit: 10 });
      if (res.success) setCompositionResults(res.compositions as CompositionOption[]);
    }
  };

  const objectId = addType === "RESOURCE" ? selectedResourceId : selectedChildId;

  const handleAddComponent = async () => {
    if (!objectId) {
      setError("Selecione um insumo ou composição auxiliar.");
      return;
    }

    setSaving(true);
    setError(null);

    const res = await addCompositionComponentAction({
      compositionId,
      resourceId: addType === "RESOURCE" ? objectId : null,
      childCompositionId: addType === "COMPOSITION" ? objectId : null,
      coefficient: newCoefficient,
      notes: null,
    });

    setSaving(false);

    if (!res.success) {
      setError(res.error || "Erro ao adicionar componente.");
      return;
    }

    setQuery("");
    setSelectedResourceId("");
    setSelectedChildId("");
    setResourceResults([]);
    setCompositionResults([]);
    setNewCoefficient("1.00000");
    showNotice("Componente adicionado.");
    await refresh();
  };

  const handleSaveCoefficient = async (componentId: string) => {
    setSaving(true);
    const res = await updateCompositionComponentAction({
      componentId,
      coefficient: coefficients[componentId],
    });
    setSaving(false);

    if (!res.success) {
      setError(res.error || "Erro ao atualizar coeficiente.");
      return;
    }

    showNotice("Coeficiente atualizado.");
    await refresh();
  };

  const handleDeleteComponent = async (componentId: string) => {
    if (!window.confirm("Remover este componente da composição?")) return;

    setSaving(true);
    const res = await deleteCompositionComponentAction(componentId);
    setSaving(false);

    if (!res.success) {
      setError(res.error || "Erro ao remover componente.");
      return;
    }

    showNotice("Componente removido.");
    await refresh();
  };

  const handleDuplicate = async () => {
    setSaving(true);
    const res = await duplicateCompositionAction({ compositionId });
    setSaving(false);

    if (!res.success) {
      setError(res.error || "Erro ao duplicar composição.");
      return;
    }

    showNotice(`Composição duplicada como ${res.code}. Origem preservada.`);
  };

  const handleStartReplacement = async (component: ComponentRow) => {
    if (!component.resourceId) return;

    setError(null);
    setSimulation(null);
    setReplacementTargetId("");
    setReplacementComponentId(component.id);

    const res = await listConfirmedEquivalents(component.resourceId);
    if (!res.success) {
      setError(res.error || "Erro ao carregar equivalentes.");
      setEquivalents([]);
      return;
    }

    const unique = new Map<string, ResourceOption>();
    (res.resources as ResourceOption[]).forEach((resource) => unique.set(resource.id, resource));
    setEquivalents(Array.from(unique.values()));
  };

  const handleSimulate = async () => {
    if (!replacementComponentId || !replacementTargetId) {
      setError("Selecione o insumo equivalente de destino.");
      return;
    }

    setSaving(true);
    setError(null);
    const res = await simulateResourceReplacementAction({
      compositionId,
      componentId: replacementComponentId,
      targetResourceId: replacementTargetId,
    });
    setSaving(false);

    if (!res.success || !res.simulation) {
      setError(res.error || "Erro na simulação.");
      setSimulation(null);
      return;
    }

    setSimulation({
      componentId: replacementComponentId,
      targetResourceId: replacementTargetId,
      before: res.simulation.before,
      after: res.simulation.after,
      diff: res.simulation.diff,
      componentBefore: res.simulation.componentBefore,
      componentAfter: res.simulation.componentAfter,
    });
  };

  const handleApplyReplacement = async () => {
    if (!simulation) return;

    setSaving(true);
    setError(null);
    const res = await replaceComponentResourceAction({
      compositionId,
      componentId: simulation.componentId,
      targetResourceId: simulation.targetResourceId,
    });
    setSaving(false);

    if (!res.success) {
      setError(res.error || "Erro ao substituir insumo.");
      return;
    }

    showNotice("Substituição aplicada e custo recalculado.");
    setReplacementComponentId(null);
    setSimulation(null);
    setEquivalents([]);
    await refresh();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex justify-end">
      <aside className="w-full max-w-3xl h-full bg-white shadow-2xl flex flex-col">
        <header className="p-5 border-b border-slate-200 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Layers className="w-5 h-5 text-blue-600" />
              <h2 className="font-bold text-base text-slate-900 truncate">
                {detail ? `${detail.code} — ${detail.description}` : "Editor de Composição"}
              </h2>
            </div>
            {detail && (
              <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-slate-500">
                <span className="font-mono">{detail.source}</span>
                <span>•</span>
                <span>{detail.sourceMonth || "—"}</span>
                <span>•</span>
                <span>{detail.sourceState || "BR"}</span>
                <span>•</span>
                <span>{detail.type === "CLOSED" ? "Fechada" : "Analítica"}</span>
                {detail.originComposition && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                    <Copy className="w-3 h-3" />
                    Origem: {detail.originComposition.code}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDuplicate}
              disabled={saving}
              title="Duplicar composição preservando a origem"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Duplicar</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        {error && (
          <div className="mx-5 mt-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
            {error}
          </div>
        )}
        {notice && (
          <div className="mx-5 mt-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs">
            {notice}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading && !detail ? (
            <div className="p-10 text-center text-slate-500 text-xs">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-600" />
              Carregando composição...
            </div>
          ) : detail ? (
            <>
              {/* Resumo de custos */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {[
                  ["Material", detail.calculation.unitCost.material],
                  ["Mão de obra", detail.calculation.unitCost.labor],
                  ["Equipamento", detail.calculation.unitCost.equipment],
                  ["Outros", detail.calculation.unitCost.other],
                  ["Total", detail.calculation.unitCost.total],
                ].map(([label, value], index) => (
                  <div
                    key={label}
                    className={`p-3 rounded-xl border ${
                      index === 4
                        ? "bg-slate-900 text-white border-slate-900"
                        : "bg-slate-50 border-slate-200"
                    }`}
                  >
                    <p
                      className={`text-[10px] uppercase tracking-wider font-semibold ${
                        index === 4 ? "text-slate-300" : "text-slate-500"
                      }`}
                    >
                      {label}
                    </p>
                    <p className="font-mono font-bold text-xs mt-1">{formatBRL(value)}</p>
                  </div>
                ))}
              </div>

              {detail.calculation.breakdownUnavailable && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
                  Parte do custo não possui desdobramento por categoria na fonte. O total de
                  referência é preservado sem rateio artificial.
                </p>
              )}

              {/* Componentes */}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Componentes ({detail.components.length})
                  </h3>
                  <button
                    type="button"
                    onClick={() => void refresh()}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-800"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Atualizar
                  </button>
                </div>

                {detail.components.length === 0 ? (
                  <div className="p-6 text-center border border-dashed border-slate-200 rounded-xl text-xs text-slate-400">
                    Nenhum componente cadastrado.
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
                    {detail.components.map((component) => {
                      const calculated = detailById.get(component.id);
                      const isResource = Boolean(component.resourceId);

                      return (
                        <div key={component.id} className="p-3 space-y-2">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                    isResource
                                      ? "bg-blue-50 text-blue-700"
                                      : "bg-purple-50 text-purple-700"
                                  }`}
                                >
                                  {isResource ? "Insumo" : "Auxiliar"}
                                </span>
                                <span className="font-mono text-[11px] text-slate-600">
                                  {component.resource?.code ?? component.childComposition?.code}
                                </span>
                              </div>
                              <p className="text-xs text-slate-800 mt-1 line-clamp-2">
                                {component.resource?.description ??
                                  component.childComposition?.description}
                              </p>
                              <p className="text-[10px] text-slate-500 mt-0.5">
                                {calculated
                                  ? categoryLabel[calculated.category] ?? calculated.category
                                  : "—"}{" "}
                                • Unidade:{" "}
                                {component.resource?.unit ?? component.childComposition?.unit}
                              </p>
                            </div>

                            <div className="flex items-center gap-2 flex-shrink-0">
                              {isResource && (
                                <button
                                  type="button"
                                  onClick={() => void handleStartReplacement(component)}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 text-[10px] font-semibold text-slate-600 hover:bg-slate-50"
                                  title="Substituir por equivalente confirmado"
                                >
                                  <ArrowLeftRight className="w-3 h-3" />
                                  Substituir
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => void handleDeleteComponent(component.id)}
                                disabled={saving}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono">
                            <label className="flex items-center gap-1.5 text-slate-500">
                              Coef.
                              <input
                                type="text"
                                value={coefficients[component.id] ?? component.coefficient}
                                onChange={(e) =>
                                  setCoefficients((prev) => ({
                                    ...prev,
                                    [component.id]: e.target.value,
                                  }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") void handleSaveCoefficient(component.id);
                                }}
                                className="w-24 px-1.5 py-0.5 rounded border border-slate-200 text-right text-slate-800"
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => void handleSaveCoefficient(component.id)}
                              disabled={saving}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-40"
                            >
                              <Check className="w-3 h-3" />
                              Salvar
                            </button>

                            <span className="text-slate-500">
                              Unit.: {formatBRL(calculated?.unitPrice ?? 0)}
                            </span>
                            <span className="font-bold text-slate-900">
                              Total: {formatBRL(calculated?.totalPrice ?? 0)}
                            </span>
                            {calculated?.laborChargesAmount &&
                              Number(calculated.laborChargesAmount) > 0 && (
                                <span className="text-amber-700">
                                  Encargos: {formatBRL(calculated.laborChargesAmount)} (
                                  {Number(calculated.laborChargesRate || 0).toFixed(2)}%)
                                </span>
                              )}
                          </div>

                          {/* Painel de substituição */}
                          {replacementComponentId === component.id && (
                            <div className="mt-2 p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                              <p className="text-[11px] font-bold text-slate-700">
                                Equivalentes confirmados
                              </p>
                              {equivalents.length === 0 ? (
                                <p className="text-[11px] text-slate-500">
                                  Nenhum equivalente confirmado para este insumo. Confirme a
                                  equivalência na página de Insumos antes de substituir.
                                </p>
                              ) : (
                                <>
                                  <select
                                    value={replacementTargetId}
                                    onChange={(e) => {
                                      setReplacementTargetId(e.target.value);
                                      setSimulation(null);
                                    }}
                                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs bg-white"
                                  >
                                    <option value="">Selecione o insumo equivalente...</option>
                                    {equivalents.map((resource) => (
                                      <option key={resource.id} value={resource.id}>
                                        {resource.code} — {resource.description} [
                                        {resource.unit}] ({formatBRL(resource.price)})
                                      </option>
                                    ))}
                                  </select>

                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => void handleSimulate()}
                                      disabled={saving || !replacementTargetId}
                                      className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-[11px] font-bold hover:bg-blue-700 disabled:opacity-50"
                                    >
                                      Simular antes/depois
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setReplacementComponentId(null);
                                        setSimulation(null);
                                      }}
                                      className="px-3 py-1.5 rounded-lg border border-slate-200 text-[11px] font-semibold text-slate-600"
                                    >
                                      Cancelar
                                    </button>
                                  </div>

                                  {simulation && (
                                    <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
                                      <p className="text-[11px] font-bold text-slate-800">
                                        Simulação de impacto
                                      </p>
                                      <div className="grid grid-cols-3 gap-2 text-[11px] font-mono">
                                        <div>
                                          <p className="text-slate-400">Antes</p>
                                          <p className="font-bold">{formatBRL(simulation.before.total)}</p>
                                        </div>
                                        <div>
                                          <p className="text-slate-400">Depois</p>
                                          <p className="font-bold">{formatBRL(simulation.after.total)}</p>
                                        </div>
                                        <div>
                                          <p className="text-slate-400">Variação</p>
                                          <p
                                            className={`font-bold ${
                                              Number(simulation.diff.total) > 0
                                                ? "text-red-600"
                                                : Number(simulation.diff.total) < 0
                                                ? "text-emerald-600"
                                                : "text-slate-700"
                                            }`}
                                          >
                                            {Number(simulation.diff.total) > 0 ? "+" : ""}
                                            {formatBRL(simulation.diff.total)}
                                          </p>
                                        </div>
                                      </div>
                                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                                        <span>
                                          Componente:{" "}
                                          {formatBRL(simulation.componentBefore?.totalPrice ?? 0)} →{" "}
                                          {formatBRL(simulation.componentAfter?.totalPrice ?? 0)}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => void handleApplyReplacement()}
                                          disabled={saving}
                                          className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[11px] font-bold hover:bg-emerald-700 disabled:opacity-50"
                                        >
                                          Aplicar substituição
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Adicionar componente */}
              <section className="p-4 rounded-2xl border border-slate-200 bg-slate-50/60 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Adicionar componente
                  </h3>
                  <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setAddType("RESOURCE");
                        setQuery("");
                        setResourceResults([]);
                        setCompositionResults([]);
                      }}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-semibold ${
                        addType === "RESOURCE" ? "bg-blue-600 text-white" : "text-slate-600"
                      }`}
                    >
                      Insumo
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAddType("COMPOSITION");
                        setQuery("");
                        setResourceResults([]);
                        setCompositionResults([]);
                      }}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-semibold ${
                        addType === "COMPOSITION" ? "bg-purple-600 text-white" : "text-slate-600"
                      }`}
                    >
                      Auxiliar
                    </button>
                  </div>
                </div>

                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => void handleSearch(e.target.value)}
                    placeholder={
                      addType === "RESOURCE"
                        ? "Buscar insumo por código ou descrição..."
                        : "Buscar composição auxiliar por código ou descrição..."
                    }
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-xs bg-white"
                  />
                </div>

                <div className="max-h-44 overflow-y-auto space-y-1">
                  {(addType === "RESOURCE" ? resourceResults : compositionResults).map(
                    (option) => {
                      const isSelected =
                        addType === "RESOURCE"
                          ? selectedResourceId === option.id
                          : selectedChildId === option.id;

                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => {
                            if (addType === "RESOURCE") setSelectedResourceId(option.id);
                            else setSelectedChildId(option.id);
                          }}
                          className={`w-full text-left p-2 rounded-lg border text-[11px] transition-colors ${
                            isSelected
                              ? "border-blue-500 bg-blue-50"
                              : "border-slate-200 bg-white hover:border-slate-300"
                          }`}
                        >
                          <span className="font-mono font-bold text-blue-700">{option.code}</span>{" "}
                          {option.description} [{option.unit}]
                          {"price" in option && (
                            <span className="float-right font-mono font-bold text-slate-800">
                              {formatBRL((option as ResourceOption).price)}
                            </span>
                          )}
                          {"unitCostTotal" in option && (
                            <span className="float-right font-mono font-bold text-slate-800">
                              {formatBRL((option as CompositionOption).unitCostTotal)}
                            </span>
                          )}
                        </button>
                      );
                    }
                  )}
                </div>

                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex-1 min-w-32">
                    <label className="block text-[10px] font-semibold text-slate-600 mb-1">
                      Coeficiente de consumo
                    </label>
                    <input
                      type="text"
                      value={newCoefficient}
                      onChange={(e) => setNewCoefficient(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-mono bg-white"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleAddComponent()}
                    disabled={saving || !objectId}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : addType === "RESOURCE" ? (
                      <Package className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" />
                    )}
                    <span>Adicionar</span>
                  </button>
                </div>
              </section>
            </>
          ) : (
            <div className="p-10 text-center text-xs text-slate-500">
              Composição não disponível.
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
