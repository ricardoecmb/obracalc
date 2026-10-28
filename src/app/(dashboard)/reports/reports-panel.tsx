"use client";

import { useState } from "react";
import {
  FileSpreadsheet,
  BarChart3,
  Calculator,
  Percent,
  Package,
  ListTree,
  ShieldCheck,
  Download,
  Loader2,
  Lock,
  FileEdit,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  Settings2,
} from "lucide-react";
import { RevisionComparisonPanel } from "./revision-comparison-panel";

interface BudgetOption {
  id: string;
  title: string;
  projectName: string;
  projectState: string | null;
  revisions: Array<{
    id: string;
    revisionNumber: number;
    status: string;
    referenceState: string | null;
    referenceMonth: string | null;
    stagesCount: number;
  }>;
}

export interface ReportHeaderDefaults {
  companyName?: string | null;
  cnpj?: string | null;
  professionalName?: string | null;
  registrationType?: string | null;
  registrationNumber?: string | null;
}

interface ReportsPanelProps {
  budgets: BudgetOption[];
  headerDefaults: ReportHeaderDefaults;
}

const colorMap = {
  blue: {
    bg: "bg-blue-50",
    border: "border-blue-200",
    text: "text-blue-700",
    icon: "text-blue-600",
    badge: "bg-blue-100 text-blue-800",
    primary: "bg-blue-600 hover:bg-blue-700",
    ring: "ring-blue-500",
    selected: "bg-blue-50/70 border-blue-500 ring-1 ring-blue-500",
  },
  teal: {
    bg: "bg-teal-50",
    border: "border-teal-200",
    text: "text-teal-700",
    icon: "text-teal-600",
    badge: "bg-teal-100 text-teal-800",
    primary: "bg-teal-600 hover:bg-teal-700",
    ring: "ring-teal-500",
    selected: "bg-teal-50/70 border-teal-500 ring-1 ring-teal-500",
  },
  amber: {
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-700",
    icon: "text-amber-600",
    badge: "bg-amber-100 text-amber-800",
    primary: "bg-amber-600 hover:bg-amber-700",
    ring: "ring-amber-500",
    selected: "bg-amber-50/70 border-amber-500 ring-1 ring-amber-500",
  },
  purple: {
    bg: "bg-purple-50",
    border: "border-purple-200",
    text: "text-purple-700",
    icon: "text-purple-600",
    badge: "bg-purple-100 text-purple-800",
    primary: "bg-purple-600 hover:bg-purple-700",
    ring: "ring-purple-500",
    selected: "bg-purple-50/70 border-purple-500 ring-1 ring-purple-500",
  },
  orange: {
    bg: "bg-orange-50",
    border: "border-orange-200",
    text: "text-orange-700",
    icon: "text-orange-600",
    badge: "bg-orange-100 text-orange-800",
    primary: "bg-orange-600 hover:bg-orange-700",
    ring: "ring-orange-500",
    selected: "bg-orange-50/70 border-orange-500 ring-1 ring-orange-500",
  },
  indigo: {
    bg: "bg-indigo-50",
    border: "border-indigo-200",
    text: "text-indigo-700",
    icon: "text-indigo-600",
    badge: "bg-indigo-100 text-indigo-800",
    primary: "bg-indigo-600 hover:bg-indigo-700",
    ring: "ring-indigo-500",
    selected: "bg-indigo-50/70 border-indigo-500 ring-1 ring-indigo-500",
  },
  slate: {
    bg: "bg-slate-100",
    border: "border-slate-300",
    text: "text-slate-700",
    icon: "text-slate-600",
    badge: "bg-slate-200 text-slate-800",
    primary: "bg-slate-700 hover:bg-slate-800",
    ring: "ring-slate-500",
    selected: "bg-slate-100 border-slate-500 ring-1 ring-slate-500",
  },
} as const;

type ReportColor = keyof typeof colorMap;

