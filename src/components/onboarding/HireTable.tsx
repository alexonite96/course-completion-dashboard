// src/components/onboarding/HireTable.tsx
import { useMemo, useState } from 'react';
import type { HireJourney, OverallStatus } from '../../../shared/onboarding-types';

type SortKey = 'name' | 'manager' | 'jsDate' | 'status';

const STATUS_LABEL: Record<OverallStatus, string> = {
  on_track: 'On Track',
  behind: 'Behind',
  not_started: 'Not Started',
  unmapped: 'Unmapped',
  no_start_date: 'No Start Date',
};

const STATUS_CLASS: Record<OverallStatus, string> = {
  on_track: 'bg-green-100 text-green-700',
  behind: 'bg-red-100 text-red-700',
  not_started: 'bg-amber-100 text-amber-700',
  unmapped: 'bg-slate-200 text-slate-700',
  no_start_date: 'bg-slate-200 text-slate-700',
};

interface Props {
  journeys: HireJourney[];
  onSelect: (id: number) => void;
}

export default function HireTable({ journeys, onSelect }: Props) {
  const [search, setSearch] = useState('');
  const [managerFilter, setManagerFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<OverallStatus | ''>('');
  const [sortKey, setSortKey] = useState<SortKey>('jsDate');
  const [asc, setAsc] = useState(false);

  const managers = useMemo(
    () => [...new Set(journeys.map((j) => j.hire.hiringManager).filter((m): m is string => !!m))].sort(),
    [journeys],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const valueOf = (j: HireJourney): string => {
      switch (sortKey) {
        case 'name': return j.hire.fullName.toLowerCase();
        case 'manager': return (j.hire.hiringManager ?? '').toLowerCase();
        case 'jsDate': return j.hire.jsDate ?? '';
        case 'status': return j.overallStatus;
      }
    };
    return journeys
      .filter((j) => !q || [j.hire.fullName, j.hire.role ?? '', j.hire.hiringManager ?? ''].some((v) => v.toLowerCase().includes(q)))
      .filter((j) => !managerFilter || j.hire.hiringManager === managerFilter)
      .filter((j) => !statusFilter || j.overallStatus === statusFilter)
      .sort((a, b) => (asc ? 1 : -1) * valueOf(a).localeCompare(valueOf(b)));
  }, [journeys, search, managerFilter, statusFilter, sortKey, asc]);

  const header = (key: SortKey, label: string) => (
    <th
      className="cursor-pointer px-3 py-2 text-left font-semibold text-slate-600 hover:text-slate-900"
      onClick={() => { if (key === sortKey) setAsc(!asc); else { setSortKey(key); setAsc(true); } }}
    >
      {label}{sortKey === key ? (asc ? ' ▲' : ' ▼') : ''}
    </th>
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, role, manager…"
          className="w-64 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
        />
        <select value={managerFilter} onChange={(e) => setManagerFilter(e.target.value)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
          <option value="">All managers</option>
          {managers.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as OverallStatus | '')} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
          <option value="">All statuses</option>
          {(Object.keys(STATUS_LABEL) as OverallStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              {header('name', 'Name')}
              <th className="px-3 py-2 text-left font-semibold text-slate-600">Role</th>
              {header('manager', 'Manager')}
              {header('jsDate', 'JS Date')}
              {header('status', 'Status')}
            </tr>
          </thead>
          <tbody>
            {filtered.map((j) => (
              <tr key={j.hire.id} className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50" onClick={() => onSelect(j.hire.id)}>
                <td className="px-3 py-2 font-medium text-slate-800">{j.hire.fullName}</td>
                <td className="px-3 py-2 text-slate-600">{j.hire.role ?? '—'}</td>
                <td className="px-3 py-2 text-slate-600">{j.hire.hiringManager ?? '—'}</td>
                <td className="px-3 py-2 text-slate-500">{j.hire.jsDate ?? '—'}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[j.overallStatus]}`}>
                    {STATUS_LABEL[j.overallStatus]}
                  </span>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">No matching hires.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
