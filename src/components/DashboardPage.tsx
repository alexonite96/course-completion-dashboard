import type { Enrollment, UploadRecord } from '../../shared/types';

interface Props {
  course: string;
  rows: Enrollment[];
  lastUpload: UploadRecord | null;
  onUploadClick: () => void;
}

export default function DashboardPage({ course }: Props) {
  return <div className="p-6 text-slate-500">Dashboard for {course || '(no course)'} — built in Task 9</div>;
}
