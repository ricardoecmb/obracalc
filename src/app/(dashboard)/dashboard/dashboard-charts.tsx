"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PortfolioSnapshot } from "@/lib/services/portfolio";

interface DashboardChartsProps {
  stageRanking: PortfolioSnapshot["stageRanking"];
  statusDistribution: PortfolioSnapshot["statusDistribution"];
  budgetRanking: PortfolioSnapshot["budgetRanking"];
  comparisons: PortfolioSnapshot["comparisons"];
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Em elaboração",
  FINALIZED: "Finalizado",
  ARCHIVED: "Arquivado",
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "#f59e0b",
  FINALIZED: "#10b981",
  ARCHIVED: "#94a3b8",
};

const BAR_COLORS = [
  "#1e40af",
  "#2563eb",
  "#3b82f6",
  "#60a5fa",
  "#0ea5e9",
  "#06b6d4",
  "#14b8a6",
  "#10b981",
  "#84cc16",
  "#eab308",
];

function brl(value: string | number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(Number(value));
}

function compact(value: string | number): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  if (Math.abs(numeric) >= 1_000_000) {
    return `R$ ${(numeric / 1_000_000).toLocaleString("pt-BR", {
      maximumFractionDigits: 1,
    })} mi`;
  }
  if (Math.abs(numeric) >= 1_000) {
    return `R$ ${(numeric / 1_000).toLocaleString("pt-BR", {
      maximumFractionDigits: 0,
    })} mil`;
  }
  return brl(numeric);
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="h-64 flex items-center justify-center text-xs text-slate-400 text-center px-6">
      {message}
    </div>
  );
}

export function DashboardCharts({
  stageRanking,
  statusDistribution,
  budgetRanking,
  comparisons,
}: DashboardChartsProps) {
  const stageData = stageRanking.map((stage) => ({
    name: `${stage.code} ${stage.title}`.slice(0, 28),
    valor: Number(stage.totalWithBdi),
    percentual: Number(stage.percentage),
  }));

  const statusData = statusDistribution.map((entry) => ({
    name: STATUS_LABELS[entry.status] ?? entry.status,
    key: entry.status,
    value: entry.count,
    total: Number(entry.totalWithBdi),
  }));

  const budgetData = budgetRanking.map((budget) => ({
    name: budget.title.slice(0, 24),
    valor: Number(budget.totalWithBdi),
    status: budget.status,
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Etapas com maior impacto
              </h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Top 10 etapas de primeiro nível, somando apenas a revisão de
                referência de cada orçamento.
              </p>
            </div>
          </div>

          {stageData.length === 0 ? (
            <EmptyChart message="Nenhuma etapa com itens para exibir. Crie orçamentos com etapas para ver o ranking." />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={stageData}
                layout="vertical"
                margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis
                  type="number"
                  tickFormatter={(value) => compact(value)}
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={{ stroke: "#cbd5e1" }}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={150}
                  tick={{ fontSize: 10, fill: "#475569" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(value) => [brl(Number(value)), "Total com BDI"]}
                  contentStyle={{
                    fontSize: 11,
                    borderRadius: 10,
                    border: "1px solid #e2e8f0",
                  }}
                />
                <Bar dataKey="valor" radius={[0, 6, 6, 0]}>
                  {stageData.map((_, index) => (
                    <Cell
                      key={`stage-${index}`}
                      fill={BAR_COLORS[index % BAR_COLORS.length]}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5">
          <h2 className="text-sm font-bold text-slate-900 mb-1">
            Situação dos orçamentos
          </h2>
          <p className="text-[11px] text-slate-500 mb-2">
            Distribuição por status, sem duplicar revisões.
          </p>

          {statusData.length === 0 ? (
            <EmptyChart message="Nenhum orçamento cadastrado." />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={statusData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={55}
                  outerRadius={90}
                  paddingAngle={2}
                >
                  {statusData.map((entry) => (
                    <Cell
                      key={entry.key}
                      fill={STATUS_COLORS[entry.key] ?? "#94a3b8"}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => [
                    `${value} orçamento(s)`,
                    String(name),
                  ]}
                  contentStyle={{
                    fontSize: 11,
                    borderRadius: 10,
                    border: "1px solid #e2e8f0",
                  }}
                />
                <Legend
                  verticalAlign="bottom"
                  height={28}
                  formatter={(value) => (
                    <span style={{ fontSize: 10, color: "#475569" }}>{value}</span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5">
          <h2 className="text-sm font-bold text-slate-900 mb-1">
            Ranking de orçamentos
          </h2>
          <p className="text-[11px] text-slate-500 mb-3">
            Maiores valores com BDI na carteira.
          </p>

          {budgetData.length === 0 ? (
            <EmptyChart message="Sem orçamentos para comparar." />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart
                data={budgetData}
                margin={{ top: 4, right: 8, bottom: 8, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 9, fill: "#475569" }}
                  axisLine={{ stroke: "#cbd5e1" }}
                  tickLine={false}
                  interval={0}
                  angle={-12}
                  textAnchor="end"
                  height={52}
                />
                <YAxis
                  tickFormatter={(value) => compact(value)}
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                  width={72}
                />
                <Tooltip
                  formatter={(value) => [brl(Number(value)), "Total com BDI"]}
                  contentStyle={{
                    fontSize: 11,
                    borderRadius: 10,
                    border: "1px solid #e2e8f0",
                  }}
                />
                <Bar dataKey="valor" fill="#0f766e" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-5">
          <h2 className="text-sm font-bold text-slate-900 mb-1">
            Comparativo entre revisões
          </h2>
          <p className="text-[11px] text-slate-500 mb-3">
            Variação da revisão anterior para a revisão de referência.
          </p>

          {comparisons.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-xs text-slate-400 text-center px-6">
              Nenhum orçamento com duas ou mais revisões. Crie uma revisão para
              acompanhar a variação de valores.
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {comparisons.map((comparison) => {
                const positive = Number(comparison.deltaWithBdi) >= 0;
                return (
                  <div
                    key={comparison.budgetId}
                    className="p-3 rounded-xl border border-slate-200 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-800 truncate">
                        {comparison.budgetTitle}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        Rev. {comparison.fromRevisionNumber} →{" "}
                        {comparison.toRevisionNumber}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p
                        className={`text-xs font-bold ${
                          positive ? "text-emerald-700" : "text-red-700"
                        }`}
                      >
                        {positive ? "+" : ""}
                        {brl(comparison.deltaWithBdi)}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {positive ? "+" : ""}
                        {Number(comparison.deltaPercent).toFixed(2)}%
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
