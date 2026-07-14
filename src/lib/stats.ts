import type { EnrollmentInput } from '../../shared/types';

export interface Stats {
  total: number;
  completed: number;
  pending: number;
  completionRate: number; // percentage, one decimal
  managers: number;       // distinct non-empty manager names
}

export interface ManagerStat {
  manager: string;
  total: number;
  completed: number;
  rate: number;
}

type StatRow = Pick<EnrollmentInput, 'courseCompletionDate' | 'manager'>;

const pct = (completed: number, total: number) =>
  total === 0 ? 0 : Math.round((completed / total) * 1000) / 10;

export function computeStats(rows: StatRow[]): Stats {
  const total = rows.length;
  const completed = rows.filter((r) => r.courseCompletionDate).length;
  const managers = new Set(rows.map((r) => (r.manager ?? '').trim()).filter(Boolean)).size;
  return { total, completed, pending: total - completed, completionRate: pct(completed, total), managers };
}

export function managerBreakdown(rows: StatRow[]): ManagerStat[] {
  const groups = new Map<string, { total: number; completed: number }>();
  for (const r of rows) {
    const name = (r.manager ?? '').trim() || 'Unassigned';
    const g = groups.get(name) ?? { total: 0, completed: 0 };
    g.total += 1;
    if (r.courseCompletionDate) g.completed += 1;
    groups.set(name, g);
  }
  return [...groups.entries()]
    .map(([manager, g]) => ({ manager, total: g.total, completed: g.completed, rate: pct(g.completed, g.total) }))
    .sort((a, b) => b.rate - a.rate || a.manager.localeCompare(b.manager));
}

const esc = (v: string | null) => {
  const s = v ?? '';
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function pendingCsv(rows: EnrollmentInput[]): string {
  const header = 'First Name,Last Name,Business Email,Job Assignment,Manager,Course Title,Course Start Date';
  const lines = rows
    .filter((r) => !r.courseCompletionDate)
    .map((r) =>
      [r.firstName, r.lastName, r.email, r.jobAssignment, r.manager, r.courseTitle, r.courseStartDate]
        .map(esc)
        .join(','),
    );
  return [header, ...lines].join('\n');
}
