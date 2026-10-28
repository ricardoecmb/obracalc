"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  getRevisionAuditAction,
  justifyAuditResultAction,
  runRevisionAuditAction,
  type AuditResultDto,
} from "@/lib/actions/audit";

interface RevisionAuditModalProps {
  revisionId: string;
  revisionNumber: number;
  isFinalized: boolean;
  onClose: () => void;
}

const SEVERITY_STYLES = {
  ERROR: {
    label: "Erro crítico",
    icon: AlertCircle,
    container: "border-red-200 bg-red-50/60",
    badge: "bg-red-100 text-red-700 border-red-200",
    iconColor: "text-red-600",
  },
  WARNING: {
    label: "Alerta",
    icon: AlertTriangle,
    container: "border-amber-200 bg-amber-50/60",
    badge: "bg-amber-100 text-amber-700 border-amber-200",
    iconColor: "text-amber-600",
  },
  INFO: {
    label: "Informativo",
    icon: Info,
    container: "border-blue-200 bg-blue-50/60",
    badge: "bg-blue-100 text-blue-700 border-blue-200",
    iconColor: "text-blue-600",
  },
} as const;

export function RevisionAuditModal({
  revisionId,
  revisionNumber,
  isFinalized,
  onClose,
}: RevisionAuditModalProps) {
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<AuditResultDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [justifyingId, setJustifyingId] = useState<string | null>(null);
  const [justificationDraft, setJustificationDraft] = useState("");
  const [savingJustification, setSavingJustification] = useState(false);

  const runAudit = async () => {
    setLoading(true);
    setError(null);
    const response = await runRevisionAuditAction(revisionId);
    setLoading(false);

    if (!response.success) {
      setError(response.error || "Erro ao executar auditoria.");
      return;
    }

    setResults(response.results ?? []);
  };

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const response = isFinalized
          ? await getRevisionAuditAction(revisionId)
          : await runRevisionAuditAction(revisionId);
        if (cancelled) return;
        if (!response.success) {
          setError(response.error || "Erro ao executar auditoria.");
        } else {
          setResults(response.results ?? []);
        }
        setLoading(false);
      })();
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [revisionId, isFinalized]);

  const summary = useMemo(
    () => ({
      errors: results.filter((result) => result.severity === "ERROR").length,
      warnings: results.filter((result) => result.severity === "WARNING").length,
      infos: results.filter((result) => result.severity === "INFO").length,
    }),
    [results]
  );

  const navigateTo = (result: AuditResultDto) => {
    if (!result.entityId) return;
    const selector =
      result.entityType === "BudgetItem"
        ? `#item-${result.entityId}`
        : `#stage-${result.entityId}`;
    const element = document.querySelector(selector);
    if (element instanceof HTMLElement) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      element.classList.add("ring-2", "ring-amber-400", "ring-inset");
      setTimeout(() => {
        element.classList.remove("ring-2", "ring-amber-400", "ring-inset");
      }, 2500);
      onClose();
    }
  };

  const handleJustify = async (result: AuditResultDto) => {
    if (justificationDraft.trim().length < 5) return;
    setSavingJustification(true);
    const response = await justifyAuditResultAction({
      auditResultId: result.id,
      justification: justificationDraft,
    });
    setSavingJustification(false);

    if (response.success && response.result) {
      setResults((current) =>
        current.map((entry) => (entry.id === response.result!.id ? response.result! : entry))
      );
      setJustifyingId(null);
      setJustificationDraft("");
    } else {
      setError(response.error || "Erro ao justificar alerta.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-4xl max-h-[90vh] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-4 p-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900">
                Auditoria da Revisão {revisionNumber}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {isFinalized
                  ? "Revisão finalizada: os achados abaixo são informativos."
                  : "Erros críticos bloqueiam a finalização. Alertas podem ser justificados."}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
            aria-label="Fechar auditoria"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-red-50 text-red-700 border border-red-200">
            <AlertCircle className="w-3.5 h-3.5" /> {summary.errors} erro(s)
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
            <AlertTriangle className="w-3.5 h-3.5" /> {summary.warnings} alerta(s)
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
            <Info className="w-3.5 h-3.5" /> {summary.infos} informativo(s)
          </span>

          <button
            type="button"
            onClick={runAudit}
            disabled={loading}
            className={`ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 ${
              isFinalized ? "hidden" : ""
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Reexecutar auditoria
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {loading && (
            <div className="flex items-center justify-center py-16 text-slate-500 gap-2 text-sm">
              <Loader2 className="w-5 h-5 animate-spin" />
              Executando regras de auditoria...
            </div>
          )}

          {error && (
            <div className="p-3 rounded-xl border border-red-200 bg-red-50 text-xs text-red-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {!loading && results.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center py-16 text-emerald-700 gap-2">
              <CheckCircle2 className="w-10 h-10" />
              <p className="text-sm font-semibold">Nenhum apontamento encontrado.</p>
              <p className="text-xs text-slate-500">
                A revisão atende a todas as regras de auditoria.
              </p>
            </div>
          )}

          {!loading &&
            results.map((result) => {
              const style = SEVERITY_STYLES[result.severity];
              const Icon = style.icon;
              const isJustifying = justifyingId === result.id;

              return (
                <div
                  key={result.id}
                  className={`rounded-xl border p-4 ${style.container}`}
                >
                  <div className="flex items-start gap-3">
                    <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${style.iconColor}`} />
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${style.badge}`}
                        >
                          {style.label}
                        </span>
                        <span className="font-mono text-[10px] text-slate-500">
                          {result.code}
                        </span>
                        {result.justification && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3" /> Justificado
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-800">{result.message}</p>

                      {result.justification && (
                        <p className="text-[11px] text-slate-600 bg-white/70 border border-slate-200 rounded-lg p-2">
                          <strong>Justificativa:</strong> {result.justification}
                        </p>
                      )}

                      <div className="flex flex-wrap items-center gap-2">
                        {result.entityId && (
                          <button
                            type="button"
                            onClick={() => navigateTo(result)}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 hover:text-indigo-900 hover:underline"
                          >
                            Ir para o apontamento
                          </button>
                        )}

                        {result.severity !== "ERROR" && !isFinalized && (
                          <button
                            type="button"
                            onClick={() => {
                              setJustifyingId(isJustifying ? null : result.id);
                              setJustificationDraft(result.justification ?? "");
                            }}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700 hover:text-slate-900 hover:underline"
                          >
                            {result.justification ? "Editar justificativa" : "Justificar alerta"}
                          </button>
                        )}
                      </div>

                      {isJustifying && (
                        <div className="space-y-2 pt-1">
                          <textarea
                            value={justificationDraft}
                            onChange={(event) => setJustificationDraft(event.target.value)}
                            rows={2}
                            placeholder="Descreva a análise técnica que justifica este alerta (mínimo 5 caracteres)."
                            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleJustify(result)}
                              disabled={savingJustification || justificationDraft.trim().length < 5}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-[11px] font-bold hover:bg-indigo-700 disabled:opacity-50"
                            >
                              {savingJustification ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              )}
                              Salvar justificativa
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setJustifyingId(null);
                                setJustificationDraft("");
                              }}
                              className="px-3 py-1.5 rounded-lg border border-slate-200 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
        </div>

        <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-3">
          <p className="text-[11px] text-slate-500">
            {isFinalized
              ? "Revisão finalizada: os registros de auditoria são somente leitura."
              : summary.errors > 0
                ? `${summary.errors} erro(s) crítico(s) impedem a finalização.`
                : "Nenhum erro crítico: a revisão pode ser finalizada."}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
