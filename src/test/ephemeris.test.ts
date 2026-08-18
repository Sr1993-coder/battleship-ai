import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseVector } from '../game/horizons';
import {
  Ephemeris,
  eclipticLongitude,
  fetchEphemeris,
  seedFromEphemeris,
} from '../game/ephemeris';

const REPORT = `
*******************************************************************************
$$SOE
2461270.500000000 = A.D. 2026-Aug-18 00:00:00.0000 TDB
 X =-4.831612448650832E+08 Y = 6.271674718050265E+08 Z = 8.204807206327021E+06
 VX=-1.051051082304421E+01 VY=-7.371262714678257E+00 VZ= 2.657770440047433E-01
$$EOE
`;

describe('horizons report parsing', () => {
  it('reads negative coordinates with no space after the equals sign', () => {
    const vector = parseVector(REPORT);
    expect(vector).not.toBeNull();
    expect(vector!.x).toBeCloseTo(-4.831612448650832e8, 0);
    expect(vector!.y).toBeCloseTo(6.271674718050265e8, 0);
    expect(vector!.z).toBeCloseTo(8.204807206327021e6, 0);
  });

  it('returns null when the report has no ephemeris block', () => {
    expect(parseVector('No ephemeris for target')).toBeNull();
  });
});

const ephemeris = (planets: Ephemeris['planets']): Ephemeris => ({
  epoch: '2026-08-18',
  source: 'jpl-horizons',
  planets,
});

describe('seeding', () => {
  const venus = { name: 'Venus', x: 1, y: 2, z: 3 };
  const mars = { name: 'Mars', x: 4, y: 5, z: 6 };

  it('is stable for the same epoch and planets', () => {
    expect(seedFromEphemeris(ephemeris([venus, mars]))).toBe(
      seedFromEphemeris(ephemeris([venus, mars])),
    );
  });

  it('changes when a planet is missing, which is why partial data is rejected', () => {
    expect(seedFromEphemeris(ephemeris([venus, mars]))).not.toBe(
      seedFromEphemeris(ephemeris([venus])),
    );
  });

  it('measures the ecliptic longitude of a planet', () => {
    expect(eclipticLongitude({ name: 'x', x: 1, y: 0, z: 0 })).toBeCloseTo(0);
    expect(eclipticLongitude({ name: 'x', x: 0, y: 1, z: 0 })).toBeCloseTo(90);
    expect(eclipticLongitude({ name: 'x', x: -1, y: 0, z: 0 })).toBeCloseTo(180);
  });
});

describe('fetchEphemeris', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('falls back to the built-in table when the file is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const result = await fetchEphemeris();
    expect(result.source).toBe('fallback');
    expect(result.planets).toHaveLength(3);
  });

  it('falls back when the file is malformed rather than passing it on', async () => {
    const bad = [
      { epoch: '2026-08-18', source: 'jpl-horizons', planets: {} },
      {
        epoch: '2026-08-18',
        source: 'jpl-horizons',
        planets: [
          { name: 'Venus', x: 1, y: 2, z: 3 },
          { name: 'Mars', x: 4, y: 5, z: 6 },
        ],
      },
      {
        epoch: '2026-08-18',
        source: 'jpl-horizons',
        planets: [
          { name: 'Venus' },
          { name: 'Mars', x: 4, y: 5, z: 6 },
          { name: 'Jupiter', x: 7, y: 8, z: 9 },
        ],
      },
    ];
    for (const body of bad) {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(body) }),
      );
      const result = await fetchEphemeris();
      expect(result.source).toBe('fallback');
      expect(result.planets).toHaveLength(3);
    }
  });

  it('rejects an aborted request instead of reporting a fallback seed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        return Promise.reject(error);
      }),
    );
    const controller = new AbortController();
    controller.abort();
    await expect(fetchEphemeris(controller.signal)).rejects.toThrow(/abort/i);
  });
});
