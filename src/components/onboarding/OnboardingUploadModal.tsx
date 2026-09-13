import { useRef, useState } from 'react';
import type { CompletionReportParseResult, MasterParseResult } from '../../../shared/onboarding-types';
import { parseCompletionReport } from '../../excel/parseCompletionReport';
import { parseMasterFile } from '../../excel/parseMasterFile';
import { uploadCompletionReport, uploadMasterFile } from '../../onboarding-api';

interface Props {
  onClose: () => void;
  onUploaded: () => void;
}

type Step = 'master' | 'completion' | 'done';

export default function OnboardingUploadModal({ onClose, onUploaded }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('master');
  const [filename, setFilename] = useState('');
  const [masterResult, setMasterResult] = useState<MasterParseResult | null>(null);
  const [completionResult, setCompletionResult] = useState<CompletionReportParseResult | null>(null);
  const [matchSummary, setMatchSummary] = useState<{ matchedExact: number; matchedToken: number; unmatched: number } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File | undefined) => {
    setError('');
    if (step === 'master') setMasterResult(null);
    else setCompletionResult(null);
    if (!file) return;
    setFilename(file.name);
    try {
      const buf = await file.arrayBuffer();
      if (step === 'master') setMasterResult(parseMasterFile(buf));
      else setCompletionResult(parseCompletionReport(buf));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read this file.');
    }
  };

  const confirmMaster = async () => {
    if (!masterResult) return;
    setBusy(true);
    setError('');
    try {
      await uploadMasterFile({ ...masterResult, filename });
      setMasterResult(null);
      setFilename('');
      setStep('completion');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };

  const confirmCompletion = async () => {
    if (!completionResult) return;
    setBusy(true);
    setError('');
    try {
      const res = await uploadCompletionReport({ filename, rows: completionResult.rows });
      setMatchSummary(res);
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-10 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-bold text-slate-800">
          {step === 'master' && 'Step 1 of 2: Upload master file'}
          {step === 'completion' && 'Step 2 of 2: Upload completion report'}
          {step === 'done' && 'Upload complete'}
        </h2>

        {step !== 'done' && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                void onFile(file);
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full rounded-md border-2 border-dashed border-slate-300 p-8 text-slate-500 hover:border-blue-400 hover:text-blue-600"
            >
              {filename || 'Click to choose a .xlsx file'}
            </button>
          </>
        )}

        {error && <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        {step === 'master' && masterResult && (
          <div className="mt-4 rounded-md bg-slate-50 p-4 text-sm text-slate-700">
            <p><b>{masterResult.hires.length}</b> new hires and <b>{masterResult.plans.length}</b> learning plans ready.</p>
            {masterResult.skipped.length > 0 && (
              <details className="mt-2 text-amber-700">
                <summary className="cursor-pointer">{masterResult.skipped.length} row(s) will be skipped</summary>
                <ul className="ml-5 list-disc">
                  {masterResult.skipped.map((s, i) => <li key={i}>Row {s.row}: {s.message}</li>)}
                </ul>
              </details>
            )}
            {masterResult.warnings.length > 0 && (
              <details className="mt-2 text-amber-700">
                <summary className="cursor-pointer">{masterResult.warnings.length} warning(s)</summary>
                <ul className="ml-5 list-disc">
                  {masterResult.warnings.map((w, i) => <li key={i}>Row {w.row}: {w.message}</li>)}
                </ul>
              </details>
            )}
          </div>
        )}

        {step === 'completion' && completionResult && (
          <div className="mt-4 rounded-md bg-slate-50 p-4 text-sm text-slate-700">
            <p><b>{completionResult.rows.length}</b> plan-completion record(s) ready to match against uploaded hires.</p>
            {completionResult.skipped.length > 0 && (
              <details className="mt-2 text-amber-700">
                <summary className="cursor-pointer">{completionResult.skipped.length} row(s) will be skipped</summary>
                <ul className="ml-5 list-disc">
                  {completionResult.skipped.map((s, i) => <li key={i}>Row {s.row}: {s.message}</li>)}
                </ul>
              </details>
            )}
          </div>
        )}

        {step === 'done' && matchSummary && (
          <div className="rounded-md bg-slate-50 p-4 text-sm text-slate-700">
            <p>
              <b>{matchSummary.matchedExact}</b> matched exactly, <b>{matchSummary.matchedToken}</b> matched by name similarity,{' '}
              <b>{matchSummary.unmatched}</b> could not be matched.
            </p>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={step === 'done' ? onUploaded : onClose} className="rounded-md px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">
            {step === 'done' ? 'Close' : 'Cancel'}
          </button>
          {step === 'master' && (
            <button
              onClick={() => void confirmMaster()}
              disabled={!masterResult || busy}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
            >
              {busy ? 'Uploading…' : 'Confirm & continue'}
            </button>
          )}
          {step === 'completion' && (
            <button
              onClick={() => void confirmCompletion()}
              disabled={!completionResult || busy}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
            >
              {busy ? 'Uploading…' : 'Confirm upload'}
            </button>
          )}
          {step === 'done' && (
            <button onClick={onUploaded} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
