"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  ArrowLeft,
  Building2,
  Database,
  Percent,
  CheckCircle2,
  Sliders,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { createBudget, type CreateBudgetInput } from "@/lib/actions/budgets";
import type { RoundingMode } from "@/lib/engine/types";
import { TaxRegime } from "@prisma/client";

type WizardStep = 1 | 2 | 3 | 4;

interface ProjectOption {
  id: string;
  name: string;
  state: string | null;
  clientName: string | null;
}

interface BdiOption {
  id: string;
  name: string;
  bdiRate: string | number;
  isDefault: boolean;
}

interface RefDbOption {
  id: string;
  name: string;
  source: string;
  state: string | null;
  referenceMonth: string | null;
  taxRegime: string | null;
}

interface BudgetWizardProps {
  projects: ProjectOption[];
  bdiConfigs: BdiOption[];
  referenceDatabases: RefDbOption[];
  templates?: Array<{
    id: string;
    name: string;
    description: string | null;
    stageCount: number;
    itemCount: number;
  }>;
}

const BRAZILIAN_STATES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA",
  "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN",
  "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

export function BudgetWizard({
  projects,
  bdiConfigs,
  referenceDatabases,
  templates = [],
}: BudgetWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goToPreviousStep = () =>
    setStep((current) => (current === 1 ? 1 : ((current - 1) as WizardStep)));
  const goToNextStep = () =>
    setStep((current) => (current === 4 ? 4 : ((current + 1) as WizardStep)));

  const defaultBdi = bdiConfigs.find((b) => b.isDefault) || bdiConfigs[0];

  const [formData, setFormData] = useState<CreateBudgetInput>({
    projectId: projects[0]?.id || "",
    title: "",
    description: "",
    technicalResponsible: "",
    baseDate: new Date().toISOString().slice(0, 10),
    notes: "",

    // Tabela de Referência
    referenceDatabaseId: referenceDatabases[0]?.id || null,
    referenceState: "SP",
    referenceMonth: "2024/01",
    referenceTaxRegime: TaxRegime.DESONERADO,

    // BDI
    bdiConfigId: defaultBdi?.id || null,

    // Modelo de EAP
    templateId: null,

    // Precisão
    roundingPriceDecimals: 4,
    roundingQuantityDecimals: 4,
    roundingCoefficientDecimals: 5,
    roundingTotalDecimals: 2,
    roundingMode: "ROUND_HALF_UP",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.projectId) {
      setError("Selecione uma obra vinculada.");
      return;
    }
    if (!formData.title.trim()) {
      setError("Informe o título do orçamento.");
      return;
    }

    setSubmitting(true);
    setError(null);

    const res = await createBudget(formData);
    if (!res.success) {
      setError(res.error || "Erro ao criar orçamento");
      setSubmitting(false);
    } else {
      router.push(`/budgets/${res.budgetId}`);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Novo Orçamento de Obras
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Configure parâmetros da EAP, bases de dados SINAPI/SICRO, regime de BDI e política de arredondamento.
          </p>
        </div>
        <Link
          href="/budgets"
          className="text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors"
        >
          Cancelar
        </Link>
      </div>

      {/* Stepper Tabs */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-3 shadow-xs">
        <div className="grid grid-cols-4 gap-2">
          <button
            type="button"
            onClick={() => setStep(1)}
            className={`flex items-center gap-2.5 p-3 rounded-xl transition-all text-left ${
              step === 1
                ? "bg-blue-50 text-blue-700 font-semibold"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${
              step === 1 ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"
            }`}>
              1
            </div>
            <div className="hidden sm:block">
              <p className="text-xs font-semibold">Identificação</p>
              <p className="text-[10px] text-slate-400">Obra e dados gerais</p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setStep(2)}
            className={`flex items-center gap-2.5 p-3 rounded-xl transition-all text-left ${
              step === 2
                ? "bg-blue-50 text-blue-700 font-semibold"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${
              step === 2 ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"
            }`}>
              2
            </div>
            <div className="hidden sm:block">
              <p className="text-xs font-semibold">Bases & Região</p>
              <p className="text-[10px] text-slate-400">SINAPI / SICRO / UF</p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setStep(3)}
            className={`flex items-center gap-2.5 p-3 rounded-xl transition-all text-left ${
              step === 3
                ? "bg-blue-50 text-blue-700 font-semibold"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${
              step === 3 ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"
            }`}>
              3
            </div>
            <div className="hidden sm:block">
              <p className="text-xs font-semibold">BDI Padrão</p>
              <p className="text-[10px] text-slate-400">Taxa e margens</p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setStep(4)}
            className={`flex items-center gap-2.5 p-3 rounded-xl transition-all text-left ${
              step === 4
                ? "bg-blue-50 text-blue-700 font-semibold"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${
              step === 4 ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"
            }`}>
              4
            </div>
            <div className="hidden sm:block">
              <p className="text-xs font-semibold">Precisão</p>
              <p className="text-[10px] text-slate-400">Arredondamento</p>
            </div>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl flex items-center gap-3 text-red-700 text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Formulário Principal */}
      <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200/80 p-6 sm:p-8 shadow-xs space-y-6">
        {/* ETAPA 1: Identificação */}
        {step === 1 && (
          <div className="space-y-5">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
                <Building2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Identificação da Obra e Orçamento
                </h3>
                <p className="text-xs text-slate-500">
                  Vincule a obra correspondente e forneça os dados básicos da planilha.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Obra / Empreendimento <span className="text-red-500">*</span>
                </label>
                {projects.length === 0 ? (
                  <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center justify-between">
                    <span>Nenhuma obra cadastrada. Crie uma obra antes de iniciar o orçamento.</span>
                    <Link
                      href="/projects"
                      className="px-3 py-1.5 bg-amber-700 text-white rounded-lg font-semibold hover:bg-amber-800 transition-colors"
                    >
                      Cadastrar Obra
                    </Link>
                  </div>
                ) : (
                  <select
                    value={formData.projectId}
                    onChange={(e) => setFormData({ ...formData, projectId: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    required
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.state ? `(${p.state})` : ""} {p.clientName ? `— Cliente: ${p.clientName}` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Título da Planilha Orçamentária <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="Ex.: Orçamento Executivo Inicial — Torre Residencial A"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Responsável Técnico (Engenheiro / Arquiteto)
                  </label>
                  <input
                    type="text"
                    placeholder="Ex.: Eng. Ricardo Batista — CREA 123456/D"
                    value={formData.technicalResponsible || ""}
                    onChange={(e) => setFormData({ ...formData, technicalResponsible: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Data-Base de Custos
                  </label>
                  <input
                    type="date"
                    value={formData.baseDate || ""}
                    onChange={(e) => setFormData({ ...formData, baseDate: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Descrição / Objeto do Orçamento
                </label>
                <textarea
                  rows={3}
                  placeholder="Descreva o escopo e particularidades deste orçamento..."
                  value={formData.description || ""}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none"
                />
              </div>

              {templates.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Modelo de EAP (Opcional)
                  </label>
                  <select
                    value={formData.templateId || ""}
                    onChange={(e) =>
                      setFormData({ ...formData, templateId: e.target.value || null })
                    }
                    className="w-full px-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  >
                    <option value="">
                      Estrutura padrão (etapa inicial &ldquo;SERVIÇOS INICIAIS&rdquo;)
                    </option>
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name} — {template.stageCount} etapas / {template.itemCount} itens
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-slate-400 mt-1">
                    O modelo substitui a estrutura inicial. Custos são recalculados com o
                    catálogo atual ao criar a planilha.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ETAPA 2: Base de Referência & Parâmetros Regionais */}
        {step === 2 && (
          <div className="space-y-5">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Base de Referência e Parâmetros Tributários
                </h3>
                <p className="text-xs text-slate-500">
                  Defina o estado (UF), competência de preços e o regime de desoneração da folha.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Estado (UF de Referência) <span className="text-red-500">*</span>
                </label>
                <select
                  value={formData.referenceState || "SP"}
                  onChange={(e) => setFormData({ ...formData, referenceState: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                >
                  {BRAZILIAN_STATES.map((uf) => (
                    <option key={uf} value={uf}>
                      {uf}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Mês / Competência (AAAA/MM) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="2024/01"
                  value={formData.referenceMonth || "2024/01"}
                  onChange={(e) => setFormData({ ...formData, referenceMonth: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  pattern="\d{4}/(0[1-9]|1[0-2])"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Regime de Desoneração <span className="text-red-500">*</span>
                </label>
                <select
                  value={formData.referenceTaxRegime || TaxRegime.DESONERADO}
                  onChange={(e) => setFormData({ ...formData, referenceTaxRegime: e.target.value as TaxRegime })}
                  className="w-full px-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                >
                  <option value={TaxRegime.DESONERADO}>Desonerado</option>
                  <option value={TaxRegime.NAO_DESONERADO}>Não Desonerado</option>
                </select>
              </div>
            </div>

            {referenceDatabases.length > 0 && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Catálogo / Publicação Oficial Vinculada (Opcional)
                </label>
                <select
                  value={formData.referenceDatabaseId || ""}
                  onChange={(e) => setFormData({ ...formData, referenceDatabaseId: e.target.value || null })}
                  className="w-full px-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                >
                  <option value="">Sem catálogo formal fixado (usar acervo geral)</option>
                  {referenceDatabases.map((db) => (
                    <option key={db.id} value={db.id}>
                      {db.name} ({db.source} - {db.state || "Geral"} {db.referenceMonth || ""})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {/* ETAPA 3: BDI Padrão */}
        {step === 3 && (
          <div className="space-y-5">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
                <Percent className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Configuração de BDI Padrão da Revisão
                </h3>
                <p className="text-xs text-slate-500">
                  O BDI selecionado será aplicado como taxa padrão para todos os itens da planilha orçamentária.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {bdiConfigs.length === 0 ? (
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                  Nenhum modelo de BDI encontrado. O orçamento será criado com taxa de BDI 0,00%, podendo ser configurado posteriormente.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {bdiConfigs.map((bdi) => {
                    const isSelected = formData.bdiConfigId === bdi.id;
                    const rate = Number(bdi.bdiRate).toFixed(2);
                    return (
                      <div
                        key={bdi.id}
                        onClick={() => setFormData({ ...formData, bdiConfigId: bdi.id })}
                        className={`p-4 rounded-xl border cursor-pointer transition-all ${
                          isSelected
                            ? "bg-blue-50/60 border-blue-500 shadow-xs ring-1 ring-blue-500"
                            : "bg-white border-slate-200 hover:border-slate-300"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-sm text-slate-900">
                            {bdi.name}
                          </span>
                          {bdi.isDefault && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                              Padrão
                            </span>
                          )}
                        </div>
                        <div className="flex items-baseline gap-1 mt-2">
                          <span className="text-2xl font-black text-blue-600">
                            {rate}%
                          </span>
                          <span className="text-xs text-slate-400">taxa BDI</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ETAPA 4: Precisão e Arredondamento */}
        {step === 4 && (
          <div className="space-y-5">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
              <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center border border-purple-100">
                <Sliders className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Política Determinística de Precisão Decimal
                </h3>
                <p className="text-xs text-slate-500">
                  Casas decimais e método de arredondamento comercial (Acórdão TCU).
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Casas Decimais de Preços Unitários
                </label>
                <select
                  value={formData.roundingPriceDecimals}
                  onChange={(e) => setFormData({ ...formData, roundingPriceDecimals: Number(e.target.value) })}
                  className="w-full px-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                >
                  <option value={2}>2 casas (R$ 0,00)</option>
                  <option value={4}>4 casas (R$ 0,0000 - Padrão TCU/SINAPI)</option>
                  <option value={6}>6 casas (R$ 0,000000)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Casas Decimais de Quantidades na Planilha
                </label>
                <select
                  value={formData.roundingQuantityDecimals}
                  onChange={(e) => setFormData({ ...formData, roundingQuantityDecimals: Number(e.target.value) })}
                  className="w-full px-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                >
                  <option value={2}>2 casas (0,00)</option>
                  <option value={3}>3 casas (0,000)</option>
                  <option value={4}>4 casas (0,0000 - Padrão SINAPI)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Casas Decimais de Coeficientes de Insumo
                </label>
                <select
                  value={formData.roundingCoefficientDecimals}
                  onChange={(e) => setFormData({ ...formData, roundingCoefficientDecimals: Number(e.target.value) })}
                  className="w-full px-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                >
                  <option value={4}>4 casas (0,0000)</option>
                  <option value={5}>5 casas (0,00000 - Recomendado SINAPI)</option>
                  <option value={7}>7 casas (0,0000000)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Casas Decimais de Subtotais e Totais
                </label>
                <select
                  value={formData.roundingTotalDecimals}
                  onChange={(e) => setFormData({ ...formData, roundingTotalDecimals: Number(e.target.value) })}
                  className="w-full px-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                >
                  <option value={2}>2 casas decimais (R$ 0,00 - Moeda Comercial)</option>
                  <option value={4}>4 casas decimais (R$ 0,0000)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Método de Arredondamento
              </label>
              <select
                value={formData.roundingMode}
                onChange={(e) => setFormData({ ...formData, roundingMode: e.target.value as RoundingMode })}
                className="w-full px-3.5 py-2.5 bg-slate-50/70 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              >
                <option value="ROUND_HALF_UP">ROUND_HALF_UP (Arredonda para cima se &ge; 5 - Padrão Comercial BR)</option>
                <option value="ROUND_HALF_EVEN">ROUND_HALF_EVEN (Banker&apos;s rounding - Arredondamento Bancário)</option>
                <option value="ROUND_DOWN">ROUND_DOWN (Truncamento direto)</option>
              </select>
            </div>
          </div>
        )}

        {/* Rodapé de Navegação */}
        <div className="flex items-center justify-between border-t border-slate-100 pt-5">
          {step > 1 ? (
            <button
              type="button"
              onClick={goToPreviousStep}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-50 transition-all"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Voltar</span>
            </button>
          ) : (
            <div />
          )}

          {step < 4 ? (
            <button
              type="button"
              onClick={() => {
                if (step === 1 && !formData.title.trim()) {
                  setError("Informe o título do orçamento antes de prosseguir.");
                  return;
                }
                setError(null);
                goToNextStep();
              }}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-semibold shadow-md shadow-blue-600/20 hover:bg-blue-700 transition-all cursor-pointer"
            >
              <span>Próxima Etapa</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-bold shadow-md shadow-emerald-600/20 hover:bg-emerald-700 transition-all cursor-pointer disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Criando Planilha...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Concluir e Abrir Planilha</span>
                </>
              )}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
