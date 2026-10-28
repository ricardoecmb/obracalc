"use client";

import { useState } from "react";
import {
  previewCsvAction,
  type PreviewCsvResult,
} from "@/lib/actions/import";
import { type ColumnMapping, type ImportReport } from "@/lib/services/import-pipeline";
import type { ImportJobView } from "@/lib/services/import-jobs";
import { DatabaseSource, TaxRegime } from "@prisma/client";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Loader2,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";

const BRAZILIAN_STATES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA",
  "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN",
  "RS", "RO", "RR", "SC", "SP", "SE", "TO"
];

export function ImportWizard() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Passo 1: Arquivo e parâmetros
  const [file, setFile] = useState<File | null>(null);
  const [csvContent, setCsvContent] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [dataType, setDataType] = useState<"RESOURCES" | "COMPOSITIONS">("RESOURCES");
  const [source, setSource] = useState<DatabaseSource>(DatabaseSource.SINAPI);
  const [state, setState] = useState<string>("SP");
  const [referenceMonth, setReferenceMonth] = useState<string>("2024/01");
  const [taxRegime, setTaxRegime] = useState<TaxRegime>(TaxRegime.DESONERADO);

  // Passo 2: Prévia e Mapeamento
  const [preview, setPreview] = useState<PreviewCsvResult | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({
    code: "",
    description: "",
    unit: "",
    price: "",
    category: "",
  });

  // Passo 3: Relatório de Importação
  const [report, setReport] = useState<ImportReport | null>(null);
  const [job, setJob] = useState<ImportJobView | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    setFile(selected);
    setFileName(selected.name);
    setError(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setCsvContent(content);
    };
    reader.onerror = () => {
      setError("Erro ao ler arquivo local.");
    };
    reader.readAsText(selected, "UTF-8");
  };

  const handleGoToStep2 = async () => {
    if (!csvContent) {
      setError("Selecione um arquivo CSV para continuar.");
      return;
    }

    setLoading(true);
    setError(null);

    const res = await previewCsvAction(csvContent);
    setLoading(false);

    if (!res.success || !res.headers) {
      setError(res.error || "Erro ao processar prévia do arquivo.");
      return;
    }

    setPreview(res);
    setMapping({
      code: res.suggestedMapping?.code || res.headers[0] || "",
      description: res.suggestedMapping?.description || res.headers[1] || "",
      unit: res.suggestedMapping?.unit || res.headers[2] || "",
      price: res.suggestedMapping?.price || res.headers[3] || "",
      category: res.suggestedMapping?.category || "",
    });

    setStep(2);
  };

  const handleExecuteImport = async () => {
    if (!mapping.code || !mapping.description) {
      setError("Os campos Código e Descrição são de mapeamento obrigatório.");
      return;
    }

    if (!file) {
      setError("Selecione novamente o arquivo CSV para continuar.");
      return;
    }

    setLoading(true);
    setError(null);
    setJob(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("dataType", dataType);
      formData.append("mapping", JSON.stringify(mapping));
      formData.append(
        "context",
        JSON.stringify({
          source,
          state: state || null,
          referenceMonth: referenceMonth.trim(),
          taxRegime: taxRegime || null,
        })
      );

      const createdResponse = await fetch("/api/import/jobs", {
        method: "POST",
        body: formData,
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      const createdBody = await createdResponse.json();

      if (!createdResponse.ok || !createdBody.job) {
        throw new Error(createdBody.error || "Falha ao criar o job de importação.");
      }

      let current = createdBody.job as ImportJobView;
      setJob(current);

      // Processa imediatamente no worker desta requisição. Se o runtime
      // encerrar por timeout, o cron reivindica o job posteriormente.
      try {
        const processedResponse = await fetch(
          `/api/import/jobs/${current.id}/process`,
          { method: "POST" }
        );
        const processedBody = await processedResponse.json();
        if (processedBody.job) {
          current = processedBody.job as ImportJobView;
          setJob(current);
        }
      } catch {
        // Mantém o polling; o cron processará a fila.
      }

      for (let attempt = 0; attempt < 90; attempt++) {
        if (current.status === "COMPLETED") break;
        if (current.status === "FAILED") {
          throw new Error(current.errorMessage || "Falha ao processar a importação.");
        }

        await new Promise((resolve) => setTimeout(resolve, 2000));
        const statusResponse = await fetch(`/api/import/jobs/${current.id}`, {
          cache: "no-store",
        });
        const statusBody = await statusResponse.json();
        if (!statusResponse.ok || !statusBody.job) {
          throw new Error(statusBody.error || "Falha ao consultar o job.");
        }
        current = statusBody.job as ImportJobView;
        setJob(current);
      }

      if (current.status !== "COMPLETED") {
        throw new Error(
          "A importação continua na fila. Acompanhe o histórico abaixo; o cron processará o job."
        );
      }

      setReport((current.report as ImportReport | null) ?? null);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha na execução da importação.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header & Stepper */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Importação de Tabelas e Preços
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Ingestão transacional de bases SINAPI, SICRO ou tabelas próprias em formato CSV.
            </p>
          </div>
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            Passo {step} de 3
          </span>
        </div>

        {/* Stepper Steps Bar */}
        <div className="grid grid-cols-3 gap-2 mt-4 text-xs font-semibold">
          <div
            className={`p-3 rounded-xl border flex items-center gap-2 ${
              step === 1
                ? "border-blue-600 bg-blue-50 text-blue-700"
                : step > 1
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : "border-slate-200 text-slate-400"
            }`}
          >
            <span>1. Arquivo & Parâmetros</span>
          </div>
          <div
            className={`p-3 rounded-xl border flex items-center gap-2 ${
              step === 2
                ? "border-blue-600 bg-blue-50 text-blue-700"
                : step > 2
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : "border-slate-200 text-slate-400"
            }`}
          >
            <span>2. Prévia & Mapeamento</span>
          </div>
          <div
            className={`p-3 rounded-xl border flex items-center gap-2 ${
              step === 3
                ? "border-blue-600 bg-blue-50 text-blue-700"
                : "border-slate-200 text-slate-400"
            }`}
          >
            <span>3. Relatório & Auditoria</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-red-700">{error}</div>
        </div>
      )}

      {/* PASSO 1: Seleção de Arquivo e Parâmetros Contextuais */}
      {step === 1 && (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-6 sm:p-8 shadow-xs space-y-6">
          <div>
            <h2 className="text-base font-bold text-slate-900 mb-1">
              1. Parâmetros Contextuais da Base
            </h2>
            <p className="text-xs text-slate-500">
              Defina a chave lógica composta (Origem, UF, Competência e Regime) para garantir unicidade e rastreabilidade.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 pt-2">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">Tipo de Conteúdo</label>
              <select
                value={dataType}
                onChange={(e) => setDataType(e.target.value as "RESOURCES" | "COMPOSITIONS")}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white"
              >
                <option value="RESOURCES">Insumos e Preços</option>
                <option value="COMPOSITIONS">Composições de Serviços</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">Fonte / Origem</label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value as DatabaseSource)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white"
              >
                <option value="SINAPI">SINAPI (CAIXA / IBGE)</option>
                <option value="SICRO">SICRO (DNIT)</option>
                <option value="CUSTOM">Tabela Própria / Interna</option>
                <option value="SUPPLIER">Cotação de Fornecedor</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">UF (Estado)</label>
              <select
                value={state || ""}
                onChange={(e) => setState(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white"
              >
                {BRAZILIAN_STATES.map((uf) => (
                  <option key={uf} value={uf}>
                    {uf}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">
                Competência (AAAA/MM) <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="2024/01"
                value={referenceMonth}
                onChange={(e) => setReferenceMonth(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm font-mono"
              />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <label className="text-xs font-semibold text-slate-700">Regime de Desoneração</label>
              <select
                value={taxRegime || ""}
                onChange={(e) => setTaxRegime(e.target.value as TaxRegime)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white"
              >
                <option value="DESONERADO">Desonerado (Lei 12.844/2013 - CPRB)</option>
                <option value="NAO_DESONERADO">Não Desonerado (Encargos Tradicionais)</option>
              </select>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100">
            <h3 className="text-sm font-bold text-slate-900 mb-3">Arquivo CSV para Importação</h3>
            <div className="border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-2xl p-8 text-center transition-all bg-slate-50/50">
              <Upload className="w-10 h-10 text-slate-400 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-700">
                Clique para selecionar ou arraste o arquivo CSV
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Suporta formato oficial SINAPI (separadores ponto-e-vírgula ou vírgula, decimais brasileiros).
              </p>
              <input
                type="file"
                accept=".csv,.txt"
                onChange={handleFileUpload}
                className="hidden"
                id="file-upload"
              />
              <label
                htmlFor="file-upload"
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer shadow-xs"
              >
                <FileSpreadsheet className="w-4 h-4 text-blue-600" />
                <span>{fileName ? `Arquivo: ${fileName}` : "Selecionar CSV"}</span>
              </label>
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-slate-100">
            <button
              type="button"
              disabled={!csvContent || loading}
              onClick={handleGoToStep2}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 shadow-md shadow-blue-600/20 cursor-pointer"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              <span>Avançar para Prévia</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* PASSO 2: Prévia dos Dados e Mapeamento de Colunas */}
      {step === 2 && preview && (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-6 sm:p-8 shadow-xs space-y-6">
          <div>
            <h2 className="text-base font-bold text-slate-900 mb-1">
              2. Mapeamento de Colunas e Validação Prévia
            </h2>
            <p className="text-xs text-slate-500">
              Delimitador detectado: <strong className="font-mono">{preview.delimiter === ";" ? "Ponto e Vírgula (;)" : preview.delimiter === "," ? "Vírgula (,)" : preview.delimiter}</strong>. Associe as colunas do arquivo aos campos do ObraCalc.
            </p>
          </div>

          {/* Mapping Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200/80">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">
                Código <span className="text-red-500">*</span>
              </label>
              <select
                value={mapping.code}
                onChange={(e) => setMapping({ ...mapping, code: e.target.value })}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white font-mono"
              >
                <option value="">Selecione a coluna</option>
                {preview.headers?.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">
                Descrição <span className="text-red-500">*</span>
              </label>
              <select
                value={mapping.description}
                onChange={(e) => setMapping({ ...mapping, description: e.target.value })}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white font-mono"
              >
                <option value="">Selecione a coluna</option>
                {preview.headers?.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">Unidade</label>
              <select
                value={mapping.unit}
                onChange={(e) => setMapping({ ...mapping, unit: e.target.value })}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white font-mono"
              >
                <option value="">Selecione a coluna</option>
                {preview.headers?.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700">Preço / Custo Unitário</label>
              <select
                value={mapping.price}
                onChange={(e) => setMapping({ ...mapping, price: e.target.value })}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white font-mono"
              >
                <option value="">Selecione a coluna</option>
                {preview.headers?.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Preview Table */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Primeiras Linhas do Arquivo (Amostra de Validação)
              </h3>
              <span className="text-xs text-slate-400">
                {preview.previewRows?.length} linhas visualizadas
              </span>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200">
                    {preview.headers?.map((h) => (
                      <th key={h} className="p-2.5 font-semibold text-slate-700 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.previewRows?.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/80">
                      {preview.headers?.map((h) => (
                        <td key={h} className="p-2.5 text-slate-600 whitespace-nowrap font-mono max-w-xs truncate">
                          {row[h] || "-"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {job && job.status !== "COMPLETED" && (
            <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-800 space-y-1">
              <div className="flex items-center gap-2 font-semibold">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                <span>
                  Job {job.id.slice(0, 8)} — {job.status === "PENDING" ? "na fila" : "processando"}
                </span>
              </div>
              <p>
                Arquivo persistido com checksum {job.checksum.slice(0, 12)}… e processamento
                assíncrono. Você pode acompanhar pelo histórico de importações abaixo.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Voltar</span>
            </button>
            <button
              type="button"
              disabled={loading || !mapping.code || !mapping.description}
              onClick={handleExecuteImport}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 shadow-md shadow-blue-600/20 cursor-pointer"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              <span>{loading ? "Processando importação..." : "Enfileirar e Processar Importação"}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* PASSO 3: Relatório de Processamento e Auditoria */}
      {step === 3 && report && (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-6 sm:p-8 shadow-xs space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Importação Concluída com Sucesso!
              </h2>
              <p className="text-xs text-slate-500">
                Banco atualizado com isolamento de falhas, garantia de idempotência e registro de auditoria.
              </p>
            </div>
          </div>

          {/* Metric Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Linhas Analisadas
              </span>
              <div className="text-2xl font-black text-slate-900 mt-1">{report.totalRows}</div>
            </div>
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200/80">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                Registros Criados
              </span>
              <div className="text-2xl font-black text-emerald-700 mt-1">{report.created}</div>
            </div>
            <div className="p-4 rounded-xl bg-blue-50 border border-blue-200/80">
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700">
                Registros Atualizados
              </span>
              <div className="text-2xl font-black text-blue-700 mt-1">{report.updated}</div>
            </div>
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200/80">
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
                Ignorados / Inválidos
              </span>
              <div className="text-2xl font-black text-amber-700 mt-1">{report.skipped}</div>
            </div>
          </div>

          {/* Error Details if any */}
          {report.errors.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-800">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <span>Ocorrências e Linhas Ignoradas ({report.errors.length})</span>
              </div>
              <div className="max-h-60 overflow-y-auto border border-amber-200 rounded-xl divide-y divide-amber-100 bg-amber-50/30">
                {report.errors.map((err, idx) => (
                  <div key={idx} className="p-3 text-xs flex items-start gap-2">
                    <span className="font-mono font-bold text-amber-900">Linha {err.line}:</span>
                    <span className="text-amber-800 font-medium">
                      {err.code ? `[${err.code}] ` : ""}
                      {err.reason}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={() => {
                setStep(1);
                setCsvContent("");
                setFileName("");
                setFile(null);
                setReport(null);
                setPreview(null);
                setJob(null);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Nova Importação</span>
            </button>

            <div className="flex items-center gap-3">
              <Link
                href="/resources"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <span>Ver Insumos</span>
              </Link>
              <Link
                href="/compositions"
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 shadow-md shadow-blue-600/20"
              >
                <span>Ver Composições</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
