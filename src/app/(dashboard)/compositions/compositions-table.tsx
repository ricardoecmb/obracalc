"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  createCompositionAction,
  deleteCompositionAction,
  duplicateCompositionAction,
  type CompositionFormData,
} from "@/lib/actions/compositions";
import { CompositionEditor } from "./composition-editor";
import { DatabaseSource, TaxRegime, CompositionType } from "@prisma/client";
import {
  Layers,
  Plus,
  Search,
  Filter,
  Trash2,
  X,
  Loader2,
  Upload,
  Lock,
  Network,
  Edit2,
  Copy,
} from "lucide-react";
import Link from "next/link";

interface CompositionItem {
  id: string;
  code: string;
  description: string;
  unit: string;
  source: DatabaseSource;
  sourceState: string | null;
  sourceMonth: string | null;
  sourceTaxRegime: TaxRegime | null;
  type: CompositionType;
  closedTotalPrice: string | number | null;
  closedMaterialPrice: string | number | null;
  closedLaborPrice: string | number | null;
  closedEquipmentPrice: string | number | null;
  version: number;
  _count: {
    components: number;
    budgetItems: number;
  };
}

interface CompositionsTableProps {
  initialCompositions: CompositionItem[];
}

const BRAZILIAN_STATES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA",
  "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN",
  "RS", "RO", "RR", "SC", "SP", "SE", "TO"
];

