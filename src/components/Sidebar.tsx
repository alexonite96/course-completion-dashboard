import type { CourseInfo } from '../../shared/types';

interface Props {
  page: 'dashboard' | 'people' | 'onboarding';
  onNavigate: (page: 'dashboard' | 'people' | 'onboarding') => void;
  courses: CourseInfo[];
  course: string;
  onSelectCourse: (title: string) => void;
}

export default function Sidebar({ page, onNavigate, courses, course, onSelectCourse }: Props) {
  const link = (p: 'dashboard' | 'people' | 'onboarding', label: string) => (
    <button
      onClick={() => onNavigate(p)}
      className={`w-full rounded-md px-3 py-2 text-left text-sm ${
        page === p ? 'bg-blue-600 font-semibold text-white' : 'text-slate-300 hover:bg-slate-700'
      }`}
    >
      {label}
    </button>
  );

  return (
    <aside className="flex w-56 shrink-0 flex-col gap-2 bg-slate-900 p-4">
      <div className="mb-4 text-lg font-bold text-white">📊 Enablement</div>
      {link('dashboard', 'Dashboard')}
      {link('people', 'People')}
      {link('onboarding', 'Onboarding')}
      {page !== 'onboarding' && (
        <div className="mt-auto border-t border-slate-700 pt-3">
          <label htmlFor="course-select" className="text-xs font-semibold uppercase tracking-wide text-slate-400">Course</label>
          <select
            id="course-select"
            value={course}
            onChange={(e) => onSelectCourse(e.target.value)}
            className="mt-1 w-full rounded-md bg-slate-800 p-2 text-sm text-slate-100"
          >
            {courses.length === 0 && <option value="">No data yet</option>}
            {courses.map((c) => (
              <option key={c.courseTitle} value={c.courseTitle}>{c.courseTitle}</option>
            ))}
          </select>
        </div>
      )}
    </aside>
  );
}
