"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import {
  executeBudgetImportAction,
  previewBudgetImportAction,
} from "@/lib/actions/budget-import";
import type {
  AnalyzedBudgetRow,
  BudgetColumnMapping,
  BudgetFileType,
  BudgetImportResolution,
} from "@/lib/services/budget-import";

interface BudgetImportModalProps {
  revisionId: string;
  revisionNumber: number;
  onClose: () => void;
  onImported: () => void;
}

const MAPPING_FIELDS: Array<{
  key: keyof BudgetColumnMapping;
  label: string;
  required?: boolean;
}> = [
  { key: "stageCode", label: "Etapa (EAP)", required: true },
  { key: "stageTitle", label: "Título da etapa" },
  { key: "code", label: "Código do serviço", required: true },
  { key: "description", label: "Descrição" },
  { key: "unit", label: "Unidade" },
  { key: "quantity", label: "Quantidade", required: true },
  { key: "price", label: "Preço unitário" },
];

const RESOLUTION_LABELS: Record<BudgetImportResolution, string> = {
  USE_SYSTEM: "Usar preço do sistema",
  USE_FILE: "Usar preço do arquivo",
  CONVERT: "Converter unidade",
  CREATE_CLOSED: "Criar composição fechada",
  SKIP: "Ignorar linha",
};

function readFileAs(file: File, fileType: BudgetFileType): Promise<string> {
  if (fileType === "CSV") {
    return file.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Falha ao ler arquivo."));
    reader.readAsDataURL(file);
  });
}

