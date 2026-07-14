import type { ReactNode } from 'react';
import type { UploadRecord } from '../../shared/types';
import type { Stats } from '../lib/stats';

interface Props {
  course: string;
  stats: Stats;
  lastUpload: UploadRecord | null;
  onUploadClick: () => void;
}

function Stat({ value, label, className = '' }: { value: ReactNode; label: string; className?: string }) {
  return (
    <div>
      <div className={`text-2xl font-bold ${className}`}>{value}</div>
      <div className="text-xs text-slate-400">{label}</div>
    </div>
  );
}

export default function HeroHeader({ course, stats, lastUpload, onUploadClick }: Props) {
  const ring = `conic-gradient(#4ade80 ${stats.completionRate * 3.6}deg, rgba(255,255,255,0.15) 0deg)`;
  return (
    <div className="bg-gradient-to-r from-slate-900 to-slate-700 p-6 text-white">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">{course || 'Course Completion Dashboard'}</h1>
          <p className="text-xs text-slate-400">
            {lastUpload
              ? `Last upload: ${new Date(lastUpload.uploadedAt).toLocaleString()} · ${lastUpload.rowsProcessed} rows`
              : 'No uploads yet'}
          </p>
        </div>
        <button
          onClick={onUploadClick}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500"
        >
          ⬆ Upload Excel
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-8">
        <div className="grid h-20 w-20 place-items-center rounded-full" style={{ background: ring }}>
          <div className="grid h-16 w-16 place-items-center rounded-full bg-slate-800 text-lg font-bold">
            {stats.completionRate}%
          </div>
        </div>
        <Stat value={stats.total} label="Total Daymakers" />
        <Stat value={stats.completed} label="Completed" className="text-green-400" />
        <Stat value={stats.pending} label="Pending" className="text-amber-400" />
        <Stat value={stats.managers} label="Managers" />
      </div>
    </div>
  );
}
