import { hashString } from './rng';

export interface PlanetVector {
  name: string;
  /** Heliocentric ecliptic coordinates in km, from JPL Horizons. */
  x: number;
  y: number;
  z: number;
}

export interface Ephemeris {
  epoch: string;
  planets: PlanetVector[];
  source: 'jpl-horizons' | 'fallback';
}

/**
 * Turns the planet vectors into a single integer seed. Rounded to whole
 * kilometres so the same epoch always produces the same seed.
 */
export function seedFromEphemeris(ephemeris: Ephemeris): number {
  const parts = ephemeris.planets.map(
    (p) => `${p.name}:${Math.round(p.x)}:${Math.round(p.y)}:${Math.round(p.z)}`,
  );
  return hashString(`${ephemeris.epoch}|${parts.join('|')}`);
}

/** Angle of the planet in the ecliptic plane, used for the board dressing. */
export function eclipticLongitude(planet: PlanetVector): number {
  const deg = (Math.atan2(planet.y, planet.x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

const FALLBACK: Ephemeris = {
  epoch: 'offline',
  source: 'fallback',
  planets: [
    { name: 'Venus', x: 1.0777e8, y: -2.081e7, z: -6.5e6 },
    { name: 'Mars', x: -1.7e8, y: 1.9e8, z: 7.4e6 },
    { name: 'Jupiter', x: 5.9e8, y: 4.3e8, z: -1.5e7 },
  ],
};

export async function fetchEphemeris(signal?: AbortSignal): Promise<Ephemeris> {
  try {
    const response = await fetch('/api/ephemeris', { signal });
    if (!response.ok) throw new Error(`ephemeris ${response.status}`);
    const data = (await response.json()) as Ephemeris;
    if (!data.planets || data.planets.length === 0) throw new Error('no planets');
    return data;
  } catch {
    // The game must never be blocked by an external service, so fall back to
    // a fixed vector table and tell the player we are offline.
    return { ...FALLBACK, epoch: new Date().toISOString().slice(0, 10) };
  }
}
