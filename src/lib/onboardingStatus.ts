import { WEEK1_DEADLINE_DAYS, WEEK1_PLAN_TITLE, WEEK2_DEADLINE_DAYS } from '../../shared/onboarding-constants';
import type { HireJourney, HireRecord, OverallStatus, PlanJourney, PlanStatus, RolePlanMappingRule } from '../../shared/onboarding-types';
import { resolveWeek2PlanTitle } from './roleMapping';

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

const normalizeTitle = (s: string) => s.trim().toLowerCase();

function buildJourney(
  planTitle: string | null,
  jsDate: string | null,
  deadlineDays: number,
  completions: HireRecord['completions'],
  today: string,
): PlanJourney {
  if (planTitle === null) {
    return { learningPlanTitle: null, status: 'unmapped', deadline: null, enrollmentDate: null, completionDate: null, coursesTotal: 0, coursesCompleted: 0, courses: [] };
  }
  const record = completions.find((c) => normalizeTitle(c.learningPlanTitle) === normalizeTitle(planTitle)) ?? null;
  const deadline = jsDate ? addDaysIso(jsDate, deadlineDays) : null;

  let status: PlanStatus;
  if (record?.completionDate) {
    status = 'complete';
  } else {
    const overdue = deadline !== null && today > deadline;
    if (record) status = overdue ? 'overdue' : 'in_progress';
    else status = overdue ? 'overdue' : 'not_started';
  }

  return {
    learningPlanTitle: planTitle,
    status,
    deadline,
    enrollmentDate: record?.enrollmentDate ?? null,
    completionDate: record?.completionDate ?? null,
    coursesTotal: record?.coursesTotal ?? 0,
    coursesCompleted: record?.coursesCompleted ?? 0,
    courses: record?.courses ?? [],
  };
}

const STATUS_RANK: Record<PlanStatus, number> = {
  complete: 0,
  in_progress: 1,
  not_started: 2,
  unmapped: 3,
  overdue: 4,
};

function overallFromPlans(week1: PlanStatus, week2: PlanStatus): OverallStatus {
  const worse = STATUS_RANK[week1] >= STATUS_RANK[week2] ? week1 : week2;
  if (worse === 'complete' || worse === 'in_progress') return 'on_track';
  if (worse === 'overdue') return 'behind';
  if (worse === 'unmapped') return 'unmapped';
  return 'not_started';
}

/** Builds the full onboarding story for one hire: Week 1 + Week 2 journeys and an overall status. */
export function buildHireJourney(hire: HireRecord, rules: RolePlanMappingRule[], today: string): HireJourney {
  const week1 = buildJourney(WEEK1_PLAN_TITLE, hire.jsDate, WEEK1_DEADLINE_DAYS, hire.completions, today);
  const week2PlanTitle = resolveWeek2PlanTitle(hire, rules);
  const week2 = buildJourney(week2PlanTitle, hire.jsDate, WEEK2_DEADLINE_DAYS, hire.completions, today);
  const overallStatus: OverallStatus = hire.jsDate === null ? 'no_start_date' : overallFromPlans(week1.status, week2.status);
  return { hire, week1, week2, overallStatus };
}
