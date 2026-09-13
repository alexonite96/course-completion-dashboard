import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HireJourney, HireRecord, RolePlanMappingRule } from '../../../shared/onboarding-types';
import { buildHireJourney } from '../../lib/onboardingStatus';
import { fetchManagerHires, fetchMappingRules } from '../../onboarding-api';
import HireDrawer from './HireDrawer';
import HireTable from './HireTable';

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function ManagerView({ slug }: { slug: string }) {
  const [hires, setHires] = useState<HireRecord[]>([]);
  const [rules, setRules] = useState<RolePlanMappingRule[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [h, r] = await Promise.all([fetchManagerHires(slug), fetchMappingRules()]);
      setHires(h);
      setRules(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your team.');
    }
  }, [slug]);

  useEffect(() => { void refresh(); }, [refresh]);

  const today = todayIso();
  const journeys: HireJourney[] = useMemo(() => hires.map((h) => buildHireJourney(h, rules, today)), [hires, rules, today]);
  const selected = journeys.find((j) => j.hire.id === selectedId) ?? null;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-4 rounded-md bg-amber-50 p-3 text-xs text-amber-700">
        This is a temporary, unauthenticated view shared by a private link. Real sign-in is planned for a future phase.
      </div>
      <h1 className="mb-4 text-xl font-bold text-slate-800">Your team's onboarding journeys</h1>
      {error && <p className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {hires.length === 0 && !error ? (
        <p className="text-slate-500">No new hires found for this link.</p>
      ) : (
        <HireTable journeys={journeys} onSelect={setSelectedId} />
      )}
      {selected && <HireDrawer journey={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
