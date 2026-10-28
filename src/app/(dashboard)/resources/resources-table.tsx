"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  createResourceAction,
  updateResourceAction,
  deleteResourceAction,
  createResourceEquivalenceAction,
  confirmResourceEquivalenceAction,
  deleteResourceEquivalenceAction,
  listResourceEquivalences,
  type ResourceFormData,
} from "@/lib/actions/resources";
import { DatabaseSource, TaxRegime, ResourceCategory } from "@prisma/client";
import {
  Package,
  Plus,
  Search,
  Filter,
  Trash2,
  Edit2,
  X,
  Loader2,
  Upload,
  ArrowLeftRight,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

interface ResourceItem {
  id: string;
  code: string;
  description: string;
  unit: string;
  category: ResourceCategory;
  source: DatabaseSource;
  sourceState: string | null;
  sourceMonth: string | null;
  sourceTaxRegime: TaxRegime | null;
  price: string | number;
  laborChargesIncluded: boolean;
  laborChargesRate: string | number | null;
  notes: string | null;
  supplier: { id: string; name: string } | null;
}

interface ResourcesTableProps {
  initialResources: ResourceItem[];
}

interface EquivalenceRow {
  id: string;
  confirmed: boolean;
  confirmedBy: string | null;
  justification: string | null;
  source: { id: string; code: string; description: string; unit: string; price: string };
  target: { id: string; code: string; description: string; unit: string; price: string };
}

const BRAZILIAN_STATES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA",
  "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN",
  "RS", "RO", "RR", "SC", "SP", "SE", "TO"
];

const categoryLabels: Record<ResourceCategory, { label: string; badge: string }> = {
  MATERIAL: { label: "Material", badge: "bg-blue-50 text-blue-700 border-blue-200" },
  LABOR: { label: "Mão de Obra", badge: "bg-amber-50 text-amber-700 border-amber-200" },
  EQUIPMENT: { label: "Equipamento", badge: "bg-purple-50 text-purple-700 border-purple-200" },
  OTHER: { label: "Outros", badge: "bg-slate-100 text-slate-700 border-slate-200" },
};

