"use client";

import { useState } from "react";
import {
  Sparkles,
  KeyRound,
  ShieldCheck,
  ShieldAlert,
  Loader2,
  Search,
  CheckCircle2,
  AlertCircle,
  Info,
  Trash2,
  Power,
  PlugZap,
  Bot,
  ListChecks,
  Lock,
} from "lucide-react";
import {
  askAssistantAction,
  activateAIProviderAction,
  deleteAIProviderAction,
  saveAIProviderAction,
  testAIProviderAction,
} from "@/lib/actions/ai";
import type { AIProvider, AIProviderStatus } from "@/lib/ai/config";
import type {
  AssistantAnswer,
  AssistantSuggestion,
} from "@/lib/ai/assistant";

interface BudgetOption {
  id: string;
  title: string;
  projectName: string;
  revisions: Array<{
    id: string;
    revisionNumber: number;
    status: string;
  }>;
}

interface AssistantPanelProps {
  budgets: BudgetOption[];
  initialStatus: AIProviderStatus;
}

const SEVERITY_STYLE = {
  ERROR: {
    box: "bg-red-50 border-red-200",
    icon: "text-red-600",
    badge: "bg-red-100 text-red-700",
    label: "Erro",
  },
  WARNING: {
    box: "bg-amber-50 border-amber-200",
    icon: "text-amber-600",
    badge: "bg-amber-100 text-amber-700",
    label: "Alerta",
  },
  INFO: {
    box: "bg-blue-50 border-blue-200",
    icon: "text-blue-600",
    badge: "bg-blue-100 text-blue-700",
    label: "Info",
  },
} as const;

const CATEGORY_LABELS: Record<string, string> = {
  PRICE: "Preço",
  QUANTITY: "Quantidade",
  STRUCTURE: "Estrutura",
  BDI: "BDI",
  AUDIT: "Auditoria",
  COST: "Custo",
};

