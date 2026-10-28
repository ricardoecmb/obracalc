import type { ImportJobView } from "@/lib/services/import-jobs";

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Na fila",
  RUNNING: "Processando",
  COMPLETED: "Concluída",
  FAILED: "Falhou",
};

const STATUS_CLASSES: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  RUNNING: "bg-blue-50 text-blue-700 border-blue-200",
  COMPLETED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  FAILED: "bg-red-50 text-red-700 border-red-200",
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function ImportJobsHistory({ jobs }: { jobs: ImportJobView[] }) {
  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-xs">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">Histórico de importações</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Jobs duráveis com checksum do arquivo, tentativas e relatório de reconciliação.
          </p>
        </div>
        <span className="text-xs font-semibold text-slate-500">{jobs.length} job(s)</span>
      </div>

      {jobs.length === 0 ? (
        <p className="text-sm text-slate-500 py-6 text-center">
          Nenhuma importação registrada ainda.
        </p>
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <th className="p-3 font-semibold">Arquivo</th>
                <th className="p-3 font-semibold">Status</th>
                <th className="p-3 font-semibold">Linhas</th>
                <th className="p-3 font-semibold">Criados</th>
                <th className="p-3 font-semibold">Atualizados</th>
                <th className="p-3 font-semibold">Ignorados</th>
                <th className="p-3 font-semibold">Criado em</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {jobs.map((job) => (
                <tr key={job.id} className="hover:bg-slate-50/70">
                  <td className="p-3">
                    <div className="font-medium text-slate-800 max-w-[220px] truncate">
                      {job.fileName}
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono">
                      {job.dataType} · {(job.fileSizeBytes / 1024).toFixed(1)} KB
                    </div>
                    {job.errorMessage && (
                      <div className="text-[10px] text-red-600 mt-1 max-w-[260px]">
                        {job.errorMessage}
                      </div>
                    )}
                  </td>
                  <td className="p-3">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] font-bold ${
                        STATUS_CLASSES[job.status] ?? STATUS_CLASSES.PENDING
                      }`}
                    >
                      {STATUS_LABELS[job.status] ?? job.status}
                    </span>
                  </td>
                  <td className="p-3 font-mono">{job.totalRows}</td>
                  <td className="p-3 font-mono text-emerald-700">{job.createdCount}</td>
                  <td className="p-3 font-mono text-blue-700">{job.updatedCount}</td>
                  <td className="p-3 font-mono text-amber-700">{job.skippedCount}</td>
                  <td className="p-3 text-slate-500">{formatDate(job.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
