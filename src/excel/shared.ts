export class MissingColumnsError extends Error {
  constructor(public missing: string[]) {
    super(`Missing required columns: ${missing.join(', ')}`);
    this.name = 'MissingColumnsError';
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
const fmtUtc = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Build an ISO date from calendar parts, validating it is a real date. */
function fromParts(y: number, m: number, d: number): { iso: string | null; ok: boolean } {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return { iso: null, ok: false };
  }
  return { iso: `${String(y).padStart(4, '0')}-${pad(m)}-${pad(d)}`, ok: true };
}

/**
 * Convert a cell value to an ISO date string.
 * ok:false means the cell had content we could not read as a date.
 *
 * Date-only values carry no timezone, so this must be timezone-independent:
 * every path resolves to fixed calendar components, never local-time getters.
 */
export function toIsoDate(value: unknown): { iso: string | null; ok: boolean } {
  if (value === null || value === undefined) return { iso: null, ok: true };
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? { iso: null, ok: false } : { iso: fmtUtc(value), ok: true };
  }
  if (typeof value === 'number' && isFinite(value)) {
    const d = new Date(Math.round((value - 25569) * 86400000));
    return isNaN(d.getTime()) ? { iso: null, ok: false } : { iso: fmtUtc(d), ok: true };
  }
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t) return { iso: null, ok: true };
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
    if (iso) return fromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
    if (mdy) return fromParts(Number(mdy[3]), Number(mdy[1]), Number(mdy[2]));
    const d = new Date(t);
    return isNaN(d.getTime()) ? { iso: null, ok: false } : { iso: fmtUtc(d), ok: true };
  }
  return { iso: null, ok: false };
}

export const normalize = (s: string) => s.trim().toLowerCase();
export const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
export const isBlankRow = (row: unknown[] | undefined) =>
  !row || row.every((c) => c === null || c === undefined || String(c).trim() === '');