export function AssistantPanel({ budgets, initialStatus }: AssistantPanelProps) {
  const [status, setStatus] = useState<AIProviderStatus>(initialStatus);
  const [provider, setProvider] = useState<AIProvider>("openai");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [providerMessage, setProviderMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const [budgetId, setBudgetId] = useState<string>(budgets[0]?.id ?? "");
  const [revisionId, setRevisionId] = useState<string>(
    budgets[0]?.revisions[0]?.id ?? ""
  );
  const [query, setQuery] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const [askError, setAskError] = useState<string | null>(null);

  const selectedBudget = budgets.find((budget) => budget.id === budgetId);

  const handleBudgetChange = (nextBudgetId: string) => {
    setBudgetId(nextBudgetId);
    const nextBudget = budgets.find((budget) => budget.id === nextBudgetId);
    setRevisionId(nextBudget?.revisions[0]?.id ?? "");
  };

  const refreshStatus = (next: AIProviderStatus | undefined) => {
    if (next) setStatus(next);
  };

  const handleSaveProvider = async () => {
    setSaving(true);
    setProviderMessage(null);
    try {
      const result = await saveAIProviderAction({
        provider,
        model: model.trim() || null,
        apiKey,
        isActive: true,
      });
      if (!result.success) {
        setProviderMessage({
          type: "error",
          text: result.error ?? "Erro ao salvar provedor.",
        });
      } else {
        setProviderMessage({
          type: "success",
          text: "Chave salva e criptografada. O provedor foi ativado.",
        });
        setApiKey("");
        setModel("");
        refreshStatus(result.status);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async (target: AIProvider) => {
    setProviderMessage(null);
    const result = await activateAIProviderAction({ provider: target });
    if (!result.success) {
      setProviderMessage({
        type: "error",
        text: result.error ?? "Erro ao ativar provedor.",
      });
      return;
    }
    refreshStatus(result.status);
  };

  const handleDelete = async (target: AIProvider) => {
    setProviderMessage(null);
    const result = await deleteAIProviderAction({ provider: target });
    if (!result.success) {
      setProviderMessage({
        type: "error",
        text: result.error ?? "Erro ao remover provedor.",
      });
      return;
    }
    refreshStatus(result.status);
  };

  const handleTest = async (target: AIProvider) => {
    setProviderMessage(null);
    const result = await testAIProviderAction({ provider: target });
    if (!result.success) {
      setProviderMessage({
        type: "error",
        text: result.error ?? "Falha no teste do provedor.",
      });
      return;
    }
    setProviderMessage({
      type: "success",
      text: "Chave validada com sucesso (decriptação AES-256-GCM).",
    });
  };

  const handleAsk = async () => {
    if (!query.trim() && !revisionId) {
      setAskError("Digite uma pergunta ou selecione uma revisão.");
      return;
    }
    setAsking(true);
    setAskError(null);
    try {
      const result = await askAssistantAction({
        query,
        revisionId: revisionId || null,
      });
      if (!result.success || !result.answer) {
        setAskError(result.error ?? "Erro ao consultar o assistente.");
        return;
      }
      setAnswer(result.answer);
    } finally {
      setAsking(false);
    }
  };

  const groupedSuggestions = (answer?.suggestions ?? []).reduce(
    (acc, suggestion) => {
      acc[suggestion.severity].push(suggestion);
      return acc;
    },
    { ERROR: [], WARNING: [], INFO: [] } as Record<
      "ERROR" | "WARNING" | "INFO",
      AssistantSuggestion[]
    >
  );

  return (
    <div className="space-y-6 pb-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-blue-600" />
          Assistente de Orçamentos
        </h1>
        <p className="text-sm text-slate-500 mt-1 max-w-3xl">
          Busca assistida, análise de revisões e sugestões técnicas.{" "}
          <strong>As sugestões são não vinculantes</strong> e nunca alteram
          preços, coeficientes ou quantidades. O sistema funciona integralmente
          sem IA.
        </p>
      </div>

      <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50 flex items-start gap-3 text-xs text-slate-600">
        <Lock className="w-4 h-4 text-slate-500 flex-shrink-0 mt-0.5" />
        <p>
          Chaves de API são cifradas com AES-256-GCM e jamais retornadas ao
          navegador. O assistente opera em modo somente leitura; qualquer
          alteração no orçamento depende de ação humana explícita.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {/* Provedores de IA */}
        <div className="xl:col-span-2 space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Bot className="w-4 h-4 text-slate-500" />
                Provedor de IA
              </h2>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                  status.activeProvider
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-slate-100 text-slate-600 border-slate-200"
                }`}
              >
                {status.activeProvider ? "Ativo" : "Modo local"}
              </span>
            </div>

            {!status.encryptionConfigured && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-800 flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>
                  Configure <code>AI_ENCRYPTION_KEY</code> ou{" "}
                  <code>AUTH_SECRET</code> para habilitar o armazenamento seguro
                  de chaves. O assistente local continua funcionando.
                </span>
              </div>
            )}

            <div className="space-y-3">
              <label className="block text-[11px] font-semibold text-slate-600 space-y-1">
                Provedor
                <select
                  value={provider}
                  onChange={(event) =>
                    setProvider(event.target.value as AIProvider)
                  }
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-normal text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {status.availableProviders.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-[11px] font-semibold text-slate-600 space-y-1">
                Modelo (opcional)
                <input
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder={
                    status.availableProviders.find((item) => item.id === provider)
                      ?.defaultModel ?? ""
                  }
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-normal text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>

              <label className="block text-[11px] font-semibold text-slate-600 space-y-1">
                Chave de API
                <div className="relative">
                  <KeyRound className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder="sk-... (nunca sai do servidor)"
                    autoComplete="off"
                    className="w-full rounded-xl border border-slate-200 pl-9 pr-3 py-2 text-xs font-normal text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </label>

              <button
                type="button"
                onClick={handleSaveProvider}
                disabled={saving || apiKey.trim().length < 8}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="w-3.5 h-3.5" />
                )}
                Salvar chave criptografada
              </button>
            </div>

            {providerMessage && (
              <div
                className={`p-3 rounded-xl text-[11px] flex items-start gap-2 border ${
                  providerMessage.type === "success"
                    ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                    : "bg-red-50 border-red-200 text-red-800"
                }`}
              >
                {providerMessage.type === "success" ? (
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                )}
                <span>{providerMessage.text}</span>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-3">
            <h3 className="text-sm font-bold text-slate-900">
              Provedores configurados
            </h3>
            {status.providers.length === 0 ? (
              <p className="text-[11px] text-slate-500">
                Nenhum provedor configurado. O assistente opera em modo local
                determinístico.
              </p>
            ) : (
              <div className="space-y-2">
                {status.providers.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 rounded-xl border border-slate-200 text-[11px] space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-slate-900">
                        {item.providerLabel}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          item.isActive
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {item.isActive ? "Ativo" : "Inativo"}
                      </span>
                    </div>
                    <p className="text-slate-500">
                      Modelo: {item.model} • Chave: {item.keyMask}
                    </p>
                    <p className="text-slate-400">
                      {item.lastTestedAt
                        ? `Último teste: ${new Date(item.lastTestedAt).toLocaleString("pt-BR")} — ${item.lastTestResult}`
                        : "Nunca testado"}
                    </p>
                    <div className="flex items-center gap-1.5 pt-1">
                      <button
                        type="button"
                        onClick={() => handleActivate(item.provider)}
                        disabled={item.isActive}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 disabled:opacity-40"
                      >
                        <Power className="w-3 h-3" /> Ativar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleTest(item.provider)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-blue-50 text-blue-700 font-semibold hover:bg-blue-100"
                      >
                        <PlugZap className="w-3 h-3" /> Testar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(item.provider)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-red-50 text-red-700 font-semibold hover:bg-red-100"
                      >
                        <Trash2 className="w-3 h-3" /> Remover
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Assistente */}
        <div className="xl:col-span-3 space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-4">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-600" />
              Consultar assistente
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block text-[11px] font-semibold text-slate-600 space-y-1">
                Orçamento
                <select
                  value={budgetId}
                  onChange={(event) => handleBudgetChange(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-normal text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {budgets.length === 0 ? (
                    <option value="">Nenhum orçamento</option>
                  ) : (
                    budgets.map((budget) => (
                      <option key={budget.id} value={budget.id}>
                        {budget.title} — {budget.projectName}
                      </option>
                    ))
                  )}
                </select>
              </label>

              <label className="block text-[11px] font-semibold text-slate-600 space-y-1">
                Revisão para análise
                <select
                  value={revisionId}
                  onChange={(event) => setRevisionId(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-normal text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Somente busca (sem revisão)</option>
                  {(selectedBudget?.revisions ?? []).map((revision) => (
                    <option key={revision.id} value={revision.id}>
                      Revisão {revision.revisionNumber} —{" "}
                      {revision.status === "FINALIZED" ? "Finalizada" : "Rascunho"}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block text-[11px] font-semibold text-slate-600 space-y-1">
              Pergunta ou termo de busca
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
                <textarea
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  rows={3}
                  placeholder="Ex.: argamassa de assentamento; quais os principais riscos desta revisão?"
                  className="w-full rounded-xl border border-slate-200 pl-9 pr-3 py-2 text-xs font-normal text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
            </label>

            <button
              type="button"
              onClick={handleAsk}
              disabled={asking}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {asking ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              Consultar
            </button>

            {askError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-[11px] text-red-800 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{askError}</span>
              </div>
            )}
          </div>

          {answer && (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900">
                  Parecer do assistente
                </h3>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                    answer.mode === "AI"
                      ? "bg-purple-50 text-purple-700 border-purple-200"
                      : "bg-slate-100 text-slate-600 border-slate-200"
                  }`}
                >
                  {answer.mode === "AI"
                    ? `IA • ${answer.provider}`
                    : "Local determinístico"}
                </span>
              </div>

              <p className="text-xs text-slate-700 whitespace-pre-line leading-relaxed">
                {answer.answer}
              </p>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600 flex items-start gap-2">
                <Info className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                <span>{answer.notice}</span>
              </div>

              {answer.searchHits.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <Search className="w-3.5 h-3.5" /> Resultados encontrados
                  </h4>
                  <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden">
                    {answer.searchHits.map((hit) => (
                      <div
                        key={`${hit.type}-${hit.id}`}
                        className="p-2.5 text-[11px] flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <span className="font-bold text-slate-800">
                            {hit.code}
                          </span>{" "}
                          <span className="text-slate-600">
                            {hit.description}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-semibold">
                            {hit.type === "COMPOSITION" ? "Composição" : "Insumo"}
                          </span>
                          <span className="text-slate-500">{hit.unit}</span>
                          <span className="font-semibold text-slate-700">
                            R$ {hit.price}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {answer.suggestions.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <ListChecks className="w-3.5 h-3.5" /> Sugestões não
                    vinculantes ({answer.suggestions.length})
                  </h4>

                  {(["ERROR", "WARNING", "INFO"] as const).map((severity) => {
                    const items = groupedSuggestions[severity];
                    if (items.length === 0) return null;
                    const style = SEVERITY_STYLE[severity];
                    return (
                      <div key={severity} className="space-y-2">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold ${style.badge}`}
                        >
                          {style.label} — {items.length}
                        </span>
                        {items.map((suggestion) => (
                          <div
                            key={suggestion.id}
                            className={`p-3 rounded-xl border text-[11px] ${style.box}`}
                          >
                            <div className="flex items-start gap-2">
                              {severity === "INFO" ? (
                                <Info className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${style.icon}`} />
                              ) : (
                                <AlertCircle
                                  className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${style.icon}`}
                                />
                              )}
                              <div className="min-w-0 space-y-1">
                                <p className="font-bold text-slate-800">
                                  {suggestion.title}
                                </p>
                                <p className="text-slate-600 leading-relaxed">
                                  {suggestion.detail}
                                </p>
                                <p className="text-slate-500 italic">
                                  {CATEGORY_LABELS[suggestion.category] ??
                                    suggestion.category}
                                  : {suggestion.actionHint}
                                </p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
