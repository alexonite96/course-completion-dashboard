import { useCallback, useEffect, useState } from 'react';
import type { CourseInfo, Enrollment, UploadRecord } from '../shared/types';
import { fetchCourses, fetchEnrollments, fetchUploads } from './api';
import DashboardPage from './components/DashboardPage';
import PeoplePage from './components/PeoplePage';
import Sidebar from './components/Sidebar';
import UploadModal from './components/UploadModal';

const errMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

export default function App() {
  const [page, setPage] = useState<'dashboard' | 'people'>('dashboard');
  const [courses, setCourses] = useState<CourseInfo[]>([]);
  const [course, setCourse] = useState('');
  const [rows, setRows] = useState<Enrollment[]>([]);
  const [lastUpload, setLastUpload] = useState<UploadRecord | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(async (preferredCourse?: string) => {
    try {
      setLoadError('');
      const [cs, ups] = await Promise.all([fetchCourses(), fetchUploads()]);
      setCourses(cs);
      setLastUpload(ups[0] ?? null);
      setCourse((current) =>
        preferredCourse && cs.some((c) => c.courseTitle === preferredCourse) ? preferredCourse
        : cs.some((c) => c.courseTitle === current) ? current
        : (cs[0]?.courseTitle ?? ''),
      );
      setRefreshToken((t) => t + 1);
    } catch (e) {
      setLoadError(errMessage(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Owns the enrollment fetch. Keyed on `course` (switch courses) and
  // `refreshToken` (bumped by refresh() so re-uploading the same course refetches).
  // The cancellation flag drops stale responses when the key changes mid-flight.
  useEffect(() => {
    if (!course) {
      setRows([]);
      return;
    }
    let cancelled = false;
    fetchEnrollments(course)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(errMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [course, refreshToken]);

  return (
    <div className="flex min-h-screen bg-slate-100">
      <Sidebar page={page} onNavigate={setPage} courses={courses} course={course} onSelectCourse={setCourse} />
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
