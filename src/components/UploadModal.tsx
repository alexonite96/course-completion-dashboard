import { useRef, useState } from 'react';
import type { ParseResult } from '../../shared/types';
import { postUpload } from '../api';
import { parseWorkbook } from '../excel/parse';

interface Props {
  onClose: () => void;
  onUploaded: (course: string) => void;
}

export default function UploadModal({ onClose, onUploaded }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState('');
  const [result, setResult] = useState<ParseResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File | undefined) => {
    setError('');
    setResult(null);
    if (!file) return;
    setFilename(file.name);
    try {
      setResult(parseWorkbook(await file.arrayBuffer()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read this file.');
    }
  };

  const confirm = async () => {
    if (!result) return;
    setBusy(true);
    setError('');
    try {
      await postUpload({ filename, rows: result.rows, skippedCount: result.skipped.length });
      onUploaded(result.courses[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-10 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold text-slate-800">Upload Excel export</h2>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <button
          onClick={() => fileRef.current?.click()}
          className="w-full rounded-md border-2 border-dashed border-slate-300 p-8 text-slate-500 hover:border-blue-400 hover:text-blue-600"
        >
          {filename || 'Click to choose a .xlsx file'}
        </button>
        {error && <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {result && (
          <div className="mt-4 rounded-md bg-slate-50 p-4 text-sm text-slate-700">
            <p>
              <b>{result.rows.length}</b> rows ready across <b>{result.courses.length}</b> course(s):{' '}
              {result.courses.join(', ')}
            </p>
            {result.skipped.length > 0 && (
              <details className="mt-2 text-amber-700">
                <summary className="cursor-pointer">{result.skipped.length} row(s) will be skipped</summary>
                <ul className="ml-5 list-disc">
                  {result.skipped.map((s, i) => (
                    <li key={i}>Row {s.row}: {s.message}</li>
                  ))}
                </ul>
              </details>
            )}
            {result.warnings.length > 0 && (
              <details className="mt-2 text-amber-700">
                <summary className="cursor-pointer">{result.warnings.length} warning(s)</summary>
                <ul className="ml-5 list-disc">
                  {result.warnings.map((w, i) => (
                    <li key={i}>Row {w.row}: {w.message}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button
            onClick={() => void confirm()}
            disabled={!result || result.rows.length === 0 || busy}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
          >
            {busy ? 'Uploading…' : 'Confirm upload'}
          </button>
        </div>
      </div>
    </div>
  );
}