export function ResourcesTable({ initialResources }: ResourcesTableProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Equivalências de insumos
  const [equivalenceResource, setEquivalenceResource] = useState<ResourceItem | null>(null);
  const [equivalences, setEquivalences] = useState<EquivalenceRow[]>([]);
  const [equivalenceLoading, setEquivalenceLoading] = useState(false);
  const [equivalenceError, setEquivalenceError] = useState<string | null>(null);
  const [equivalentTargetId, setEquivalentTargetId] = useState("");
  const [equivalenceJustification, setEquivalenceJustification] = useState("");

  const [formData, setFormData] = useState<ResourceFormData>({
    code: "",
    description: "",
    unit: "un",
    category: ResourceCategory.MATERIAL,
    source: DatabaseSource.CUSTOM,
    sourceState: "SP",
    sourceMonth: "2024/01",
    sourceTaxRegime: TaxRegime.DESONERADO,
    price: 0,
    laborChargesIncluded: false,
    laborChargesRate: null,
    supplierId: null,
    notes: "",
  });

  const filteredResources = useMemo(() => {
    return initialResources.filter((r) => {
      const matchSearch =
        r.code.toLowerCase().includes(search.toLowerCase()) ||
        r.description.toLowerCase().includes(search.toLowerCase());
      const matchCat =
        selectedCategory === "ALL" || r.category === selectedCategory;
      return matchSearch && matchCat;
    });
  }, [initialResources, search, selectedCategory]);

  const handleOpenCreate = () => {
    setEditingId(null);
    setFormData({
      code: "",
      description: "",
      unit: "un",
      category: ResourceCategory.MATERIAL,
      source: DatabaseSource.CUSTOM,
      sourceState: "SP",
      sourceMonth: "2024/01",
      sourceTaxRegime: TaxRegime.DESONERADO,
      price: 0,
      laborChargesIncluded: false,
      laborChargesRate: null,
      supplierId: null,
      notes: "",
    });
    setError(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (res: ResourceItem) => {
    setEditingId(res.id);
    setFormData({
      code: res.code,
      description: res.description,
      unit: res.unit,
      category: res.category,
      source: res.source,
      sourceState: res.sourceState,
      sourceMonth: res.sourceMonth || "2024/01",
      sourceTaxRegime: res.sourceTaxRegime,
      price: Number(res.price),
      laborChargesIncluded: res.laborChargesIncluded,
      laborChargesRate: res.laborChargesRate ? Number(res.laborChargesRate) : null,
      supplierId: res.supplier?.id || null,
      notes: res.notes || "",
    });
    setError(null);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    let res;
    if (editingId) {
      res = await updateResourceAction(editingId, formData);
    } else {
      res = await createResourceAction(formData);
    }

    setLoading(false);

    if (!res.success) {
      setError(res.error || "Erro ao salvar insumo.");
      return;
    }

    setModalOpen(false);
    router.refresh();
  };

  const handleDelete = async (id: string, code: string) => {
    if (!confirm(`Deseja realmente excluir o insumo ${code}?`)) return;

    const res = await deleteResourceAction(id);
    if (!res.success) {
      alert(res.error || "Erro ao excluir insumo.");
      return;
    }
    router.refresh();
  };

  // ==========================================================================
  // EQUIVALÊNCIAS
  // ==========================================================================

  const loadEquivalences = async (resourceId: string) => {
    setEquivalenceLoading(true);
    const res = await listResourceEquivalences(resourceId);
    setEquivalenceLoading(false);

    if (!res.success) {
      setEquivalenceError(res.error || "Erro ao carregar equivalências.");
      setEquivalences([]);
      return;
    }

    setEquivalences(res.equivalences as EquivalenceRow[]);
  };

  const handleOpenEquivalences = async (resource: ResourceItem) => {
    setEquivalenceResource(resource);
    setEquivalences([]);
    setEquivalenceError(null);
    setEquivalentTargetId("");
    setEquivalenceJustification("");
    await loadEquivalences(resource.id);
  };

  const handleCreateEquivalence = async () => {
    if (!equivalenceResource || !equivalentTargetId) {
      setEquivalenceError("Selecione o insumo equivalente.");
      return;
    }

    setEquivalenceLoading(true);
    const res = await createResourceEquivalenceAction({
      sourceResourceId: equivalenceResource.id,
      targetResourceId: equivalentTargetId,
      justification: equivalenceJustification || null,
    });
    setEquivalenceLoading(false);

    if (!res.success) {
      setEquivalenceError(res.error || "Erro ao criar equivalência.");
      return;
    }

    setEquivalenceError(null);
    setEquivalentTargetId("");
    setEquivalenceJustification("");
    await loadEquivalences(equivalenceResource.id);
  };

  const handleConfirmEquivalence = async (equivalenceId: string) => {
    setEquivalenceLoading(true);
    const res = await confirmResourceEquivalenceAction({ equivalenceId });
    setEquivalenceLoading(false);

    if (!res.success) {
      setEquivalenceError(res.error || "Erro ao confirmar equivalência.");
      return;
    }

    if (equivalenceResource) await loadEquivalences(equivalenceResource.id);
    router.refresh();
  };

  const handleDeleteEquivalence = async (equivalenceId: string) => {
    if (!confirm("Remover esta equivalência?")) return;

    setEquivalenceLoading(true);
    const res = await deleteResourceEquivalenceAction(equivalenceId);
    setEquivalenceLoading(false);

    if (!res.success) {
      setEquivalenceError(res.error || "Erro ao remover equivalência.");
      return;
    }

    if (equivalenceResource) await loadEquivalences(equivalenceResource.id);
    router.refresh();
  };

  return (
    <div className="space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Catálogo de Insumos
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Preços unitários de materiais, mão de obra com encargos, equipamentos e serviços.
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
            <span>Novo Insumo</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-xs flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por código ou descrição do insumo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="w-4 h-4 text-slate-400" />
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200 text-xs bg-white text-slate-700"
          >
            <option value="ALL">Todas as Categorias</option>
            <option value="MATERIAL">Materiais</option>
            <option value="LABOR">Mão de Obra</option>
            <option value="EQUIPMENT">Equipamentos</option>
            <option value="OTHER">Outros / Serviços</option>
          </select>
        </div>
      </div>

      {/* Resources Table / List */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        {filteredResources.length === 0 ? (
          <div className="py-14 text-center px-4">
            <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <h3 className="text-base font-bold text-slate-900">Nenhum insumo encontrado</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              Utilize o botão &ldquo;Novo Insumo&rdquo; ou a ferramenta de &ldquo;Importar CSV&rdquo; para carregar tabelas oficiais SINAPI/SICRO.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50/70 border-b border-slate-200/80 text-slate-500 uppercase tracking-wider font-semibold">
                  <th className="p-3.5">Código</th>
                  <th className="p-3.5">Descrição</th>
                  <th className="p-3.5 text-center">Unidade</th>
                  <th className="p-3.5 text-center">Categoria</th>
                  <th className="p-3.5 text-center">Competência / UF</th>
                  <th className="p-3.5 text-right">Preço Unitário</th>
                  <th className="p-3.5 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredResources.map((res) => {
                  const catConfig = categoryLabels[res.category] || categoryLabels.MATERIAL;
                  const priceFormatted = new Intl.NumberFormat("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  }).format(Number(res.price));

                  return (
                    <tr key={res.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3.5 font-mono font-bold text-slate-900 whitespace-nowrap">
                        {res.code}
                      </td>
                      <td className="p-3.5 max-w-md">
                        <div className="font-semibold text-slate-800 line-clamp-2">
                          {res.description}
                        </div>
                        {res.laborChargesIncluded && (
                          <span className="inline-block mt-1 text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                            Encargos sociais inclusos
                          </span>
                        )}
                      </td>
                      <td className="p-3.5 text-center font-mono text-slate-600 whitespace-nowrap">
                        {res.unit}
                      </td>
                      <td className="p-3.5 text-center whitespace-nowrap">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold border ${catConfig.badge}`}
                        >
                          {catConfig.label}
                        </span>
                      </td>
                      <td className="p-3.5 text-center font-mono text-slate-500 whitespace-nowrap">
                        {res.sourceMonth || "-"} {res.sourceState ? `(${res.sourceState})` : ""}
                      </td>
                      <td className="p-3.5 text-right font-mono font-extrabold text-slate-900 whitespace-nowrap">
                        {priceFormatted}
                      </td>
                      <td className="p-3.5 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(res)}
                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Editar insumo"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenEquivalences(res)}
                            className="p-1.5 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                            title="Gerenciar equivalentes"
                          >
                            <ArrowLeftRight className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(res.id, res.code)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Excluir insumo"
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

      {/* Modal Dialog for Resource Create/Edit */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 sm:p-8 shadow-2xl border border-slate-200 space-y-4 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">
                {editingId ? "Editar Insumo" : "Cadastrar Novo Insumo"}
              </h3>
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
                    placeholder="Ex: 88309"
                    value={formData.code}
                    disabled={!!editingId}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono disabled:bg-slate-100"
                  />
                </div>

                <div className="space-y-1 col-span-2">
                  <label className="text-xs font-semibold text-slate-700">
                    Categoria <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={formData.category}
                    onChange={(e) =>
                      setFormData({ ...formData, category: e.target.value as ResourceCategory })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white"
                  >
                    <option value="MATERIAL">Material</option>
                    <option value="LABOR">Mão de Obra</option>
                    <option value="EQUIPMENT">Equipamento</option>
                    <option value="OTHER">Outros / Serviços</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700">
                  Descrição do Insumo <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={2}
                  required
                  placeholder="Descrição técnica detalhada..."
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700">
                    Unidade <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="m², kg, h..."
                    value={formData.unit}
                    onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono"
                  />
                </div>

                <div className="space-y-1 col-span-2">
                  <label className="text-xs font-semibold text-slate-700">
                    Preço Unitário (R$) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    min="0"
                    required
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono font-bold"
                  />
                </div>
              </div>

              {!editingId && (
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
                      <option value="SUPPLIER">Fornecedor</option>
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
              )}

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="laborCharges"
                  checked={formData.laborChargesIncluded}
                  onChange={(e) => setFormData({ ...formData, laborChargesIncluded: e.target.checked })}
                  className="rounded border-slate-300 text-blue-600 h-4 w-4"
                />
                <label htmlFor="laborCharges" className="text-xs text-slate-700">
                  Encargos sociais já inclusos no preço (mão de obra)
                </label>
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
                  <span>{editingId ? "Salvar Alterações" : "Cadastrar Insumo"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* ===================================================================== */}
      {/* MODAL DE EQUIVALÊNCIAS DE INSUMOS                                    */}
      {/* ===================================================================== */}
      {equivalenceResource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 sm:p-8 shadow-2xl border border-slate-200 space-y-4 my-8">
            <div className="flex items-start justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base font-bold text-slate-900 inline-flex items-center gap-2">
                  <ArrowLeftRight className="w-4 h-4 text-purple-600" />
                  Equivalentes de {equivalenceResource.code}
                </h3>
                <p className="text-xs text-slate-500 mt-1 max-w-lg">
                  {equivalenceResource.description} [{equivalenceResource.unit}]. Somente
                  equivalências <strong>confirmadas</strong> podem ser usadas para substituir
                  insumos em composições.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEquivalenceResource(null)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {equivalenceError && (
              <div className="p-3 rounded-xl bg-red-50 text-red-700 text-xs border border-red-200">
                {equivalenceError}
              </div>
            )}

            <div className="space-y-2 max-h-64 overflow-y-auto">
              {equivalenceLoading && equivalences.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin mx-auto mb-1" />
                  Carregando...
                </div>
              ) : equivalences.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl">
                  Nenhuma equivalência cadastrada para este insumo.
                </div>
              ) : (
                equivalences.map((equivalence) => {
                  const other =
                    equivalence.source.id === equivalenceResource.id
                      ? equivalence.target
                      : equivalence.source;

                  return (
                    <div
                      key={equivalence.id}
                      className="p-3 rounded-xl border border-slate-200 text-xs space-y-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <span className="font-mono font-bold text-purple-700">
                            {other.code}
                          </span>{" "}
                          {other.description} [{other.unit}]
                          <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                            {new Intl.NumberFormat("pt-BR", {
                              style: "currency",
                              currency: "BRL",
                            }).format(Number(other.price))}
                          </div>
                          {equivalence.justification && (
                            <p className="text-[11px] text-slate-500 mt-1">
                              {equivalence.justification}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-1 flex-shrink-0">
                          {equivalence.confirmed ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <ShieldCheck className="w-3 h-3" />
                              Confirmada
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleConfirmEquivalence(equivalence.id)}
                              disabled={equivalenceLoading}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[10px] font-bold hover:bg-emerald-700 disabled:opacity-50"
                            >
                              Confirmar
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteEquivalence(equivalence.id)}
                            disabled={equivalenceLoading}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 space-y-2">
              <p className="text-xs font-bold text-slate-800">Adicionar equivalência</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <select
                  value={equivalentTargetId}
                  onChange={(e) => setEquivalentTargetId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white"
                >
                  <option value="">Selecione o insumo equivalente...</option>
                  {initialResources
                    .filter((resource) => resource.id !== equivalenceResource.id)
                    .map((resource) => (
                      <option key={resource.id} value={resource.id}>
                        {resource.code} — {resource.description} [{resource.unit}]
                      </option>
                    ))}
                </select>
                <input
                  type="text"
                  value={equivalenceJustification}
                  onChange={(e) => setEquivalenceJustification(e.target.value)}
                  placeholder="Justificativa técnica (opcional)"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                />
              </div>
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={handleCreateEquivalence}
                  disabled={equivalenceLoading || !equivalentTargetId}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 text-white text-xs font-bold hover:bg-purple-700 disabled:opacity-50"
                >
                  {equivalenceLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Plus className="w-3.5 h-3.5" />
                  )}
                  <span>Cadastrar Equivalência</span>
                </button>
              </div>
              <p className="text-[10px] text-slate-400">
                A equivalência nasce como não confirmada e não pode ser usada em substituições
                até ser confirmada.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
