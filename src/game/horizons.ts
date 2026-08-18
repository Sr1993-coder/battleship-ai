/**
 * Parsing helpers for the NASA/JPL Horizons text report. Kept out of the
 * serverless handler so the format can be unit tested.
 */

export interface Vector {
  x: number;
  y: number;
  z: number;
}

export const HORIZONS_BODIES: Array<{ id: string; name: string }> = [
  { id: '299', name: 'Venus' },
  { id: '499', name: 'Mars' },
  { id: '599', name: 'Jupiter' },
];

const VECTOR_LINE = /X\s*=\s*(-?[\d.]+E[+-]\d+)\s+Y\s*=\s*(-?[\d.]+E[+-]\d+)\s+Z\s*=\s*(-?[\d.]+E[+-]\d+)/;

export function parseVector(report: string): Vector | null {
  const block = report.split('$$SOE')[1];
  if (!block) return null;
  const match = block.match(VECTOR_LINE);
  if (!match) return null;
  const [x, y, z] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (![x, y, z].every(Number.isFinite)) return null;
  return { x, y, z };
}

export function isoDay(offsetDays = 0, now = Date.now()): string {
  return new Date(now + offsetDays * 86400000).toISOString().slice(0, 10);
}
