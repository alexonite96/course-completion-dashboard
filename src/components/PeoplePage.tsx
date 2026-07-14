import { useMemo, useState } from 'react';
import type { Enrollment } from '../../shared/types';

type SortKey = 'name' | 'email' | 'jobAssignment' | 'manager' | 'status' | 'courseCompletionDate';

export default function PeoplePage({ rows }: { rows: Enrollment[] }) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [asc, setAsc] = useState(true);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = (r: Enrollment) =>
      !q ||
      [r.firstName, r.lastName, r.email, r.jobAssignment ?? '', r.manager ?? ''].some((v) =>
        v.toLowerCase().includes(q),
      );
    const valueOf = (r: Enrollment): string => {
      switch (sortKey) {
        case 'name':
          return `${r.lastName} ${r.firstName}`.toLowerCase();
        case 'status':
          return r.courseCompletionDate ? 'a-completed' : 'b-pending';
        default:
          return (r[sortKey] ?? '').toLowerCase();
      }
    };
    return rows
      .filter(matches)
      .sort((a, b) => (asc ? 1 : -1) * valueOf(a).localeCompare(valueOf(b)));
  }, [rows, search, sortKey, asc]);

  const header = (key: SortKey, label: string) => (
    <th
      className="cursor-pointer px-3 py-2 text-left font-semibold text-slate-600 hover:text-slate-900"
      onClick={() => {
        if (key === sortKey) setAsc(!asc);
        else {
          setSortKey(key);
          setAsc(true);
        }
      }}
    >
      {label}
      {sortKey === key ? (asc ? ' ▲' : ' ▼') : ''}
    </th>
  );

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-bold text-slate-800">People ({filtered.length})</h1>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, manager…"
          className="w-72 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
        />
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              {header('name', 'Name')}
              {header('email', 'Email')}
              {header('jobAssignment', 'Job Assignment')}
              {header('manager', 'Manager')}
              {header('status', 'Status')}
              {header('courseCompletionDate', 'Completed On')}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 last:border-0">
                <td className="px-3 py-2 font-medium text-slate-800">{r.firstName} {r.lastName}</td>
                <td className="px-3 py-2 text-slate-500">{r.email}</td>
                <td className="px-3 py-2 text-slate-600">{r.jobAssignment}</td>
                <td className="px-3 py-2 text-slate-600">{r.manager}</td>
                <td className="px-3 py-2">
                  {r.courseCompletionDate ? (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                      Completed
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                      Pending
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-500">{r.courseCompletionDate ?? '—'}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-400">No matching people.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