const REPORT_TYPES: Array<{
  id: string;
  label: string;
  icon: typeof FileSpreadsheet;
  description: string;
  color: ReportColor;
  badge: string;
}> = [
  {
    id: "analytical",
    label: "Orçamento Analítico",
    icon: FileSpreadsheet,
    description:
      "EAP hierárquica completa com desdobramento unitário por material, mão de obra, equipamentos e outros. BDI item a item.",
    color: "blue",
    badge: "Analítico",
  },
  {
    id: "synthetic",
    label: "Orçamento Sintético",
    icon: BarChart3,
    description:
      "Agregação por etapa de 1º nível da EAP. Custo direto, BDI efetivo ponderado e total global da obra.",
    color: "teal",
    badge: "Sintético",
  },
  {
    id: "resources",
    label: "Insumos e Consumos",
    icon: Package,
    description:
      "Todos os insumos expandidos a partir das composições, com quantidade consumida e preço médio ponderado. Composições fechadas preservadas como linhas sintéticas.",
    color: "orange",
    badge: "Insumos",
  },
  {
    id: "abc",
    label: "Curva ABC (Pareto)",
    icon: Calculator,
    description:
      "Ranqueamento de itens por impacto financeiro. Classificação A (0–50%), B (50–80%) e C (80–100%) do valor total.",
    color: "amber",
    badge: "ABC",
  },
  {
    id: "stage-summary",
    label: "Resumo de Etapas",
    icon: ListTree,
    description:
      "Toda a EAP em formato tabular, com nível hierárquico, etapa pai, custo direto, BDI efetivo e participação no orçamento.",
    color: "indigo",
    badge: "EAP",
  },
  {
    id: "bdi",
    label: "Memória de BDI",
    icon: Percent,
    description:
      "Equação canônica (Acórdão TCU 2622/2013) com parcelas detalhadas, cálculo numérico e verificação de consistência.",
    color: "purple",
    badge: "BDI",
  },
  {
    id: "audit",
    label: "Relatório de Auditoria",
    icon: ShieldCheck,
    description:
      "Achados da auditoria determinística por severidade, tipo, entidade e campo, com justificativas e totais do orçamento auditado.",
    color: "slate",
    badge: "Auditoria",
  },
];

const FORMATS = [
  { id: "xlsx", label: "XLSX" },
  { id: "csv", label: "CSV" },
  { id: "pdf", label: "PDF" },
] as const;

