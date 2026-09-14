// src/components/onboarding/OnboardingPage.tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_RECENT_WINDOW_DAYS } from '../../../shared/onboarding-constants';
import type { HireRecord, RolePlanMappingRule } from '../../../shared/onboarding-types';
import { overdueCsv } from '../../lib/onboardingCsv';
import { buildHireJourney } from '../../lib/onboardingStatus';
import { fetchHires, fetchMappingRules } from '../../onboarding-api';
import HireDrawer from './HireDrawer';
import HireTable from './HireTable';
import ManagerLinksPanel from './ManagerLinksPanel';
import MappingAdmin from './MappingAdmin';
import OnboardingUploadModal from './OnboardingUploadModal';

const todayIso = () => new Date().toISOString().slice(0, 10);
const errMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

export default function OnboardingPage() {
  const [hires, setHires] = useState<HireRecord[]>([]);
  const [rules, setRules] = useState<RolePlanMappingRule[]>([]);
  const [loadError, setLoadError] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [managerLinksOpen, setManagerLinksOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setLoadError('');
      const [h, r] = await Promise.all([fetchHires(), fetchMappingRules()]);
      setHires(h);
      setRules(r);
    } catch (e) {
      setLoadError(errMessage(e));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const today = todayIso();
  const journeys = useMemo(() => hires.map((h) => buildHireJourney(h, rules, today)), [hires, rules, today]);

  const visible = useMemo(() => {
    if (showAll) return journeys;
    const cutoff = new Date(Date.now() - DEFAULT_RECENT_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
    return journeys.filter((j) => j.hire.jsDate === null || j.hire.jsDate >= cutoff);
  }, [journeys, showAll]);

  const selected = journeys.find((j) => j.hire.id === selectedId) ?? null;

  const stats = useMemo(() => ({
    total: visible.length,
    onTrack: visible.filter((j) => j.overallStatus === 'on_track').length,
    behind: visible.filter((j) => j.overallStatus === 'behind').length,
    notStarted: visible.filter((j) => j.overallStatus === 'not_started').length,
    needsAttention: visible.filter((j) => j.overallStatus === 'unmapped' || j.overallStatus === 'no_start_date').length,
  }), [visible]);

  const totalBehindCount = useMemo(
    () => journeys.filter((j) => j.overallStatus === 'behind').length,
    [journeys],
  );

  const exportOverdue = () => {
    const blob = new Blob(['﻿' + overdueCsv(journeys)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'onboarding-behind.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div className="p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">New Hire Onboarding</h1>
          <p className="text-xs text-slate-500">
            {showAll ? 'Showing full history' : `Showing hires with JS Date in the last ${DEFAULT_RECENT_WINDOW_DAYS} days`}
            {' · '}
            <button className="underline" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Show recent only' : 'Show all'}</button>
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setManagerLinksOpen(true)} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Manager links
          </button>
          <button onClick={() => setMappingOpen(true)} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Manage role mapping
          </button>
          <button onClick={() => setUploadOpen(true)} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">
            ⬆ Upload files
          </button>
        </div>
      </div>

      {loadError && <p className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{loadError}</p>}

      <div className="mb-5 grid grid-cols-5 gap-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-2xl font-bold text-slate-800">{stats.total}</div>
          <div className="text-xs text-slate-400">Total New Hires</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-2xl font-bold text-green-600">{stats.onTrack}</div>
          <div className="text-xs text-slate-400">On Track</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-2xl font-bold text-red-600">{stats.behind}</div>
          <div className="text-xs text-slate-400">Behind</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-2xl font-bold text-amber-600">{stats.notStarted}</div>
          <div className="text-xs text-slate-400">Not Started</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-2xl font-bold text-purple-600">{stats.needsAttention}</div>
          <div className="text-xs text-slate-400">Needs Attention</div>
        </div>
      </div>

      {hires.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
          No data yet. Click <b>Upload files</b> to import the master file and completion report.
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
          No hires match the last {DEFAULT_RECENT_WINDOW_DAYS} days. <button className="underline" onClick={() => setShowAll(true)}>Show all</button> to see full history.
        </div>
      ) : null}

      {visible.length > 0 && (
        <>
          <button
            onClick={exportOverdue}
            disabled={totalBehindCount === 0}
            className="mb-4 rounded-md border border-blue-600 px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ⬇ Export behind-schedule list ({totalBehindCount})
          </button>
          <HireTable journeys={visible} onSelect={setSelectedId} />
        </>
      )}

      {selected && <HireDrawer journey={selected} onClose={() => setSelectedId(null)} />}
      {uploadOpen && (
        <OnboardingUploadModal onClose={() => setUploadOpen(false)} onUploaded={() => { setUploadOpen(false); void refresh(); }} />
      )}
      {mappingOpen && (
        <MappingAdmin rules={rules} onClose={() => setMappingOpen(false)} onChanged={() => void refresh()} />
      )}
      {managerLinksOpen && (
        <ManagerLinksPanel hires={hires} onClose={() => setManagerLinksOpen(false)} />
      )}
    </div>
  );
}
