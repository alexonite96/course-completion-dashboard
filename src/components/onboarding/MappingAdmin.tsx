import { useState } from 'react';
import type { RolePlanMappingRule } from '../../../shared/onboarding-types';
import { addMappingRule, deleteMappingRule } from '../../onboarding-api';

interface Props {
  rules: RolePlanMappingRule[];
  onClose: () => void;
  onChanged: () => void;
}

export default function MappingAdmin({ rules, onClose, onChanged }: Props) {
  const [rolePattern, setRolePattern] = useState('');
  const [departmentPattern, setDepartmentPattern] = useState('');
  const [countryPattern, setCountryPattern] = useState('');
  const [learningPlanTitle, setLearningPlanTitle] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!rolePattern.trim() || !learningPlanTitle.trim()) {
      setError('Role pattern and Learning Plan title are required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await addMappingRule({
        rolePattern,
        departmentPattern: departmentPattern || null,
        countryPattern: countryPattern || null,
        learningPlanTitle,
        priority: 0,
      });
      setRolePattern('');
      setDepartmentPattern('');
      setCountryPattern('');
      setLearningPlanTitle('');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add rule.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    setBusy(true);
    try {
      await deleteMappingRule(id);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-10 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold text-slate-800">Role → Week 2 Learning Plan mapping</h2>
        <p className="mb-4 text-sm text-slate-500">
          A hire's Role is matched against these patterns (substring match, case-insensitive) to decide their Week 2 plan.
          Rules are checked in priority order; the first match wins.
        </p>

        <table className="mb-5 w-full text-sm">
          <thead className="border-b border-slate-200 text-left text-slate-500">
            <tr>
              <th className="py-1">Role pattern</th>
              <th className="py-1">Department</th>
              <th className="py-1">Country</th>
              <th className="py-1">Learning Plan</th>
              <th className="py-1"></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className="border-b border-slate-100">
                <td className="py-1">{r.rolePattern}</td>
                <td className="py-1">{r.departmentPattern ?? '—'}</td>
                <td className="py-1">{r.countryPattern ?? '—'}</td>
                <td className="py-1">{r.learningPlanTitle}</td>
                <td className="py-1 text-right">
                  <button onClick={() => void remove(r.id)} disabled={busy} className="text-xs text-red-600 hover:underline">Remove</button>
                </td>
              </tr>
            ))}
            {rules.length === 0 && (
              <tr><td colSpan={5} className="py-4 text-center text-slate-400">No rules yet.</td></tr>
            )}
          </tbody>
        </table>

        <div className="grid grid-cols-2 gap-3">
          <input value={rolePattern} onChange={(e) => setRolePattern(e.target.value)} placeholder="Role pattern (required)" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <input value={learningPlanTitle} onChange={(e) => setLearningPlanTitle(e.target.value)} placeholder="Learning Plan title (required)" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <input value={departmentPattern} onChange={(e) => setDepartmentPattern(e.target.value)} placeholder="Department pattern (optional)" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <input value={countryPattern} onChange={(e) => setCountryPattern(e.target.value)} placeholder="Country pattern (optional)" className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        </div>
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">Close</button>
          <button onClick={() => void add()} disabled={busy} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-40">
            Add rule
          </button>
        </div>
      </div>
    </div>
  );
}
