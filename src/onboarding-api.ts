import type {
  CompletionRowInput,
  CompletionUploadResponse,
  HireRecord,
  MasterParseResult,
  MasterUploadResponse,
  RolePlanMappingInput,
  RolePlanMappingRule,
} from '../shared/onboarding-types';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const uploadMasterFile = (body: MasterParseResult & { filename: string }) =>
  fetch('/api/onboarding/uploads/master', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => json<MasterUploadResponse>(r));

export const uploadCompletionReport = (body: { filename: string; rows: CompletionRowInput[] }) =>
  fetch('/api/onboarding/uploads/completion-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => json<CompletionUploadResponse>(r));

export const fetchHires = () => fetch('/api/onboarding/hires').then((r) => json<HireRecord[]>(r));

export const fetchManagerHires = (slug: string) =>
  fetch(`/api/onboarding/manager/${encodeURIComponent(slug)}`).then((r) => json<HireRecord[]>(r));

export const fetchMappingRules = () => fetch('/api/onboarding/mapping').then((r) => json<RolePlanMappingRule[]>(r));

export const addMappingRule = (rule: RolePlanMappingInput) =>
  fetch('/api/onboarding/mapping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rule),
  }).then((r) => json<{ id: number }>(r));

export const deleteMappingRule = (id: number) =>
  fetch(`/api/onboarding/mapping/${id}`, { method: 'DELETE' }).then((r) => json<{ ok: boolean }>(r));
