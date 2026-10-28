"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  createBdiConfig,
  setDefaultBdiConfig,
  deleteBdiConfig,
  type BdiFormData,
} from "@/lib/actions/bdi";
import { calculateBdi } from "@/lib/engine/bdi";
import {
  Percent,
  Plus,
  CheckCircle2,
  Trash2,
  Star,
  Info,
  Loader2,
  X,
  Calculator,
  ArrowRight,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";

interface BdiConfigItem {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  bdiRate: string | number;
  ac: string | number;
  cf: string | number;
  s: string | number;
  g: string | number;
  mi: string | number;
  tm: string | number;
  te: string | number;
  tf: string | number;
  l: string | number;
  _count: {
    budgetRevisions: number;
  };
}

interface BdiManagementProps {
  initialConfigs: BdiConfigItem[];
}

// TCU 2622/2013 benchmarks for Edifícios
const TCU_EDIFICIOS_LIMITS = {
  ac: { q1: 3.00, med: 4.00, q3: 5.50 },
  s_g: { q1: 0.80, med: 0.80, q3: 1.00 },
  r: { q1: 0.97, med: 1.27, q3: 1.27 },
  df: { q1: 0.59, med: 1.23, q3: 1.39 },
  l: { q1: 6.16, med: 7.40, q3: 8.96 },
  bdi: { q1: 20.34, med: 22.12, q3: 25.00 },
};

export function BdiManagement({ initialConfigs }: BdiManagementProps) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState<BdiFormData>({
    name: "BDI - Construção Civil Geral",
    description: "Configuração baseada nas faixas referenciais do Acórdão TCU 2622/2013.",
    isDefault: false,
    ac: 4.00,
    cf: 1.23,
    s: 0.40,
    g: 0.40,
    mi: 1.27,
    tm: 2.50, // ISS médio
    te: 0.00, // ICMS
    tf: 3.65, // PIS 0.65% + COFINS 3.00%
    l: 7.40,
  });

  // Live calculation of BDI
  const liveCalc = useMemo(() => {
    return calculateBdi({
      ac: Number(formData.ac) || 0,
      cf: Number(formData.cf) || 0,
      s: Number(formData.s) || 0,
      g: Number(formData.g) || 0,
      mi: Number(formData.mi) || 0,
      tm: Number(formData.tm) || 0,
      te: Number(formData.te) || 0,
      tf: Number(formData.tf) || 0,
      l: Number(formData.l) || 0,
    });
  }, [formData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await createBdiConfig({
      ...formData,
      ac: Number(formData.ac) || 0,
      cf: Number(formData.cf) || 0,
      s: Number(formData.s) || 0,
      g: Number(formData.g) || 0,
      mi: Number(formData.mi) || 0,
      tm: Number(formData.tm) || 0,
      te: Number(formData.te) || 0,
      tf: Number(formData.tf) || 0,
      l: Number(formData.l) || 0,
    });

    if (!res.success) {
      setError(res.error || "Erro ao salvar configuração.");
      setLoading(false);
      return;
    }

    setModalOpen(false);
    setLoading(false);
    router.refresh();
  };

  const handleSetDefault = async (id: string) => {
    await setDefaultBdiConfig(id);
    router.refresh();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Deseja realmente excluir esta configuração de BDI?")) return;
    const res = await deleteBdiConfig(id);
    if (!res.success) {
      alert(res.error || "Erro ao excluir.");
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
            Bonificação e Despesas Indiretas (BDI)
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Fórmula canônica e referencial de conformidade com o <strong>Acórdão TCU nº 2622/2013</strong>.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setModalOpen(true);
          }}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold shadow-md shadow-blue-600/20 hover:bg-blue-700 transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Nova Configuração BDI</span>
        </button>
      </div>

      {/* TCU Formula Information Card */}
      <div className="bg-gradient-to-r from-blue-50/80 via-white to-indigo-50/50 p-6 rounded-2xl border border-blue-200/80 shadow-xs">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center flex-shrink-0 shadow-md shadow-blue-600/20">
            <Calculator className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">
                Fórmula Padronizada Oficial do TCU
              </h2>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 uppercase">
                Acórdão 2622/2013 - Plenário
              </span>
            </div>
            <div className="mt-2 text-xs text-slate-700 font-mono bg-white/80 p-3 rounded-xl border border-blue-100 shadow-2xs overflow-x-auto">
              BDI = [ ( (1 + AC + CF + S + G + MI) / (1 - (TM + TE + TF + L)) ) - 1 ] &times; 100
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Onde o numerador engloba despesas indiretas sobre custo direto e o denominador deduz a carga tributária incidente sobre o preço final somada ao lucro do empreendimento.
            </p>
          </div>
        </div>
      </div>

      {/* Configurations List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {initialConfigs.map((cfg) => {
          const rateNumber = Number(cfg.bdiRate);
          const acPercent = (Number(cfg.ac) * 100).toFixed(2);
          const lucroPercent = (Number(cfg.l) * 100).toFixed(2);
          const tributosPercent = (
            (Number(cfg.tm) + Number(cfg.te) + Number(cfg.tf)) *
            100
          ).toFixed(2);

          return (
            <div
              key={cfg.id}
              className={`bg-white rounded-2xl border p-5 shadow-xs transition-all flex flex-col justify-between ${
                cfg.isDefault
                  ? "border-blue-300 ring-2 ring-blue-500/10"
                  : "border-slate-200/80 hover:shadow-md"
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    {cfg.isDefault ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                        <Star className="w-3 h-3 fill-blue-600 text-blue-600" />
                        <span>Padrão</span>
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400 font-medium">BDI Específico</span>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    {!cfg.isDefault && (
                      <button
                        type="button"
                        onClick={() => handleSetDefault(cfg.id)}
                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Tornar padrão para novos orçamentos"
                      >
                        <Star className="w-4 h-4" />
                      </button>
                    )}
                    {cfg._count.budgetRevisions === 0 && (
                      <button
                        type="button"
                        onClick={() => handleDelete(cfg.id)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Excluir configuração"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                <h3 className="text-base font-bold text-slate-900">{cfg.name}</h3>
                {cfg.description && (
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2">{cfg.description}</p>
                )}

                {/* Big Rate Badge */}
                <div className="mt-4 p-4 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    Taxa BDI Calculada
                  </span>
                  <span className="text-2xl font-black text-blue-600 tracking-tight font-mono">
                    {rateNumber.toFixed(2)}%
                  </span>
                </div>

                {/* Component Breakdown Mini Grid */}
                <div className="mt-4 pt-3 border-t border-slate-100 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="p-2 rounded-lg bg-slate-50">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold">Adm. Central</span>
                    <div className="font-bold text-slate-700 mt-0.5">{acPercent}%</div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold">Lucro</span>
                    <div className="font-bold text-slate-700 mt-0.5">{lucroPercent}%</div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold">Tributos</span>
                    <div className="font-bold text-slate-700 mt-0.5">{tributosPercent}%</div>
                  </div>
                </div>
              </div>

              <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-medium">
                <span>{cfg._count.budgetRevisions} orçamento(s) vinculado(s)</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal Creator with Live TCU Simulator */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-3xl w-full p-6 sm:p-8 shadow-2xl border border-slate-200 space-y-6 max-h-[90vh] overflow-y-auto my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Cadastrar Configuração de BDI
                </h3>
                <p className="text-xs text-slate-500">
                  Simulação em tempo real e cálculo exato via Acórdão TCU 2622/2013.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {error && (
              <div className="p-3.5 rounded-xl bg-red-50 text-red-700 text-xs border border-red-200">
                {error}
              </div>
            )}

            {/* Live Result Banner */}
            <div className="bg-blue-600 text-white rounded-2xl p-5 shadow-lg shadow-blue-600/20 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <span className="text-xs font-semibold text-blue-200 uppercase tracking-wider">
                  Taxa Calculada Resultante
                </span>
                <div className="text-3xl sm:text-4xl font-extrabold font-mono mt-1">
                  {liveCalc.isValid ? `${liveCalc.rate.toNumber().toFixed(4)}%` : "Inválido"}
                </div>
                <p className="text-xs text-blue-100 mt-1">
                  {liveCalc.isValid
                    ? `Numerador A = ${liveCalc.factorA.toNumber().toFixed(4)} | Denominador B = ${liveCalc.factorB.toNumber().toFixed(4)}`
                    : liveCalc.validationErrors[0]}
                </p>
              </div>

              <div className="flex items-center gap-2 bg-white/10 px-4 py-2 rounded-xl backdrop-blur-xs text-xs">
                <ShieldCheck className="w-5 h-5 text-emerald-300" />
                <span>Precisão Decimal Exata TCU</span>
              </div>
            </div>

            {/* Calculation Memory */}
            <details className="rounded-xl border border-slate-200 bg-slate-50/60">
              <summary className="cursor-pointer list-none px-4 py-3 text-xs font-semibold text-slate-700 flex items-center gap-2">
                <Calculator className="w-4 h-4 text-blue-600" />
                <span>Memória de cálculo do BDI</span>
              </summary>
              <div className="border-t border-slate-200 px-4 py-3">
                <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-600">
                  {liveCalc.memory.steps.join("\n")}
                </pre>
              </div>
            </details>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1 sm:col-span-2">
                  <label className="text-xs font-semibold text-slate-700">
                    Nome da Configuração <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="space-y-1 sm:col-span-2">
                  <label className="text-xs font-semibold text-slate-700">Descrição / Justificativa</label>
                  <input
                    type="text"
                    value={formData.description || ""}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Group 1: Numerador (Custos Indiretos) */}
              <div>
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3 pb-1 border-b border-slate-100">
                  Parcela 1: Custos Indiretos (Numerador da Fórmula)
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-700">AC: Adm. Central (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.ac}
                      onChange={(e) => setFormData({ ...formData, ac: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    />
                    <span className="text-[10px] text-slate-400">Ref: 3,00% a 5,50%</span>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-700">CF: Custo Financ. (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.cf}
                      onChange={(e) => setFormData({ ...formData, cf: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    />
                    <span className="text-[10px] text-slate-400">Ref: 0,59% a 1,39%</span>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-700">S: Seguros (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.s}
                      onChange={(e) => setFormData({ ...formData, s: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    />
                    <span className="text-[10px] text-slate-400">S + G: 0,80% a 1,00%</span>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-700">G: Garantias (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.g}
                      onChange={(e) => setFormData({ ...formData, g: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-700">MI: Riscos (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.mi}
                      onChange={(e) => setFormData({ ...formData, mi: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    />
                    <span className="text-[10px] text-slate-400">Ref: 0,97% a 1,27%</span>
                  </div>
                </div>
              </div>

              {/* Group 2: Denominador (Tributos e Lucro) */}
              <div>
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3 pb-1 border-b border-slate-100">
                  Parcela 2: Tributos e Lucro (Denominador da Fórmula)
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-700">L: Lucro Líquido (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.l}
                      onChange={(e) => setFormData({ ...formData, l: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    />
                    <span className="text-[10px] text-slate-400">Ref: 6,16% a 8,96%</span>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-700">TM: ISS Municipal (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.tm}
                      onChange={(e) => setFormData({ ...formData, tm: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    />
                    <span className="text-[10px] text-slate-400">Geralmente 2% a 5%</span>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-700">TF: PIS/COFINS (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.tf}
                      onChange={(e) => setFormData({ ...formData, tf: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    />
                    <span className="text-[10px] text-slate-400">Cumulativo: 3,65%</span>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-700">TE: ICMS (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.te}
                      onChange={(e) => setFormData({ ...formData, te: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    />
                    <span className="text-[10px] text-slate-400">Quando aplicável</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="isDefault"
                  checked={formData.isDefault}
                  onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
                />
                <label htmlFor="isDefault" className="text-xs font-semibold text-slate-700">
                  Definir como taxa de BDI padrão para novas obras e orçamentos
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  disabled={loading}
                  className="px-4 py-2 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading || !liveCalc.isValid}
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 shadow-md shadow-blue-600/20"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  <span>Salvar BDI</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