export function ReportsPanel({ budgets, headerDefaults }: ReportsPanelProps) {
  const [selectedBudgetId, setSelectedBudgetId] = useState<string>(budgets[0]?.id || "");
  const [selectedRevisionId, setSelectedRevisionId] = useState<string>(
    budgets[0]?.revisions[0]?.id || ""
  );
  const [selectedType, setSelectedType] = useState<string>("analytical");
  const [downloading, setDownloading] = useState<string | null>(null);
  const [lastDownload, setLastDownload] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const [companyName, setCompanyName] = useState(headerDefaults.companyName ?? "");
  const [cnpj, setCnpj] = useState(headerDefaults.cnpj ?? "");
  const [professionalName, setProfessionalName] = useState(
    headerDefaults.professionalName ?? ""
  );
  const [registrationType, setRegistrationType] = useState(
    headerDefaults.registrationType ?? ""
  );
  const [registrationNumber, setRegistrationNumber] = useState(
    headerDefaults.registrationNumber ?? ""
  );
  const [customTitle, setCustomTitle] = useState("");
  const [footer, setFooter] = useState("");
  const [includeChecksum, setIncludeChecksum] = useState(true);

  const selectedBudget = budgets.find((b) => b.id === selectedBudgetId);
  const selectedRevision = selectedBudget?.revisions.find(
    (r) => r.id === selectedRevisionId
  );

  const handleBudgetChange = (budgetId: string) => {
    setSelectedBudgetId(budgetId);
    const budget = budgets.find((b) => b.id === budgetId);
    if (budget && budget.revisions.length > 0) {
      setSelectedRevisionId(budget.revisions[0].id);
    } else {
      setSelectedRevisionId("");
    }
  };

  const handleDownload = async (reportType: string, format: string) => {
    if (!selectedBudgetId || !selectedRevisionId) return;

    const key = `${reportType}-${format}`;
    setDownloading(key);
    setDownloadError(null);

    try {
      const params = new URLSearchParams({
        budgetId: selectedBudgetId,
        revisionId: selectedRevisionId,
        type: reportType,
        format,
        checksum: includeChecksum ? "1" : "0",
      });
      if (companyName.trim()) params.set("company", companyName.trim());
      if (cnpj.trim()) params.set("cnpj", cnpj.trim());
      if (professionalName.trim()) params.set("responsible", professionalName.trim());
      if (registrationType.trim()) params.set("registrationType", registrationType.trim());
      if (registrationNumber.trim())
        params.set("registrationNumber", registrationNumber.trim());
      if (customTitle.trim()) params.set("customTitle", customTitle.trim());
      if (footer.trim()) params.set("footer", footer.trim());

      const res = await fetch(`/api/reports?${params.toString()}`);

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || "Erro ao gerar relatório");
      }

      const disposition = res.headers.get("Content-Disposition") || "";
      const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      const filenameMatch = disposition.match(/filename="([^"]+)"/);
      const filename = utf8Match
        ? decodeURIComponent(utf8Match[1])
        : filenameMatch?.[1] || `relatorio_${reportType}.${format}`;

      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);

      setLastDownload(filename);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Erro desconhecido");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Relatórios e Exportações
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Sete relatórios em PDF, CSV e XLSX. Revisões finalizadas são exportadas
          diretamente do snapshot imutável, garantindo totais idênticos aos
          aprovados.
        </p>
      </div>

      {lastDownload && !downloadError && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center gap-3 text-emerald-800 text-xs font-semibold">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          <span>
            Download iniciado: <strong>{lastDownload}</strong>
          </span>
        </div>
      )}

      {downloadError && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl flex items-center gap-3 text-red-800 text-xs font-semibold">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
          <span>{downloadError}</span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-1 space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center text-xs font-black border border-blue-100">
                1
              </span>
              Selecionar Orçamento
            </h3>

            {budgets.length === 0 ? (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
                Nenhum orçamento com revisões disponível. Crie e configure
                orçamentos antes de gerar relatórios.
              </div>
            ) : (
              <div className="space-y-2">
                {budgets.map((b) => {
                  const isSelected = b.id === selectedBudgetId;
                  const latestRev = b.revisions[0];
                  return (
                    <div
                      key={b.id}
                      onClick={() => handleBudgetChange(b.id)}
                      className={`p-3.5 rounded-xl border cursor-pointer transition-all text-xs ${
                        isSelected
                          ? "bg-blue-50/70 border-blue-500 ring-1 ring-blue-500"
                          : "bg-white border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900 truncate max-w-xs">
                          {b.title}
                        </span>
                        <ChevronRight
                          className={`w-3.5 h-3.5 flex-shrink-0 transition-transform ${
                            isSelected ? "rotate-90 text-blue-600" : "text-slate-400"
                          }`}
                        />
                      </div>
                      <p className="text-slate-500 mt-1">
                        {b.projectName} {b.projectState ? `(${b.projectState})` : ""}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                          {b.revisions.length} revisão(ões)
                        </span>
                        {latestRev?.status === "FINALIZED" ? (
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">
                            <Lock className="w-2.5 h-2.5" />
                            Finalizado
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 text-amber-700">
                            <FileEdit className="w-2.5 h-2.5" />
                            Rascunho
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {selectedBudget && (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-4">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center text-xs font-black border border-indigo-100">
                  2
                </span>
                Selecionar Revisão
              </h3>

              <div className="space-y-2">
                {selectedBudget.revisions.map((rev) => {
                  const isSelected = rev.id === selectedRevisionId;
                  return (
                    <div
                      key={rev.id}
                      onClick={() => setSelectedRevisionId(rev.id)}
                      className={`p-3 rounded-xl border cursor-pointer transition-all text-xs ${
                        isSelected
                          ? "bg-indigo-50/70 border-indigo-500 ring-1 ring-indigo-500"
                          : "bg-white border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900">
                          Revisão {rev.revisionNumber}
                        </span>
                        {rev.status === "FINALIZED" ? (
                          <span className="flex items-center gap-1 text-emerald-700 font-medium">
                            <Lock className="w-3 h-3" />
                            Finalizada
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-amber-700 font-medium">
                            <FileEdit className="w-3 h-3" />
                            Rascunho
                          </span>
                        )}
                      </div>
                      <p className="text-slate-500 mt-1">
                        {rev.referenceState || "BR"} • {rev.referenceMonth || "—"} |{" "}
                        {rev.stagesCount} etapas
                      </p>
                    </div>
                  );
                })}
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600">
                <strong>Fonte:</strong>{" "}
                {selectedRevision?.status === "FINALIZED"
                  ? "snapshot imutável da revisão finalizada"
                  : "dados atuais do rascunho"}
                . Os três formatos usam o mesmo modelo de colunas e totais.
              </div>
            </div>
          )}
        </div>

        <div className="xl:col-span-2 space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center text-xs font-black border border-emerald-100">
                3
              </span>
              Cabeçalho Personalizável
              <Settings2 className="w-4 h-4 text-slate-400 ml-auto" />
            </h3>
            <p className="text-[11px] text-slate-500 -mt-2">
              Os campos abaixo são aplicados aos três formatos. Por padrão, vêm do
              seu perfil profissional.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-[11px] font-semibold text-slate-600 space-y-1">
                Empresa / Escritório
                <input
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                  placeholder="Ex.: Projetos & Obras Ltda."
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-normal text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <label className="text-[11px] font-semibold text-slate-600 space-y-1">
                CNPJ
                <input
                  value={cnpj}
                  onChange={(event) => setCnpj(event.target.value)}
                  placeholder="00.000.000/0001-00"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-normal text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <label className="text-[11px] font-semibold text-slate-600 space-y-1">
                Responsável Técnico
                <input
                  value={professionalName}
                  onChange={(event) => setProfessionalName(event.target.value)}
                  placeholder="Eng. Nome Completo"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-normal text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[11px] font-semibold text-slate-600 space-y-1">
                  Conselho
                  <input
                    value={registrationType}
                    onChange={(event) => setRegistrationType(event.target.value)}
                    placeholder="CREA"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-normal text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </label>
                <label className="text-[11px] font-semibold text-slate-600 space-y-1">
                  Registro
                  <input
                    value={registrationNumber}
                    onChange={(event) => setRegistrationNumber(event.target.value)}
                    placeholder="123456"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-normal text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </label>
              </div>
              <label className="text-[11px] font-semibold text-slate-600 space-y-1">
                Título customizado
                <input
                  value={customTitle}
                  onChange={(event) => setCustomTitle(event.target.value)}
                  placeholder="Opcional — substitui o título do relatório"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-normal text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <label className="text-[11px] font-semibold text-slate-600 space-y-1">
                Rodapé customizado
                <input
                  value={footer}
                  onChange={(event) => setFooter(event.target.value)}
                  placeholder="Opcional — texto do rodapé"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-normal text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
            </div>

            <label className="flex items-center gap-2 text-[11px] text-slate-600 font-medium">
              <input
                type="checkbox"
                checked={includeChecksum}
                onChange={(event) => setIncludeChecksum(event.target.checked)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              Exibir checksum SHA-256 do snapshot nos relatórios finalizados
            </label>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center text-xs font-black border border-amber-100">
                4
              </span>
              Escolher Tipo e Formato
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {REPORT_TYPES.map((rpt) => {
                const colors = colorMap[rpt.color];
                const isSelected = selectedType === rpt.id;
                const Icon = rpt.icon;

                return (
                  <div
                    key={rpt.id}
                    onClick={() => setSelectedType(rpt.id)}
                    className={`p-4 rounded-2xl border cursor-pointer transition-all ${
                      isSelected
                        ? colors.selected
                        : "bg-white border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div
                        className={`w-10 h-10 rounded-xl ${colors.bg} ${colors.border} border flex items-center justify-center`}
                      >
                        <Icon className={`w-5 h-5 ${colors.icon}`} />
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${colors.badge}`}
                      >
                        {rpt.badge}
                      </span>
                    </div>

                    <h4 className="text-sm font-bold text-slate-900 mt-2">
                      {rpt.label}
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                      {rpt.description}
                    </p>

                    <div className="mt-3 grid grid-cols-3 gap-1.5">
                      {FORMATS.map((format) => {
                        const key = `${rpt.id}-${format.id}`;
                        const isDownloading = downloading === key;
                        return (
                          <button
                            key={format.id}
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleDownload(rpt.id, format.id);
                            }}
                            disabled={
                              !selectedBudgetId || !selectedRevisionId || !!downloading
                            }
                            className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-white text-[10px] font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed ${colors.primary}`}
                          >
                            {isDownloading ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Download className="w-3 h-3" />
                            )}
                            <span>{format.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-slate-50 rounded-2xl border border-slate-200/80 p-5 shadow-xs">
            <h4 className="text-xs font-bold text-slate-700 mb-3 uppercase tracking-wider">
              Guia rápido dos relatórios
            </h4>
            <div className="space-y-2 text-xs text-slate-600 leading-relaxed">
              <p>
                <strong>Analítico:</strong> conferência detalhada de preços
                unitários, insumos e memória de cálculo.
              </p>
              <p>
                <strong>Sintético / Resumo de Etapas:</strong> apresentação ao
                cliente e aprovação de medições, com visão hierárquica completa.
              </p>
              <p>
                <strong>Insumos:</strong> quantidades consumidas e preço médio
                ponderado; composições fechadas aparecem como linhas sintéticas
                para não perder a reconciliação.
              </p>
              <p>
                <strong>Curva ABC:</strong> itens de maior impacto financeiro para
                negociação e controle contratual.
              </p>
              <p>
                <strong>BDI / Auditoria:</strong> documentação de conformidade com
                o Acórdão TCU 2622/2013 e rastreabilidade dos achados.
              </p>
              <p className="text-slate-400 pt-1 border-t border-slate-200 mt-2">
                Todos os arquivos usam aritmética exata com{" "}
                <strong>Decimal.js</strong>. O CSV sai em UTF-8 com BOM,
                separador ponto e vírgula e CRLF para abrir corretamente no
                Excel pt-BR.
              </p>
            </div>
          </div>
        </div>
      </div>

      <RevisionComparisonPanel
        budget={
          selectedBudget
            ? {
                id: selectedBudget.id,
                title: selectedBudget.title,
                revisions: selectedBudget.revisions.map((revision) => ({
                  id: revision.id,
                  revisionNumber: revision.revisionNumber,
                  status: revision.status,
                })),
              }
            : null
        }
      />
    </div>
  );
}
