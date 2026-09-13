export interface ParseWarning {
  row: number;
  message: string;
}

export interface NewHireInput {
  eeNumber: string | null;
  fullName: string;
  department: string | null;
  role: string | null;
  hiringManager: string | null;
  country: string | null;
  hireDate: string | null; // ISO YYYY-MM-DD or null
  jsDate: string | null;   // ISO YYYY-MM-DD or null
}

export interface LearningPlanDefInput {
  title: string;
  category: string | null;
  audience: string | null;
  department: string | null;
  region: string | null;
}

export interface MasterParseResult {
  hires: NewHireInput[];
  plans: LearningPlanDefInput[];
  skipped: ParseWarning[];
  warnings: ParseWarning[];
}

export interface CompletionRowInput {
  preferredName: string;
  lastName: string;
  learningPlanTitle: string;
  enrollmentDate: string | null;
  completionDate: string | null;
  coursesTotal: number;
  coursesCompleted: number;
}

export interface CompletionReportParseResult {
  rows: CompletionRowInput[]; // rolled up to one row per (person, plan)
  skipped: ParseWarning[];
}

export interface PlanCompletionRecord {
  learningPlanTitle: string;
  enrollmentDate: string | null;
  completionDate: string | null;
  coursesTotal: number;
  coursesCompleted: number;
}

export interface HireRecord {
  id: number;
  eeNumber: string | null;
  fullName: string;
  department: string | null;
  role: string | null;
  hiringManager: string | null;
  managerSlug: string | null;
  country: string | null;
  hireDate: string | null;
  jsDate: string | null;
  completions: PlanCompletionRecord[];
}

export interface RolePlanMappingRule {
  id: number;
  rolePattern: string;
  departmentPattern: string | null;
  countryPattern: string | null;
  learningPlanTitle: string;
  priority: number;
}

export interface RolePlanMappingInput {
  rolePattern: string;
  departmentPattern: string | null;
  countryPattern: string | null;
  learningPlanTitle: string;
  priority: number;
}

export interface MasterUploadResponse {
  hiresProcessed: number;
  plansProcessed: number;
}

export interface CompletionUploadResponse {
  processed: number;
  matchedExact: number;
  matchedToken: number;
  unmatched: number;
}

export type PlanStatus = 'complete' | 'in_progress' | 'overdue' | 'not_started' | 'unmapped';
export type OverallStatus = 'on_track' | 'behind' | 'not_started' | 'unmapped' | 'no_start_date';

export interface PlanJourney {
  learningPlanTitle: string | null; // null when Week 2 has no mapping rule
  status: PlanStatus;
  deadline: string | null;
  enrollmentDate: string | null;
  completionDate: string | null;
  coursesTotal: number;
  coursesCompleted: number;
}

export interface HireJourney {
  hire: HireRecord;
  week1: PlanJourney;
  week2: PlanJourney;
  overallStatus: OverallStatus;
}
