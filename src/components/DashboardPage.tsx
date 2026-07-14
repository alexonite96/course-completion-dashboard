import type { Enrollment, UploadRecord } from '../../shared/types';
import { computeStats, managerBreakdown, pendingCsv } from '../lib/stats';
import HeroHeader from './HeroHeader';
import ManagerChart from './ManagerChart';

interface Props {
  course: string;
  rows: Enrollment[];
  lastUpload: UploadRecord | null;
  onUploadClick: () => void;
}

export default function DashboardPage({ course, rows, lastUpload, onUploadClick }: Props) {
  const stats = computeStats(rows);
  const breakdown = managerBreakdown(rows);

  const exportPending = () => {
    const blob = new Blob(['﻿' + pendingCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pending-${course || 'course'}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div>
      <HeroHeader course={course} stats={stats} lastUpload={lastUpload} onUploadClick={onUploadClick} />
      <div className="space-y-4 p-6">
        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
            No data yet. Click <b>Upload Excel</b> to import your first export.
          </div>
        ) : (
          <>
            <ManagerChart breakdown={breakdown} />
            <button
              onClick={exportPending}
              disabled={stats.pending === 0}
              className="rounded-md border border-blue-600 px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ⬇ Export pending list ({stats.pending})
            </button>
          </>
        )}
      </div>
    </div>
  );
}
