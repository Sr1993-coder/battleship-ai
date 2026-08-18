/**
 * Pulls today's planet vectors from NASA/JPL Horizons and writes them to
 * public/ephemeris.json, which ships with the static build. The browser cannot
 * call Horizons itself (no CORS headers) and GitHub Pages has no server, so
 * this runs in CI once a day instead.
 */
import { mkdir, writeFile } from 'node:fs/promises';
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
 * Horizons throttles requests that arrive together, so the bodies are fetched
 * one at a time with a single retry each. A partial answer is not good enough:
 * the seed has to be identical for every player on a given day.
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

const planets = await fetchAllBodies();
await mkdir('public', { recursive: true });
await writeFile(
  'public/ephemeris.json',
  `${JSON.stringify({ epoch: isoDay(0), planets, source: 'jpl-horizons' }, null, 2)}\n`,
);
console.log(`wrote public/ephemeris.json for ${isoDay(0)}`);
