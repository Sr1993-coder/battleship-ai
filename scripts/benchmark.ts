/**
 * Self-play benchmark. Each difficulty shoots at the same set of random fleets
 * and we report how many shots it needed to clear the board (100 is the worst
 * possible, 17 is perfect). Run with `npm run benchmark`.
 */
import { writeFileSync } from 'node:fs';
import { Difficulty } from '../src/game/ai';
import { benchmark } from '../src/game/selfplay';

const GAMES = Number(process.argv[2] ?? 2000);
const SEED = 20260818;
const DIFFICULTIES: Difficulty[] = ['random', 'hunter', 'admiral'];

const results = DIFFICULTIES.map((difficulty) => {
  const started = Date.now();
  const result = benchmark(difficulty, GAMES, SEED);
  console.log(
    `${difficulty.padEnd(8)} mean ${result.mean.toFixed(1)}  median ${result.median}  ` +
      `best ${result.best}  worst ${result.worst}  (${Date.now() - started}ms)`,
  );
  return { ...result, mean: Number(result.mean.toFixed(1)) };
});

const out = { games: GAMES, seed: SEED, generatedAt: new Date().toISOString(), results };
writeFileSync('src/game/benchmark.json', `${JSON.stringify(out, null, 2)}\n`);
console.log('wrote src/game/benchmark.json');
