import type { Enrollment } from '../../shared/types';

export default function PeoplePage({ rows }: { rows: Enrollment[] }) {
  return <div className="p-6 text-slate-500">People table ({rows.length} rows) — built in Task 11</div>;
}
