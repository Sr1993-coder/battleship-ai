/**
 * Vercel serverless proxy for NASA/JPL Horizons. The browser cannot call
 * Horizons directly (it sends no CORS headers) and the response is a text
 * report wrapped in JSON, so the parsing happens here and the client gets
 * plain numbers.
 */
import { HORIZONS_BODIES, Vector, isoDay, parseVector } from '../src/game/horizons';

interface PlanetVector extends Vector {
  name: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchBody(id: string): Promise<Vector | null> {
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

/**
 * Horizons throttles concurrent requests from the same client, so the bodies
 * are fetched one at a time with a single retry each. A partial answer is not
 * good enough: the seed has to be identical for every player on a given day.
 */
async function fetchAllBodies(): Promise<PlanetVector[]> {
  const planets: PlanetVector[] = [];
  for (const body of HORIZONS_BODIES) {
    let vector = await fetchBody(body.id);
    if (!vector) {
      await sleep(400);
      vector = await fetchBody(body.id);
    }
    if (!vector) throw new Error(`no vector for ${body.name}`);
    planets.push({ name: body.name, ...vector });
  }
  return planets;
}

export default async function handler(): Promise<Response> {
  const epoch = isoDay(0);
  try {
    const planets = await fetchAllBodies();
    return new Response(JSON.stringify({ epoch, planets, source: 'jpl-horizons' }), {
      headers: {
        'content-type': 'application/json',
        // Planets do not move fast enough for a shorter cache to be useful,
        // and this keeps us well inside the Horizons rate limit.
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
