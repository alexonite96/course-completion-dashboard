import type { HireJourney, PlanJourney, PlanStatus } from '../../../shared/onboarding-types';

const STATUS_TEXT: Record<PlanStatus, string> = {
  complete: 'Complete',
  in_progress: 'In Progress',
  overdue: 'Overdue',
  not_started: 'Not Started',
  unmapped: 'Unmapped',
};

function PlanRow({ label, plan }: { label: string; plan: PlanJourney }) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-700">{label}</span>
        <span className="text-xs font-medium text-slate-500">{STATUS_TEXT[plan.status]}</span>
      </div>
      <p className="mt-1 text-sm text-slate-600">{plan.learningPlanTitle ?? 'No plan could be determined for this role.'}</p>
      {plan.learningPlanTitle && (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-500">
          <dt>Deadline</dt><dd>{plan.deadline ?? '—'}</dd>
          <dt>Enrolled</dt><dd>{plan.enrollmentDate ?? '—'}</dd>
          <dt>Completed</dt><dd>{plan.completionDate ?? '—'}</dd>
          <dt>Courses</dt><dd>{plan.coursesCompleted} / {plan.coursesTotal}</dd>
        </dl>
      )}
    </div>
  );
}

export default function HireDrawer({ journey, onClose }: { journey: HireJourney; onClose: () => void }) {
  const { hire } = journey;
  return (
    <div className="fixed inset-0 z-10 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="mb-4 text-sm text-slate-500 hover:text-slate-800">← Close</button>
        <h2 className="text-lg font-bold text-slate-800">{hire.fullName}</h2>
        <p className="text-sm text-slate-500">{hire.role ?? 'Role unknown'} · {hire.hiringManager ?? 'No manager on file'}</p>
        <p className="mt-1 text-xs text-slate-400">JS Date: {hire.jsDate ?? 'Not recorded'}</p>
        <div className="mt-5 space-y-3">
          <PlanRow label="Week 1" plan={journey.week1} />
          <PlanRow label="Week 2" plan={journey.week2} />
        </div>
      </div>
    </div>
  );
}