export function BudgetImportModal({
  revisionId,
  revisionNumber,
  onClose,
  onImported,
}: BudgetImportModalProps) {
  const [fileType, setFileType] = useState<BudgetFileType>("CSV");
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Partial<BudgetColumnMapping>>({});
  const [rows, setRows] = useState<AnalyzedBudgetRow[] | null>(null);
  const [summary, setSummary] = useState<{
    totalRows: number;
    ready: number;
    conflicts: number;
    invalid: number;
  } | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, BudgetImportResolution>>({});
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<{
    created: number;
    skipped: number;
    stagesCreated: number;
  } | null>(null);

  const conflicts = useMemo(
    () => (rows ?? []).filter((row) => row.status === "CONFLICT"),
    [rows]
  );

  const pendingResolutions = useMemo(
    () => conflicts.filter((row) => !resolutions[String(row.line)]),
    [conflicts, resolutions]
  );

  const handleFile = async (file: File | null) => {
    if (!file) return;

    const isXlsx = /\.xlsx?$/i.test(file.name);
    const type: BudgetFileType = isXlsx ? "XLSX" : "CSV";
    setFileType(type);
    setFileName(file.name);
    setRows(null);
    setSummary(null);
    setReport(null);
    setError(null);

    try {
      const fileContent = await readFileAs(file, type);
      setContent(fileContent);

      setLoading(true);
      const response = await previewBudgetImportAction({
        revisionId,
        content: fileContent,
        fileType: type,
      });
      setLoading(false);

      if (!response.success) {
        setError(response.error || "Não foi possível ler o arquivo.");
        return;
      }

      setHeaders(response.headers ?? []);
      setMapping(response.suggestedMapping ?? {});
      if (response.preview) {
        setRows(response.preview.rows);
        setSummary(response.preview.summary);
      }
      if (response.error) setError(response.error);
    } catch (caught) {
      setLoading(false);
      setError(caught instanceof Error ? caught.message : "Erro ao ler o arquivo.");
    }
  };

  const handleAnalyze = async () => {
    if (!content) return;
    if (!mapping.stageCode || !mapping.code || !mapping.quantity) {
      setError("Mapeie as colunas obrigatórias: etapa, código do serviço e quantidade.");
      return;
    }

    setLoading(true);
    setError(null);
    const response = await previewBudgetImportAction({
      revisionId,
      content,
      fileType,
      mapping: mapping as BudgetColumnMapping,
    });
    setLoading(false);

    if (!response.success) {
      setError(response.error || "Erro ao analisar o arquivo.");
      return;
    }

    setRows(response.preview?.rows ?? []);
    setSummary(response.preview?.summary ?? null);
    setResolutions({});
  };

  const handleExecute = async () => {
    if (!rows) return;
    if (pendingResolutions.length > 0) {
      setError("Resolva todos os conflitos antes de confirmar a importação.");
      return;
    }

    setExecuting(true);
    setError(null);
    const response = await executeBudgetImportAction({
      revisionId,
      content,
      fileType,
      mapping: mapping as BudgetColumnMapping,
      resolutions,
      confirm: true,
    });
    setExecuting(false);

    if (!response.success) {
      setError(response.error || "Erro ao importar orçamento.");
      return;
    }

    setReport(response.report ?? null);
    onImported();
  };

  const statusBadge = (row: AnalyzedBudgetRow) => {
    if (row.status === "OK") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">
          <CheckCircle2 className="w-3 h-3" /> Pronto
        </span>
      );
    }
    if (row.status === "INVALID") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700 border border-red-200">
          <AlertCircle className="w-3 h-3" /> Inválido
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200">
        <AlertTriangle className="w-3 h-3" /> Conflito
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-6xl max-h-[92vh] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-4 p-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900">
                Importar planilha para a Revisão {revisionNumber}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                CSV ou XLSX com etapa, código de serviço e quantidade. Conflitos exigem confirmação.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
            aria-label="Fechar importação"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {!rows && !report && (
            <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-300 rounded-2xl py-12 px-4 cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition-colors">
              <Upload className="w-8 h-8 text-blue-500" />
              <span className="text-sm font-semibold text-slate-800">
                {fileName || "Selecione um arquivo CSV ou XLSX"}
              </span>
              <span className="text-xs text-slate-500">
                A primeira linha deve conter os cabeçalhos das colunas.
              </span>
              <input
                type="file"
                accept=".csv,.xlsx"
                className="hidden"
                onChange={(event) => void handleFile(event.target.files?.[0] ?? null)}
              />
            </label>
          )}

          {headers.length > 0 && !report && (
            <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-bold text-slate-900">Mapeamento de colunas</h4>
                <span className="text-[11px] text-slate-500">
                  Arquivo: <strong>{fileName}</strong> ({fileType})
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {MAPPING_FIELDS.map((field) => (
                  <label key={field.key} className="text-xs space-y-1">
                    <span className="font-semibold text-slate-700">
                      {field.label}
                      {field.required && <span className="text-red-500"> *</span>}
                    </span>
                    <select
                      value={mapping[field.key] ?? ""}
                      onChange={(event) =>
                        setMapping((current) => ({
                          ...current,
                          [field.key]: event.target.value || undefined,
                        }))
                      }
                      className="w-full px-2.5 py-2 rounded-lg border border-slate-300 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                    >
                      <option value="">— Não mapear —</option>
                      {headers.map((header) => (
                        <option key={header} value={header}>
                          {header}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleAnalyze}
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshIcon />}
                  Analisar arquivo
                </button>
                <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  Trocar arquivo
                  <input
                    type="file"
                    accept=".csv,.xlsx"
                    className="hidden"
                    onChange={(event) => void handleFile(event.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
            </div>
          )}

          {summary && !report && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700">
                {summary.totalRows} linha(s)
              </span>
              <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-700">
                {summary.ready} pronta(s)
              </span>
              <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-700">
                {summary.conflicts} conflito(s)
              </span>
              <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-red-100 text-red-700">
                {summary.invalid} inválida(s)
              </span>
            </div>
          )}

          {rows && !report && (
            <div className="rounded-2xl border border-slate-200 overflow-hidden">
              <div className="max-h-[46vh] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-600 sticky top-0">
                    <tr>
                      <th className="text-left p-2.5 font-semibold">Linha</th>
                      <th className="text-left p-2.5 font-semibold">Etapa</th>
                      <th className="text-left p-2.5 font-semibold">Código</th>
                      <th className="text-left p-2.5 font-semibold">Descrição</th>
                      <th className="text-right p-2.5 font-semibold">Qtd.</th>
                      <th className="text-left p-2.5 font-semibold">Un.</th>
                      <th className="text-right p-2.5 font-semibold">Sistema</th>
                      <th className="text-left p-2.5 font-semibold">Status</th>
                      <th className="text-left p-2.5 font-semibold">Resolução</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((row) => {
                      const allResolutions = Array.from(
                        new Set(row.conflicts.flatMap((conflict) => conflict.resolutions))
                      );

                      return (
                        <tr key={row.line} className="align-top">
                          <td className="p-2.5 text-slate-500 font-mono">{row.line}</td>
                          <td className="p-2.5 text-slate-700">{row.stageCode || "—"}</td>
                          <td className="p-2.5 font-mono text-slate-800">{row.code || "—"}</td>
                          <td className="p-2.5 text-slate-700 max-w-[220px]">
                            {row.description || row.matchedComposition?.description || "—"}
                          </td>
                          <td className="p-2.5 text-right font-mono">{row.quantity ?? "—"}</td>
                          <td className="p-2.5 text-slate-600">{row.unit || "—"}</td>
                          <td className="p-2.5 text-right font-mono text-slate-600">
                            {row.calculatedUnitCost ?? "—"}
                          </td>
                          <td className="p-2.5">{statusBadge(row)}</td>
                          <td className="p-2.5 min-w-[210px]">
                            {row.status === "OK" && (
                              <span className="text-[11px] text-slate-400">Automático</span>
                            )}
                            {row.status === "INVALID" && (
                              <span className="text-[11px] text-red-600">
                                {row.conflicts.map((conflict) => conflict.message).join(" ")}
                              </span>
                            )}
                            {row.status === "CONFLICT" && (
                              <div className="space-y-1.5">
                                <p className="text-[11px] text-amber-700">
                                  {row.conflicts.map((conflict) => conflict.message).join(" ")}
                                </p>
                                <select
                                  value={resolutions[String(row.line)] ?? ""}
                                  onChange={(event) =>
                                    setResolutions((current) => ({
                                      ...current,
                                      [String(row.line)]: event.target
                                        .value as BudgetImportResolution,
                                    }))
                                  }
                                  className="w-full px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-[11px] focus:outline-none"
                                >
                                  <option value="">Selecione uma resolução…</option>
                                  {allResolutions.map((resolution) => (
                                    <option key={resolution} value={resolution}>
                                      {RESOLUTION_LABELS[resolution]}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {report && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 space-y-2">
              <div className="flex items-center gap-2 text-emerald-800 font-bold text-sm">
                <CheckCircle2 className="w-5 h-5" />
                Importação concluída
              </div>
              <p className="text-xs text-emerald-800">
                {report.created} item(ns) importado(s), {report.skipped} linha(s) ignorada(s)
                {report.stagesCreated > 0
                  ? ` e ${report.stagesCreated} etapa(s) criada(s).`
                  : "."}
              </p>
              <p className="text-[11px] text-emerald-700">
                O histórico anterior não foi alterado. Revise os itens na planilha.
              </p>
            </div>
          )}

          {error && (
            <div className="p-3 rounded-xl border border-red-200 bg-red-50 text-xs text-red-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-3">
          <p className="text-[11px] text-slate-500">
            {report
              ? "Importação registrada em auditoria."
              : pendingResolutions.length > 0
                ? `${pendingResolutions.length} conflito(s) ainda sem resolução.`
                : rows
                  ? "Nenhuma alteração é gravada sem confirmação."
                  : "Selecione o arquivo para começar."}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {report ? "Fechar" : "Cancelar"}
            </button>
            {!report && (
              <button
                type="button"
                onClick={handleExecute}
                disabled={
                  !rows ||
                  executing ||
                  pendingResolutions.length > 0 ||
                  (summary?.totalRows ?? 0) === 0
                }
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50"
              >
                {executing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                )}
                Confirmar importação
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RefreshIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="w-3.5 h-3.5"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}
