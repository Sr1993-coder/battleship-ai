/**
 * Vercel serverless proxy for NASA/JPL Horizons. The browser cannot call
 * Horizons directly (no CORS headers), and the response is a text report
 * wrapped in JSON, so we parse it here and hand the client plain numbers.
 */

const BODIES: Array<{ id: string; name: string }> = [
  { id: '299', name: 'Venus' },
  { id: '499', name: 'Mars' },
  { id: '599', name: 'Jupiter' },
];

interface PlanetVector {
  name: string;
  x: number;
  y: number;
  z: number;
}

function parseVector(report: string): { x: number; y: number; z: number } | null {
  const block = report.split('$$SOE')[1];
  if (!block) return null;
  const match = block.match(
    /X\s*=\s*(-?[\d.E+-]+)\s*Y\s*=\s*(-?[\d.E+-]+)\s*Z\s*=\s*(-?[\d.E+-]+)/,
  );
  if (!match) return null;
  return { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
}

function isoDay(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

async function fetchBody(id: string): Promise<{ x: number; y: number; z: number } | null> {
  const params = new URLSearchParams({
    format: 'json',
    COMMAND: `'${id}'`,
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'VECTORS',
    CENTER: "'500@10'",
    START_TIME: `'${isoDay(0)}'`,
    STOP_TIME: `'${isoDay(1)}'`,
    STEP_SIZE: "'1d'",
  });
  const response = await fetch(`https://ssd.jpl.nasa.gov/api/horizons.api?${params}`);
  if (!response.ok) return null;
  const payload = (await response.json()) as { result?: string };
  return payload.result ? parseVector(payload.result) : null;
}

export default async function handler(_request: Request): Promise<Response> {
  const epoch = isoDay(0);
  try {
    const results = await Promise.all(BODIES.map((body) => fetchBody(body.id)));
    const planets: PlanetVector[] = [];
    results.forEach((vector, i) => {
      if (vector) planets.push({ name: BODIES[i].name, ...vector });
    });
    if (planets.length === 0) throw new Error('horizons returned no usable vectors');
    return new Response(JSON.stringify({ epoch, planets, source: 'jpl-horizons' }), {
      headers: {
        'content-type': 'application/json',
        // One hour is plenty: planets do not move fast enough to matter.
        'cache-control': 'public, max-age=3600, s-maxage=3600',
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }
}

export const config = { runtime: 'edge' };
