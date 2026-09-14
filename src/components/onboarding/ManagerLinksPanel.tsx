import { useMemo, useState } from 'react';
import type { HireRecord } from '../../../shared/onboarding-types';

interface Props {
  hires: HireRecord[];
  onClose: () => void;
}

interface ManagerRow {
  hiringManager: string;
  managerSlug: string;
  hireCount: number;
}

function managerLinkUrl(managerSlug: string): string {
  return `${window.location.origin}/onboarding/m/${managerSlug}`;
}

export default function ManagerLinksPanel({ hires, onClose }: Props) {
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Derived from ALL hires (not the dashboard's recency-filtered view), so a manager
  // whose hires have all aged out of the default 30-day window still gets a link.
  const managers = useMemo<ManagerRow[]>(() => {
    const byManager = new Map<string, ManagerRow>();
    for (const h of hires) {
      if (!h.hiringManager || !h.managerSlug) continue;
      const existing = byManager.get(h.managerSlug);
      if (existing) existing.hireCount += 1;
      else byManager.set(h.managerSlug, { hiringManager: h.hiringManager, managerSlug: h.managerSlug, hireCount: 1 });
    }
    return [...byManager.values()].sort((a, b) => a.hiringManager.localeCompare(b.hiringManager));
  }, [hires]);

  const copyLink = async (managerSlug: string) => {
    setError('');
    const url = managerLinkUrl(managerSlug);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedSlug(managerSlug);
      setTimeout(() => setCopiedSlug((current) => (current === managerSlug ? null : current)), 2000);
    } catch {
      setError('Could not copy automatically — select and copy the link manually.');
      setCopiedSlug(null);
    }
  };

  return (
    <div className="fixed inset-0 z-10 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold text-slate-800">Manager links</h2>
        <p className="mb-4 text-sm text-slate-500">
          Each link shows only that manager's own new hires — no login required. Share a manager's link with them directly;
          this is a temporary stand-in until real sign-in is available.
        </p>

        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 text-left text-slate-500">
            <tr>
              <th className="py-1">Manager</th>
              <th className="py-1">Hires</th>
              <th className="py-1">Link</th>
              <th className="py-1"></th>
            </tr>
          </thead>
          <tbody>
            {managers.map((m) => (
              <tr key={m.managerSlug} className="border-b border-slate-100">
                <td className="py-2 font-medium text-slate-800">{m.hiringManager}</td>
                <td className="py-2 text-slate-500">{m.hireCount}</td>
                <td className="max-w-xs truncate py-2 text-xs text-slate-400">{managerLinkUrl(m.managerSlug)}</td>
                <td className="py-2 text-right">
                  <button
                    onClick={() => void copyLink(m.managerSlug)}
                    className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {copiedSlug === m.managerSlug ? 'Copied!' : 'Copy link'}
                  </button>
                </td>
              </tr>
            ))}
            {managers.length === 0 && (
              <tr><td colSpan={4} className="py-4 text-center text-slate-400">No managers on file yet.</td></tr>
            )}
          </tbody>
        </table>
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}

        <div className="mt-5 flex justify-end">
          <button onClick={onClose} className="rounded-md px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">Close</button>
        </div>
      </div>
    </div>
  );
}