export function CompositionsTable({ initialCompositions }: CompositionsTableProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingCompositionId, setEditingCompositionId] = useState<string | null>(null);

  const [formData, setFormData] = useState<CompositionFormData>({
    code: "",
    description: "",
    unit: "m²",
    source: DatabaseSource.CUSTOM,
    sourceState: "SP",
    sourceMonth: "2024/01",
    sourceTaxRegime: TaxRegime.DESONERADO,
    type: CompositionType.ANALYTICAL,
    closedTotalPrice: null,
    closedMaterialPrice: null,
    closedLaborPrice: null,
    closedEquipmentPrice: null,
    notes: "",
  });

  const filteredCompositions = useMemo(() => {
    return initialCompositions.filter((c) => {
      const matchSearch =
        c.code.toLowerCase().includes(search.toLowerCase()) ||
        c.description.toLowerCase().includes(search.toLowerCase());
      const matchType = typeFilter === "ALL" || c.type === typeFilter;
      return matchSearch && matchType;
    });
  }, [initialCompositions, search, typeFilter]);

  const handleOpenCreate = () => {
    setFormData({
      code: "",
      description: "",
      unit: "m²",
      source: DatabaseSource.CUSTOM,
      sourceState: "SP",
      sourceMonth: "2024/01",
      sourceTaxRegime: TaxRegime.DESONERADO,
      type: CompositionType.ANALYTICAL,
      closedTotalPrice: null,
      closedMaterialPrice: null,
      closedLaborPrice: null,
      closedEquipmentPrice: null,
      notes: "",
    });
    setError(null);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await createCompositionAction(formData);
    setLoading(false);

    if (!res.success) {
      setError(res.error || "Erro ao salvar composição.");
      return;
    }

    setModalOpen(false);
    router.refresh();
  };

  const handleDelete = async (id: string, code: string) => {
    if (!confirm(`Deseja realmente excluir a composição ${code}?`)) return;

    const res = await deleteCompositionAction(id);
    if (!res.success) {
      alert(res.error || "Erro ao excluir composição.");
      return;
    }
    router.refresh();
  };

  const handleDuplicate = async (id: string, code: string) => {
    if (!confirm(`Duplicar a composição ${code}? A origem será preservada.`)) return;

    const res = await duplicateCompositionAction({ compositionId: id });
    if (!res.success) {
      alert(res.error || "Erro ao duplicar composição.");
      return;
    }
    router.refresh();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Composições de Custos Unitários
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Composições analíticas detalhadas ou composições fechadas de bases oficiais.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/import"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-slate-300 text-slate-700 text-sm font-semibold hover:bg-slate-50 transition-all shadow-xs"
          >
            <Upload className="w-4 h-4 text-blue-600" />
            <span>Importar CSV</span>
          </Link>
          <button
            type="button"
            onClick={handleOpenCreate}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold shadow-md shadow-blue-600/20 hover:bg-blue-700 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Nova Composição</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por código ou descrição da composição..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="w-4 h-4 text-slate-400" />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white text-slate-700"
          >
            <option value="ALL">Todos os Tipos</option>
            <option value="ANALYTICAL">Analíticas (Detalhadas)</option>
            <option value="CLOSED">Fechadas (Preço de Referência)</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        {filteredCompositions.length === 0 ? (
          <div className="py-14 text-center px-4">
            <Layers className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <h3 className="text-base font-bold text-slate-900">Nenhuma composição encontrada</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              Utilize o botão &ldquo;Nova Composição&rdquo; para criar um serviço ou &ldquo;Importar CSV&rdquo; para carregar tabelas do SINAPI.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50/70 border-b border-slate-200/80 text-slate-500 uppercase tracking-wider font-semibold">
                  <th className="p-3.5">Código</th>
                  <th className="p-3.5">Descrição do Serviço</th>
                  <th className="p-3.5 text-center">Unidade</th>
                  <th className="p-3.5 text-center">Tipo</th>
                  <th className="p-3.5 text-center">Origem / Competência</th>
                  <th className="p-3.5 text-right">Custo Unitário Total</th>
                  <th className="p-3.5 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredCompositions.map((comp) => {
                  const isClosed = comp.type === "CLOSED";
                  const priceFormatted = comp.closedTotalPrice
                    ? new Intl.NumberFormat("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      }).format(Number(comp.closedTotalPrice))
                    : "Cálculo Dinâmico";

                  return (
                    <tr key={comp.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3.5 font-mono font-bold text-slate-900 whitespace-nowrap">
                        {comp.code}
                      </td>
                      <td className="p-3.5 max-w-md">
                        <div className="font-semibold text-slate-800 line-clamp-2">
                          {comp.description}
                        </div>
                      </td>
                      <td className="p-3.5 text-center font-mono text-slate-600 whitespace-nowrap">
                        {comp.unit}
                      </td>
                      <td className="p-3.5 text-center whitespace-nowrap">
                        {isClosed ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                            <Lock className="w-3 h-3" />
                            <span>Fechada</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                            <Network className="w-3 h-3" />
                            <span>Analítica ({comp._count.components} itens)</span>
                          </span>
                        )}
                      </td>
                      <td className="p-3.5 text-center font-mono text-slate-500 whitespace-nowrap">
                        {comp.source} &bull; {comp.sourceMonth || "-"} {comp.sourceState ? `(${comp.sourceState})` : ""}
                      </td>
                      <td className="p-3.5 text-right font-mono font-extrabold text-slate-900 whitespace-nowrap">
                        {priceFormatted}
                      </td>
                      <td className="p-3.5 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => setEditingCompositionId(comp.id)}
                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Abrir editor de composição"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDuplicate(comp.id, comp.code)}
                            className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                            title="Duplicar composição"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(comp.id, comp.code)}
                            disabled={comp._count.budgetItems > 0}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30 rounded-lg transition-colors"
                            title="Excluir composição"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Dialog for Composition Creation */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 sm:p-8 shadow-2xl border border-slate-200 space-y-4 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Cadastrar Nova Composição</h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-red-50 text-red-700 text-xs border border-red-200">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">
                    Código <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: COMP-01"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">
                    Unidade <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="m², m³, un..."
                    value={formData.unit}
                    onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">Tipo de Composição</label>
                  <select
                    value={formData.type}
                    onChange={(e) =>
                      setFormData({ ...formData, type: e.target.value as CompositionType })
                    }
                    className="w-full px-2.5 py-2 rounded-xl border border-slate-300 text-xs bg-white"
                  >
                    <option value="ANALYTICAL">Analítica</option>
                    <option value="CLOSED">Fechada</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  Descrição do Serviço <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={2}
                  required
                  placeholder="Descrição técnica da composição..."
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                />
              </div>

              {formData.type === "CLOSED" && (
                <div className="p-4 rounded-xl bg-amber-50/50 border border-amber-200/80 space-y-3">
                  <h4 className="text-xs font-bold text-amber-900">
                    Valores Fechados de Referência (Preservados sem rateio artificial)
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">Custo Total (R$)</label>
                      <input
                        type="number"
                        step="0.0001"
                        min="0"
                        value={formData.closedTotalPrice || ""}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            closedTotalPrice: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono font-bold"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-700">Parcela Material (R$)</label>
                      <input
                        type="number"
                        step="0.0001"
                        min="0"
                        value={formData.closedMaterialPrice || ""}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            closedMaterialPrice: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-100">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">Origem</label>
                  <select
                    value={formData.source}
                    onChange={(e) => setFormData({ ...formData, source: e.target.value as DatabaseSource })}
                    className="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 text-xs bg-white"
                  >
                    <option value="CUSTOM">Próprio</option>
                    <option value="SINAPI">SINAPI</option>
                    <option value="SICRO">SICRO</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">UF</label>
                  <select
                    value={formData.sourceState || ""}
                    onChange={(e) => setFormData({ ...formData, sourceState: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 text-xs bg-white"
                  >
                    {BRAZILIAN_STATES.map((uf) => (
                      <option key={uf} value={uf}>
                        {uf}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">Competência</label>
                  <input
                    type="text"
                    placeholder="2024/01"
                    value={formData.sourceMonth}
                    onChange={(e) => setFormData({ ...formData, sourceMonth: e.target.value })}
                    className="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 text-xs font-mono"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  disabled={loading}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50 shadow-md shadow-blue-600/20"
                >
                  {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  <span>Cadastrar Composição</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Editor de Composição (drawer lateral) */}
      {editingCompositionId && (
        <CompositionEditor
          compositionId={editingCompositionId}
          onClose={() => {
            setEditingCompositionId(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
