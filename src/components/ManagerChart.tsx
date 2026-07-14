import type { ManagerStat } from '../lib/stats';

export default function ManagerChart({ breakdown }: { breakdown: ManagerStat[] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Completion by Manager</h2>
      <div className="space-y-2">
        {breakdown.map((m) => (
          <div key={m.manager} className="flex items-center gap-3 text-sm">
            <span className="w-40 truncate text-slate-600" title={m.manager}>{m.manager}</span>
            <div className="h-3 flex-1 rounded bg-slate-100">
              <div className="h-3 rounded bg-blue-600" style={{ width: `${m.rate}%` }} />
            </div>
            <span className="w-24 shrink-0 text-right text-slate-500">
              {m.rate}% ({m.completed}/{m.total})
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
