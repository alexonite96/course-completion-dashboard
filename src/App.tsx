import { useCallback, useEffect, useState } from 'react';
import type { CourseInfo, Enrollment, UploadRecord } from '../shared/types';
import { fetchCourses, fetchEnrollments, fetchUploads } from './api';
import DashboardPage from './components/DashboardPage';
import PeoplePage from './components/PeoplePage';
import Sidebar from './components/Sidebar';
import UploadModal from './components/UploadModal';

export default function App() {
  const [page, setPage] = useState<'dashboard' | 'people'>('dashboard');
  const [courses, setCourses] = useState<CourseInfo[]>([]);
  const [course, setCourse] = useState('');
  const [rows, setRows] = useState<Enrollment[]>([]);
  const [lastUpload, setLastUpload] = useState<UploadRecord | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [loadError, setLoadError] = useState('');

  const refresh = useCallback(async (preferredCourse?: string) => {
    try {
      setLoadError('');
      const [cs, ups] = await Promise.all([fetchCourses(), fetchUploads()]);
      setCourses(cs);
      setLastUpload(ups[0] ?? null);
      setCourse((current) => {
        const next =
          preferredCourse && cs.some((c) => c.courseTitle === preferredCourse) ? preferredCourse
          : cs.some((c) => c.courseTitle === current) ? current
          : (cs[0]?.courseTitle ?? '');
        if (next) fetchEnrollments(next).then(setRows).catch((e) => setLoadError(String(e)));
        else setRows([]);
        return next;
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load data');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectCourse = (title: string) => {
    setCourse(title);
    fetchEnrollments(title).then(setRows).catch((e) => setLoadError(String(e)));
  };

  return (
    <div className="flex min-h-screen bg-slate-100">
      <Sidebar page={page} onNavigate={setPage} courses={courses} course={course} onSelectCourse={selectCourse} />
      <main className="flex-1">
        {loadError && <p className="m-6 rounded-md bg-red-50 p-3 text-sm text-red-700">{loadError}</p>}
        {page === 'dashboard' ? (
          <DashboardPage course={course} rows={rows} lastUpload={lastUpload} onUploadClick={() => setUploadOpen(true)} />
        ) : (
          <PeoplePage rows={rows} />
        )}
      </main>
      {uploadOpen && (
        <UploadModal
          onClose={() => setUploadOpen(false)}
          onUploaded={(c) => {
            setUploadOpen(false);
            void refresh(c);
          }}
        />
      )}
    </div>
  );
}
