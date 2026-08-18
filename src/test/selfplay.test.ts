import { describe, expect, it } from 'vitest';
import { benchmark, playSoloGame } from '../game/selfplay';
import { mulberry32 } from '../game/rng';

describe('self play', () => {
  it('always finishes a board within the hundred cells', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 40; i++) {
      const shots = playSoloGame('admiral', rng);
      expect(shots).toBeGreaterThanOrEqual(17);
      expect(shots).toBeLessThanOrEqual(100);
    }
  });

  it('is deterministic for a given seed', () => {
    expect(benchmark('hunter', 25, 99)).toEqual(benchmark('hunter', 25, 99));
  });

  /** Guards the point of having three difficulties at all. */
  it('gets stronger as the difficulty goes up', () => {
    const games = 60;
    const cadet = benchmark('random', games, 4242).mean;
    const officer = benchmark('hunter', games, 4242).mean;
    const admiral = benchmark('admiral', games, 4242).mean;
    expect(officer).toBeLessThan(cadet - 20);
    expect(admiral).toBeLessThan(officer - 5);
  });
});
