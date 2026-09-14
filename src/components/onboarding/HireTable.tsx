// src/components/onboarding/HireTable.tsx
import { Fragment, useMemo, useState } from 'react';
import type { HireJourney, OverallStatus, PlanJourney, PlanStatus } from '../../../shared/onboarding-types';

type SortKey = 'name' | 'manager' | 'jsDate';

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

const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  complete: 'Complete',
  in_progress: 'In Progress',
  overdue: 'Overdue',
  not_started: 'Not Started',
  unmapped: 'Unmapped',
};

const PLAN_STATUS_CLASS: Record<PlanStatus, string> = {
  complete: 'bg-green-100 text-green-700',
  in_progress: 'bg-blue-100 text-blue-700',
  overdue: 'bg-red-100 text-red-700',
  not_started: 'bg-amber-100 text-amber-700',
  unmapped: 'bg-slate-200 text-slate-700',
};

const TABLE_COLS = 6; // Name, Role, Manager, JS Date, Week 1, Week 2

function PlanCell({ plan, expanded, onToggle }: { plan: PlanJourney; expanded: boolean; onToggle: () => void }) {
  const hasCourses = plan.coursesTotal > 0;
  return (
    <td className="px-3 py-2 align-top">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); if (hasCourses) onToggle(); }}
        className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left ${hasCourses ? 'hover:bg-slate-100' : 'cursor-default'}`}
      >
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PLAN_STATUS_CLASS[plan.status]}`}>
          {PLAN_STATUS_LABEL[plan.status]}
        </span>
        {hasCourses && (
          <>
            <span className="text-xs text-slate-500">{plan.coursesCompleted}/{plan.coursesTotal}</span>
            <span className="ml-auto text-xs text-slate-400">{expanded ? '▲' : '▼'}</span>
          </>
        )}
      </button>
    </td>
  );
}

function CourseSubRow({ title, plan }: { title: string; plan: PlanJourney }) {
  return (
    <tr className="border-b border-slate-100 bg-slate-50/70 last:border-0">
      <td colSpan={TABLE_COLS} className="px-6 py-3">
        <div className="text-xs font-semibold text-slate-500">{title} — {plan.learningPlanTitle ?? 'Unmapped'}</div>
        {plan.courses.length === 0 ? (
          <div className="mt-1 text-xs text-slate-400">No course data yet.</div>
        ) : (
          <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {plan.courses.map((c) => (
              <li key={c.name} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs">
                <span className="truncate text-slate-700">{c.name}</span>
                {c.completionDate ? (
                  <span className="whitespace-nowrap text-green-600">✓ {c.completionDate}</span>
                ) : (
                  <span className="whitespace-nowrap text-slate-400">In progress</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}

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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpanded = (key: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

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
              <th className="px-3 py-2 text-left font-semibold text-slate-600">Week 1</th>
              <th className="px-3 py-2 text-left font-semibold text-slate-600">Week 2</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((j) => {
              const week1Key = `${j.hire.id}:week1`;
              const week2Key = `${j.hire.id}:week2`;
              const week1Open = expanded.has(week1Key);
              const week2Open = expanded.has(week2Key);
              return (
                <Fragment key={j.hire.id}>
                  <tr className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50" onClick={() => onSelect(j.hire.id)}>
                    <td className="px-3 py-2 font-medium text-slate-800">
                      {j.hire.fullName}
                      {j.overallStatus === 'behind' && (
                        <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[j.overallStatus]}`}>
                          {STATUS_LABEL[j.overallStatus]}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{j.hire.role ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-600">{j.hire.hiringManager ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-500">{j.hire.jsDate ?? '—'}</td>
                    <PlanCell plan={j.week1} expanded={week1Open} onToggle={() => toggleExpanded(week1Key)} />
                    <PlanCell plan={j.week2} expanded={week2Open} onToggle={() => toggleExpanded(week2Key)} />
                  </tr>
                  {week1Open && <CourseSubRow title="Week 1" plan={j.week1} />}
                  {week2Open && <CourseSubRow title="Week 2" plan={j.week2} />}
                </Fragment>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={TABLE_COLS} className="px-3 py-8 text-center text-slate-400">No matching hires.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
